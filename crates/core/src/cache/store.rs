use crate::error::{GratError, GratResult};

use std::cmp::Ordering;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]

pub enum CacheCategory {
    WasmBlob,

    ContractSpec,

    LedgerEntry,

    TransactionResult,
}

impl CacheCategory {
    fn as_str(self) -> &'static str {
        match self {
            Self::WasmBlob => "wasm",
            Self::ContractSpec => "spec",
            Self::LedgerEntry => "ledger",
            Self::TransactionResult => "tx",
        }
    }
}

/// Cache statistics tracked atomically across all operations.
#[derive(Debug, Default)]
pub struct CacheStats {
    hits: AtomicU64,
    misses: AtomicU64,
    evictions: AtomicU64,
}

impl CacheStats {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn hits(&self) -> u64 {
        self.hits.load(AtomicOrdering::Relaxed)
    }

    pub fn misses(&self) -> u64 {
        self.misses.load(AtomicOrdering::Relaxed)
    }

    pub fn evictions(&self) -> u64 {
        self.evictions.load(AtomicOrdering::Relaxed)
    }

    fn record_hit(&self) {
        self.hits.fetch_add(1, AtomicOrdering::Relaxed);
    }

    fn record_miss(&self) {
        self.misses.fetch_add(1, AtomicOrdering::Relaxed);
    }

    fn record_eviction(&self) {
        self.evictions.fetch_add(1, AtomicOrdering::Relaxed);
    }
}

/// Magic prefix (8 bytes) identifying TTL-aware cache files.
/// A zero value means "no expiry"; a non-zero value is a Unix timestamp
/// in seconds after which the entry is considered expired.
const TTL_HEADER_LEN: usize = 8;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub struct CacheStore {
    cache_dir: PathBuf,
    max_size: u64,
    stats: Arc<CacheStats>,
}

impl CacheStore {
    pub fn new(cache_dir: PathBuf, max_size_mb: u64) -> GratResult<Self> {
        Self::with_max_size_bytes(cache_dir, max_size_mb * 1024 * 1024)
    }

    pub fn with_max_size_bytes(cache_dir: PathBuf, max_size_bytes: u64) -> GratResult<Self> {
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| GratError::CacheError(format!("Failed to create cache dir: {e}")))?;

