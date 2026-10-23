//! [`DiskCache`]: a [`CacheProvider`] backed by [`sled`], a persistent,
//! embedded, lock-free B+tree store. Values are serialized with `bincode`
//! before being written to the tree, and survive process restarts.
//!
//! Entries optionally carry a TTL (time-to-live). When a TTL is set, the
//! entry is stored alongside an expiration timestamp; expired entries are
//! evicted lazily on `get()` and periodically by a background sweep task.

use crate::cache::provider::CacheProvider;
use crate::error::{GratError, GratResult};

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Wrapper that pairs a serialized value with an optional expiration time.
///
/// Stored as a `bincode` blob alongside the raw key in the sled tree.
#[derive(serde::Serialize, serde::Deserialize)]
struct TtlEntry {
    /// The serialized value payload.
    value: Vec<u8>,
    /// Absolute expiration as a Unix timestamp in seconds. `None` means no expiration.
    expires_at: Option<u64>,
}

/// Cache statistics tracked across all operations.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

/// Persistent, embedded cache backed by a [`sled`] database.
///
/// `sled` provides lock-free concurrent access internally, so `DiskCache`
/// can be freely cloned and shared across tasks; blocking I/O is offloaded
/// to `tokio::task::spawn_blocking` to keep the async executor unblocked.
#[derive(Clone)]
pub struct DiskCache {
    db: Arc<sled::Db>,
    stats: Arc<std::sync::atomic::AtomicU64>,
}

impl DiskCache {
    fn ledger_key(key: &str, ledger_sequence: u32) -> Vec<u8> {
        let mut bytes = ledger_sequence.to_be_bytes().to_vec();
        bytes.extend_from_slice(b":");
        bytes.extend_from_slice(key.as_bytes());
        bytes
    }

    /// Returns the current Unix timestamp in seconds.
    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Opens (or creates) a sled database at `path`.
    pub fn new(path: impl AsRef<Path>) -> GratResult<Self> {
        let path = path.as_ref();
        let db = sled::open(path).map_err(|e| {
            GratError::CacheError(format!(
                "Failed to open sled database at {}: {e}",
                path.display()
            ))
        })?;

        Ok(Self {
            db: Arc::new(db),
            stats: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        })
    }

    /// Opens the disk cache at the platform's default cache directory.
    pub fn default_location() -> GratResult<Self> {
        let project_dirs =
            directories::ProjectDirs::from("dev", "grat", "grat").ok_or_else(|| {
                GratError::CacheError("Could not determine cache directory".to_string())
            })?;

        Self::new(project_dirs.cache_dir().join("disk_cache"))
    }

    /// Stores a value with an optional TTL (time-to-live).
    ///
    /// When `ttl` is `Some(duration)`, the entry will expire after that
    /// duration and will not be returned by [`get`](Self::get) once expired.
    /// When `ttl` is `None`, the entry never expires (legacy behavior).
    pub async fn put_with_ttl<V>(
        &self,
        key: &str,
        value: &V,
        ledger_sequence: Option<u32>,
        ttl: Option<Duration>,
    ) -> GratResult<()>
    where
        V: Serialize + Sync,
    {
        let key_owned = key.to_owned();
        let encoded = bincode::serialize(value).map_err(|e| GratError::CacheSerializationError {
            key: key_owned.clone(),
            reason: e.to_string(),
        });

        let expires_at = ttl.map(|d| Self::now_secs().saturating_add(d.as_secs()));

        let entry = TtlEntry {
            value: encoded?,
            expires_at,
        };
        let entry_bytes = bincode::serialize(&entry).map_err(|e| {
            GratError::CacheSerializationError {
                key: key_owned.clone(),
                reason: e.to_string(),
            }
        });

        let db = Arc::clone(&self.db);

        async move {
            let cache_key = match ledger_sequence {
                Some(sequence) => Self::ledger_key(&key_owned, sequence),
                None => key_owned.as_bytes().to_vec(),
            };

            tokio::task::spawn_blocking(move || {
                db.insert(cache_key.clone(), entry_bytes.clone())
                    .map_err(|e| GratError::CacheError(format!("Sled insert failed: {e}")))?;

                if let Some(sequence) = ledger_sequence {
                    let ledger_index = db.open_tree(b"ledger_index")
                        .map_err(|e| GratError::CacheError(format!("Failed to open ledger index: {e}")))?;
                    let entry_key = Self::ledger_key(&key_owned, sequence);
                    ledger_index
                        .insert(entry_key.clone(), key_owned.as_bytes())
                        .map_err(|e| GratError::CacheError(format!("Failed to index ledger entry: {e}")))?;
                    let _ = entry_key;
                }
                Ok::<(), GratError>(())
            })
            .await
            .map_err(|e| GratError::CacheError(format!("Cache task panicked: {e}")))??;

            Ok(())
        }
    }