        Ok(Self {
            cache_dir,
            max_size: max_size_bytes,
            stats: Arc::new(CacheStats::new()),
        })
    }

    pub fn default_location() -> GratResult<Self> {
        let project_dirs =
            directories::ProjectDirs::from("dev", "grat", "grat").ok_or_else(|| {
                GratError::CacheError("Could not determine cache directory".to_string())
            })?;

        Self::new(project_dirs.cache_dir().to_path_buf(), 512)
    }

    /// Returns a snapshot of cache statistics (hits, misses, evictions).
    pub fn stats(&self) -> (u64, u64, u64) {
        (
            self.stats.hits(),
            self.stats.misses(),
            self.stats.evictions(),
        )
    }

    /// Stores a value with an optional TTL (time-to-live).
    ///
    /// When `ttl` is `Some(duration)`, the entry will expire after that
    /// duration and will not be returned by [`get`](Self::get) once expired.
    /// When `ttl` is `None`, the entry never expires.
    pub fn put_with_ttl(
        &self,
        category: CacheCategory,
        key: &str,
        value: &[u8],
        ledger_sequence: Option<u32>,
        ttl: Option<Duration>,
    ) -> GratResult<()> {
        let expiry = ttl
            .map(|d| now_secs().saturating_add(d.as_secs()))
            .unwrap_or(0);

        // Prepend an 8-byte TTL header (big-endian expiry timestamp).
        let mut payload = Vec::with_capacity(TTL_HEADER_LEN + value.len());
        payload.extend_from_slice(&expiry.to_be_bytes());
        payload.extend_from_slice(value);

        let new_size = payload.len() as u64;
        if new_size > self.max_size {
            return Err(GratError::CacheError(format!(
                "Cache entry exceeds configured cache size limit of {} bytes",
                self.max_size
            )));
        }

        // Ensure we can fit the new entry by evicting least-recently-used files.
        let current_size = self.total_cache_size()?;
        if current_size.saturating_add(new_size) > self.max_size {
            self.evict_lru_to_fit(new_size)?;
        }

        let path = self.entry_path(category, key, ledger_sequence);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| GratError::CacheError(format!("Failed to create dir: {e}")))?;
        }

        std::fs::write(&path, &payload)
            .map_err(|e| GratError::CacheError(format!("Failed to write cache entry: {e}")))?;
        Ok(())
    }

    pub fn put(
        &self,
        category: CacheCategory,
        key: &str,
        value: &[u8],
        ledger_sequence: Option<u32>,
    ) -> GratResult<()> {
        self.put_with_ttl(category, key, value, ledger_sequence, None)
    }

    pub fn get(
        &self,
        category: CacheCategory,
        key: &str,
        ledger_sequence: Option<u32>,
    ) -> GratResult<Option<Vec<u8>>> {
        let path = self.entry_path(category, key, ledger_sequence);
        if path.exists() {
            let data = std::fs::read(&path)
                .map_err(|e| GratError::CacheError(format!("Failed to read cache entry: {e}")))?;

            // Check TTL header if present (files with >= 8 bytes).
            if data.len() >= TTL_HEADER_LEN {
                let expiry_bytes: [u8; 8] = data[..TTL_HEADER_LEN].try_into().unwrap();
                let expiry = u64::from_be_bytes(expiry_bytes);
                if expiry > 0 && now_secs() >= expiry {
                    // Entry has expired — remove it and report a miss.
                    self.stats.record_miss();
                    let _ = std::fs::remove_file(&path);
                    self.stats.record_eviction();
                    return Ok(None);
                }

                // Update access metadata for LRU.
                if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&path) {
                    let now = SystemTime::now();
                    let _ = file.set_times(
                        std::fs::FileTimes::new()
                            .set_accessed(now)
                            .set_modified(now),
                    );
                }

                self.stats.record_hit();
                return Ok(Some(data[TTL_HEADER_LEN..].to_vec()));
            }

            // Backward compatibility: files shorter than TTL_HEADER_LEN are
            // old-format entries with no TTL header — return them as-is.
            self.stats.record_hit();
            Ok(Some(data))
        } else {
            self.stats.record_miss();
            Ok(None)
        }
    }

    pub fn contains(&self, category: CacheCategory, key: &str, ledger_sequence: Option<u32>) -> bool {
        self.entry_path(category, key, ledger_sequence).exists()
    }

    pub fn remove(
        &self,
        category: CacheCategory,
        key: &str,
        ledger_sequence: Option<u32>,
    ) -> GratResult<()> {
        let path = self.entry_path(category, key, ledger_sequence);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| GratError::CacheError(format!("Failed to remove cache entry: {e}")))?;
        }
        Ok(())
    }

    pub fn prune_older_than(&self, category: CacheCategory, ledger_sequence: u32) -> GratResult<()> {
        let base_dir = self.cache_dir.join(category.as_str());
        if !base_dir.exists() {
            return Ok(());
        }

        let mut stale_paths = Vec::new();
        for entry in walk_dir_files(&base_dir) {
            let path = entry.path();
            let Some(parent) = path.parent() else {
                continue;
            };
            let Some(seq_text) = parent.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Ok(seq) = seq_text.parse::<u32>() else {
                continue;
            };
            if seq < ledger_sequence {
                stale_paths.push(path);
            }
        }

        for path in stale_paths {
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| GratError::CacheError(format!("Failed to prune cache entry: {e}")))?;
            }
        }

        Ok(())
    }

    pub fn clear(&self) -> GratResult<()> {
        if self.cache_dir.exists() {
            std::fs::remove_dir_all(&self.cache_dir)
                .map_err(|e| GratError::CacheError(format!("Failed to clear cache: {e}")))?;
            std::fs::create_dir_all(&self.cache_dir)
                .map_err(|e| GratError::CacheError(format!("Failed to recreate cache dir: {e}")))?;
        }
        Ok(())
    }

    pub(crate) fn entry_path(
        &self,
        category: CacheCategory,
        key: &str,
        ledger_sequence: Option<u32>,
    ) -> PathBuf {
        let mut path = self.cache_dir.join(category.as_str());
        if let Some(sequence) = ledger_sequence {
            path = path.join(sequence.to_string());
        }
        path.join(key)
    }

    fn total_cache_size(&self) -> GratResult<u64> {
        let mut total: u64 = 0;

        if !self.cache_dir.exists() {
            return Ok(0);
        }

        for entry in walk_dir_files(&self.cache_dir) {
            let size = entry
                .metadata()
                .map_err(|e| {
                    GratError::CacheError(format!("Failed to read cache file metadata: {e}"))
                })?
                .len();
            total = total.saturating_add(size);
        }

        Ok(total)
    }

    fn evict_lru_to_fit(&self, required_new_entry_size: u64) -> GratResult<()> {
        // Keep evicting oldest files until we can fit the required new entry.
        loop {
            let current_size = self.total_cache_size()?;
            if current_size.saturating_add(required_new_entry_size) <= self.max_size {
                return Ok(());
            }

            let mut files = Vec::new();
            if self.cache_dir.exists() {
                for entry in walk_dir_files(&self.cache_dir) {
                    let meta = entry.metadata().map_err(|e| {
                        GratError::CacheError(format!("Failed to read cache file metadata: {e}"))
                    })?;

                    let accessed = meta.accessed().unwrap_or(SystemTime::UNIX_EPOCH);
                    let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    let last_used = std::cmp::max(accessed, modified);

                    files.push((last_used, entry));
                }
            }

            if files.is_empty() {
                // No files to evict, but we still don't fit.
                return Err(GratError::CacheError(format!(
                    "Cache max_size={} too small or eviction impossible",
                    self.max_size
                )));
            }

            // Oldest first => delete until we create headroom.
            files.sort_by(|a, b| {
                let ord = a.0.cmp(&b.0);
                if ord == Ordering::Equal {
                    // Stable tie-breaker: delete longer ago deterministically.
                    a.1.path().cmp(&b.1.path())
                } else {
                    ord
                }
            });

            let (oldest_ts, oldest_file) = files.into_iter().next().expect("checked empty");

            let path = oldest_file.path();
            // Best-effort delete.
            std::fs::remove_file(&path).map_err(|e| {
                GratError::CacheError(format!(
                    "Failed to evict cache file {}: {e}",
                    path.display()
                ))
            })?;

            self.stats.record_eviction();

            // If deletion succeeded, loop will re-check size.
            let _ = oldest_ts;
        }
    }
}