    pub async fn put<V>(&self, key: &str, value: &V, ledger_sequence: Option<u32>) -> GratResult<()>
    where
        V: Serialize + Sync,
    {
        self.put_with_ttl(key, value, ledger_sequence, None).await
    }

    pub async fn get<V>(&self, key: &str, ledger_sequence: Option<u32>) -> GratResult<Option<V>>
    where
        V: DeserializeOwned + Send,
    {
        let db = Arc::clone(&self.db);
        let key = key.to_owned();

        async move {
            let lookup_key = match ledger_sequence {
                Some(sequence) => Self::ledger_key(&key, sequence),
                None => key.as_bytes().to_vec(),
            };

            let raw = tokio::task::spawn_blocking(move || db.get(lookup_key))
                .await
                .map_err(|e| GratError::CacheError(format!("Cache task panicked: {e}")))?
                .map_err(|e| GratError::CacheError(format!("Sled get failed: {e}")))?;

            let Some(bytes) = raw else {
                return Ok(None);
            };

            // Try to deserialize as a TtlEntry; if that fails, fall back to
            // raw deserialization for backward compatibility with entries
            // written before TTL support was added.
            let value: V = match bincode::deserialize::<TtlEntry>(&bytes) {
                Ok(ttl_entry) => {
                    if let Some(exp) = ttl_entry.expires_at {
                        if Self::now_secs() >= exp {
                            return Ok(None);
                        }
                    }
                    bincode::deserialize(&ttl_entry.value).map_err(|e| {
                        GratError::CacheDeserializationError {
                            key,
                            reason: e.to_string(),
                        }
                    })?
                }
                Err(_) => bincode::deserialize(&bytes).map_err(|e| {
                    GratError::CacheDeserializationError {
                        key,
                        reason: e.to_string(),
                    }
                })?,
            };

            Ok(Some(value))
        }
    }

    pub async fn remove(&self, key: &str, ledger_sequence: Option<u32>) -> GratResult<()> {
        let db = Arc::clone(&self.db);
        let key = key.to_owned();

        async move {
            let lookup_key = match ledger_sequence {
                Some(sequence) => Self::ledger_key(&key, sequence),
                None => key.as_bytes().to_vec(),
            };

            tokio::task::spawn_blocking(move || {
                db.remove(lookup_key)
                    .map_err(|e| GratError::CacheError(format!("Sled remove failed: {e}")))?;
                if let Some(sequence) = ledger_sequence {
                    let index = db.open_tree(b"ledger_index")
                        .map_err(|e| GratError::CacheError(format!("Failed to open ledger index: {e}")))?;
                    index
                        .remove(Self::ledger_key(&key, sequence))
                        .map_err(|e| GratError::CacheError(format!("Failed to remove ledger index entry: {e}")))?;
                }
                Ok::<(), GratError>(())
            })
            .await
            .map_err(|e| GratError::CacheError(format!("Cache task panicked: {e}")))??;

            Ok(())
        }
    }

    pub async fn prune_older_than(&self, ledger_sequence: u32) -> GratResult<()> {
        let db = Arc::clone(&self.db);

        async move {
            tokio::task::spawn_blocking(move || {
                let ledger_index = db.open_tree(b"ledger_index")
                    .map_err(|e| GratError::CacheError(format!("Failed to open ledger index: {e}")))?;

                let mut keys_to_remove = Vec::new();
                for seq in 0..ledger_sequence {
                    let prefix = seq.to_be_bytes();
                    for entry in ledger_index.scan_prefix(prefix) {
                        let (index_key, _) = entry.map_err(|e| {
                            GratError::CacheError(format!("Sled prefix scan failed: {e}"))
                        })?;
                        keys_to_remove.push(index_key.to_vec());
                    }
                }

                for index_key in keys_to_remove {
                    db.remove(index_key.clone())
                        .map_err(|e| GratError::CacheError(format!("Sled remove failed: {e}")))?;
                    ledger_index
                        .remove(index_key)
                        .map_err(|e| GratError::CacheError(format!("Failed to remove ledger index entry: {e}")))?;
                }

                Ok::<(), GratError>(())
            })
            .await
            .map_err(|e| GratError::CacheError(format!("Cache task panicked: {e}")))??;

            Ok(())
        }
    }

    /// Flushes any buffered writes to disk. Sled batches and lazily flushes
    /// writes for performance, so callers that need durability guarantees
    /// (e.g. before a restart) should await this explicitly.
    pub async fn flush(&self) -> GratResult<()> {
        self.db
            .flush_async()
            .await
            .map_err(|e| GratError::CacheError(format!("Sled flush failed: {e}")))?;
        Ok(())
    }

    /// Sweep all expired entries from the cache.
    ///
    /// Iterates over every key in the main tree, deserializes the `TtlEntry`
    /// wrapper, and removes any entry whose `expires_at` timestamp is in
    /// the past. Returns the number of entries evicted.
    ///
    /// This is intended to be called periodically by a background task
    /// (see [`start_eviction_sweep`]).
    pub async fn sweep_expired(&self) -> GratResult<u64> {
        let db = Arc::clone(&self.db);

        async move {
            let evicted = tokio::task::spawn_blocking(move || {
                let now = Self::now_secs();
                let mut evicted: u64 = 0;
                for item in db.iter() {
                    let Ok((key, val)) = item else {
                        continue;
                    };
                    if let Ok(ttl_entry) = bincode::deserialize::<TtlEntry>(&val) {
                        if let Some(exp) = ttl_entry.expires_at {
                            if now >= exp {
                                let _ = db.remove(key);
                                evicted += 1;
                            }
                        }
                    }
                }
                evicted
            })
            .await
            .map_err(|e| GratError::CacheError(format!("Cache task panicked: {e}")))?;

            Ok(evicted)
        }
    }
}

/// Start a background task that periodically sweeps expired entries from the
/// cache at the given interval. Returns a `JoinHandle` so the caller can
/// abort the task when it is no longer needed.
///
/// # Example
/// ```ignore
/// let cache = DiskCache::new("/tmp/cache")?;
/// let handle = start_eviction_sweep(cache, Duration::from_secs(300));
/// // ... use cache ...
/// handle.abort();
/// ```
pub fn start_eviction_sweep(
    cache: DiskCache,
    interval: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.tick().await; // skip immediate first tick
        loop {
            ticker.tick().await;
            match cache.sweep_expired().await {
                Ok(evicted) if evicted > 0 => {
                    tracing::debug!(evicted, "background sweep removed expired cache entries");
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(error = %e, "background cache sweep failed");
                }
            }
        }
    })
}

impl CacheProvider for DiskCache {
    fn get<V>(&self, key: &str) -> impl Future<Output = GratResult<Option<V>>> + Send
    where
        V: DeserializeOwned + Send,
    {
        self.get(key, None)
    }