fn walk_dir_files(dir: &Path) -> Vec<std::fs::DirEntry> {
    fn visit_dir(dir: &Path, out: &mut Vec<std::fs::DirEntry>) {
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            for e in read_dir.flatten() {
                let p = e.path();
                if p.is_dir() {
                    visit_dir(&p, out);
                } else {
                    out.push(e);
                }
            }
        }
    }

    let mut files = Vec::new();
    visit_dir(dir, &mut files);
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_cache_roundtrip() {
        let dir = std::env::temp_dir().join("grat_test_cache");
        let store = CacheStore::new(dir.clone(), 10).unwrap();

        store
            .put(CacheCategory::WasmBlob, "test_key", b"hello", None)
            .unwrap();
        let result = store.get(CacheCategory::WasmBlob, "test_key", None).unwrap();
        assert_eq!(result, Some(b"hello".to_vec()));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_cache_lru_eviction() {
        let dir = std::env::temp_dir().join("grat_test_lru");
        let _ = std::fs::remove_dir_all(&dir);
        // Each entry includes an 8-byte TTL header, so 4-byte values become
        // 12 bytes on disk. Use 30 bytes to fit 2 entries and evict on the 3rd.
        let store = CacheStore::with_max_size_bytes(dir.clone(), 30).unwrap();

        store.put(CacheCategory::WasmBlob, "key1", b"1234", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        store.put(CacheCategory::WasmBlob, "key2", b"5678", None).unwrap();

        assert!(store.contains(CacheCategory::WasmBlob, "key1", None));
        assert!(store.contains(CacheCategory::WasmBlob, "key2", None));

        store.get(CacheCategory::WasmBlob, "key1", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));

        store.put(CacheCategory::WasmBlob, "key3", b"9012", None).unwrap();

        assert!(store.contains(CacheCategory::WasmBlob, "key1", None));
        assert!(!store.contains(CacheCategory::WasmBlob, "key2", None));
        assert!(store.contains(CacheCategory::WasmBlob, "key3", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_ttl_entry_expires_on_get() {
        let dir = std::env::temp_dir().join("grat_test_ttl");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store
            .put_with_ttl(
                CacheCategory::LedgerEntry,
                "ephemeral",
                b"temp",
                None,
                Some(Duration::from_secs(1)),
            )
            .unwrap();

        // Immediately available.
        assert_eq!(
            store.get(CacheCategory::LedgerEntry, "ephemeral", None).unwrap(),
            Some(b"temp".to_vec())
        );

        // Wait for expiry.
        std::thread::sleep(Duration::from_secs(2));

        // After expiry, get returns None and the file is removed.
        assert_eq!(
            store.get(CacheCategory::LedgerEntry, "ephemeral", None).unwrap(),
            None
        );

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_ttl_none_means_no_expiration() {
        let dir = std::env::temp_dir().join("grat_test_ttl_permanent");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store
            .put_with_ttl(
                CacheCategory::WasmBlob,
                "forever",
                b"persistent",
                None,
                None,
            )
            .unwrap();

        assert_eq!(
            store.get(CacheCategory::WasmBlob, "forever", None).unwrap(),
            Some(b"persistent".to_vec())
        );

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_cache_stats_track_hits_misses_evictions() {
        let dir = std::env::temp_dir().join("grat_test_stats");
        let _ = std::fs::remove_dir_all(&dir);
        // 30 bytes: fits one 12-byte entry (4 bytes + 8-byte header), evicts on second.
        let store = CacheStore::with_max_size_bytes(dir.clone(), 30).unwrap();

        // Miss: key doesn't exist.
        let _ = store.get(CacheCategory::WasmBlob, "absent", None).unwrap();

        // Put two entries (second evicts first due to size limit).
        store
            .put(CacheCategory::WasmBlob, "k1", b"1234", None)
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        store
            .put(CacheCategory::WasmBlob, "k2", b"5678", None)
            .unwrap();

        // Hit: k2 exists.
        let _ = store.get(CacheCategory::WasmBlob, "k2", None).unwrap();

        let (hits, misses, evictions) = store.stats();
        assert!(hits >= 1, "expected at least 1 hit, got {hits}");
        assert!(misses >= 1, "expected at least 1 miss, got {misses}");
        assert!(evictions >= 1, "expected at least 1 eviction, got {evictions}");

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_backward_compat_old_format_files() {
        // Files written without a TTL header (shorter than 8 bytes) should
        // still be readable as raw data.
        let dir = std::env::temp_dir().join("grat_test_compat");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        // Write a raw file directly (simulating old format).
        let path = store.entry_path(CacheCategory::WasmBlob, "old", None);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, b"legacy").unwrap();

        // Should be returned as-is (no TTL header to strip).
        assert_eq!(
            store.get(CacheCategory::WasmBlob, "old", None).unwrap(),
            Some(b"legacy".to_vec())
        );

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }
}