    fn put<V>(&self, key: &str, value: &V) -> impl Future<Output = GratResult<()>> + Send
    where
        V: Serialize + Sync,
    {
        self.put(key, value, None)
    }

    fn remove(&self, key: &str) -> impl Future<Output = GratResult<()>> + Send {
        self.remove(key, None)
    }

    fn clear(&self) -> impl Future<Output = GratResult<()>> + Send {
        let db = Arc::clone(&self.db);

        async move {
            tokio::task::spawn_blocking(move || db.clear())
                .await
                .map_err(|e| GratError::CacheError(format!("Cache task panicked: {e}")))?
                .map_err(|e| GratError::CacheError(format!("Sled clear failed: {e}")))?;

            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Sample {
        id: u32,
        name: String,
    }

    #[tokio::test]
    async fn test_put_get_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        let value = Sample {
            id: 1,
            name: "wasm-blob".to_string(),
        };
        cache.put("key1", &value, None).await.unwrap();

        let fetched: Option<Sample> = cache.get("key1", None).await.unwrap();
        assert_eq!(fetched, Some(value));
    }

    #[tokio::test]
    async fn test_put_overwrites_existing_entry() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache.put("key1", &1u32, None).await.unwrap();
        cache.put("key1", &2u32, None).await.unwrap();

        assert_eq!(cache.get::<u32>("key1", None).await.unwrap(), Some(2));
    }

    #[tokio::test]
    async fn test_cache_miss_returns_ok_none() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        let fetched: Option<Sample> = cache.get("missing", None).await.unwrap();
        assert_eq!(fetched, None);
    }

    #[tokio::test]
    async fn test_remove() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache.put("key1", &42u32, None).await.unwrap();
        cache.remove("key1", None).await.unwrap();

        let fetched: Option<u32> = cache.get("key1", None).await.unwrap();
        assert_eq!(fetched, None);
    }

    #[tokio::test]
    async fn test_remove_of_missing_key_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache.remove("never-existed", None).await.unwrap();
    }

    #[tokio::test]
    async fn test_clear() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache.put("key1", &1u32, None).await.unwrap();
        cache.put("key2", &2u32, None).await.unwrap();
        cache.clear().await.unwrap();

        assert_eq!(cache.get::<u32>("key1", None).await.unwrap(), None);
        assert_eq!(cache.get::<u32>("key2", None).await.unwrap(), None);
    }

    #[tokio::test]
    async fn test_persistence_across_reopen() {
        let dir = tempfile::tempdir().unwrap();

        {
            let cache = DiskCache::new(dir.path()).unwrap();
            cache.put("durable", &"value".to_string(), None).await.unwrap();
            cache.flush().await.unwrap();
        }

        let reopened = DiskCache::new(dir.path()).unwrap();
        let fetched: Option<String> = reopened.get("durable", None).await.unwrap();
        assert_eq!(fetched, Some("value".to_string()));
    }

    #[tokio::test]
    async fn test_concurrent_put_get() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        let mut handles = Vec::new();
        for i in 0..20u32 {
            let cache = cache.clone();
            handles.push(tokio::spawn(async move {
                let key = format!("key-{i}");
                cache.put(&key, &i, None).await.unwrap();
                let fetched: Option<u32> = cache.get(&key, None).await.unwrap();
                assert_eq!(fetched, Some(i));
            }));
        }

        for handle in handles {
            handle.await.unwrap();
        }
    }

    #[tokio::test]
    async fn test_deserialize_type_mismatch_returns_typed_error() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        // bincode is not self-describing, so a mismatch only reliably surfaces
        // as an error when the stored bytes are too short for the target type
        // (here, a bare u32 has no bytes left for `Sample`'s trailing String).
        cache.put("key1", &1u32, None).await.unwrap();

        let err = cache.get::<Sample>("key1", None).await.unwrap_err();
        assert!(matches!(err, GratError::CacheDeserializationError { .. }));
    }

    #[tokio::test]
    async fn test_put_get_with_ledger_sequence() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache
            .put("entry", &42u32, Some(101u32))
            .await
            .unwrap();

        assert_eq!(cache.get::<u32>("entry", Some(101)).await.unwrap(), Some(42));
        assert_eq!(cache.get::<u32>("entry", Some(100)).await.unwrap(), None);
    }

    #[tokio::test]
    async fn test_prune_older_than_removes_ledger_scoped_entries() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache.put("old", &1u32, Some(10)).await.unwrap();
        cache.put("recent", &2u32, Some(20)).await.unwrap();
        cache.put("newer", &3u32, Some(30)).await.unwrap();

        cache.prune_older_than(20).await.unwrap();

        assert_eq!(cache.get::<u32>("old", Some(10)).await.unwrap(), None);
        assert_eq!(cache.get::<u32>("recent", Some(20)).await.unwrap(), Some(2));
        assert_eq!(cache.get::<u32>("newer", Some(30)).await.unwrap(), Some(3));
    }

    #[tokio::test]
    async fn test_ttl_entry_expires_and_is_not_returned() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        // Write an entry with a 1-second TTL.
        cache
            .put_with_ttl("ephemeral", &42u32, None, Some(Duration::from_secs(1)))
            .await
            .unwrap();

        // Immediately it should be present.
        assert_eq!(
            cache.get::<u32>("ephemeral", None).await.unwrap(),
            Some(42)
        );

        // Wait for it to expire.
        tokio::time::sleep(Duration::from_secs(2)).await;

        // After expiry, get should return None (expired entry evicted lazily).
        assert_eq!(
            cache.get::<u32>("ephemeral", None).await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn test_ttl_none_means_no_expiration() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        cache
            .put_with_ttl("permanent", &99u32, None, None)
            .await
            .unwrap();

        // Should still be there even after a brief wait.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(
            cache.get::<u32>("permanent", None).await.unwrap(),
            Some(99)
        );
    }

    #[tokio::test]
    async fn test_sweep_expired_removes_only_expired_entries() {
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        // One entry with 1s TTL, one without TTL, one with 10s TTL.
        cache
            .put_with_ttl("short", &1u32, None, Some(Duration::from_secs(1)))
            .await
            .unwrap();
        cache.put("forever", &2u32, None).await.unwrap();
        cache
            .put_with_ttl("long", &3u32, None, Some(Duration::from_secs(10)))
            .await
            .unwrap();

        // Wait for "short" to expire.
        tokio::time::sleep(Duration::from_secs(2)).await;

        let evicted = cache.sweep_expired().await.unwrap();
        assert_eq!(evicted, 1);

        assert_eq!(cache.get::<u32>("short", None).await.unwrap(), None);
        assert_eq!(cache.get::<u32>("forever", None).await.unwrap(), Some(2));
        assert_eq!(cache.get::<u32>("long", None).await.unwrap(), Some(3));
    }

    #[tokio::test]
    async fn test_ttl_backward_compat_with_non_ttl_entries() {
        // Entries written directly to sled (without TtlEntry wrapper) should
        // still be readable. Simulate by writing raw bytes directly.
        let dir = tempfile::tempdir().unwrap();
        let cache = DiskCache::new(dir.path()).unwrap();

        // Write using the normal put (which now wraps in TtlEntry).
        cache.put("wrapped", &42u32, None).await.unwrap();

        // Manually write a raw value (simulating old data).
        let raw = bincode::serialize(&99u32).unwrap();
        cache.db.insert("raw_key", raw).unwrap();

        // Both should be readable.
        assert_eq!(cache.get::<u32>("wrapped", None).await.unwrap(), Some(42));
        assert_eq!(cache.get::<u32>("raw_key", None).await.unwrap(), Some(99));
    }
}
