use crate::error::{GratError, GratResult};

use std::cmp::Ordering;

use std::path::{Path, PathBuf};
use std::time::SystemTime;

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

pub struct CacheStore {
    cache_dir: PathBuf,
    max_size: u64,
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
        })
    }

    pub fn default_location() -> GratResult<Self> {
        let project_dirs =
            directories::ProjectDirs::from("dev", "grat", "grat").ok_or_else(|| {
                GratError::CacheError("Could not determine cache directory".to_string())
            })?;

        Self::new(project_dirs.cache_dir().to_path_buf(), 512)
    }

    pub fn put(
        &self,
        category: CacheCategory,
        key: &str,
        value: &[u8],
        ledger_sequence: Option<u32>,
    ) -> GratResult<()> {
        let new_size = value.len() as u64;
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

        std::fs::write(&path, value)
            .map_err(|e| GratError::CacheError(format!("Failed to write cache entry: {e}")))?;
        Ok(())
    }

    pub fn get(
        &self,
        category: CacheCategory,
        key: &str,
        ledger_sequence: Option<u32>,
    ) -> GratResult<Option<Vec<u8>>> {
        let path = self.entry_path(category, key, ledger_sequence);
        if path.exists() {
            // Explicitly update access metadata to ensure LRU eviction works even if atime is disabled.
            if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&path) {
                let now = SystemTime::now();
                let _ = file.set_times(
                    std::fs::FileTimes::new()
                        .set_accessed(now)
                        .set_modified(now),
                );
            }
            let data = std::fs::read(&path)
                .map_err(|e| GratError::CacheError(format!("Failed to read cache entry: {e}")))?;
            Ok(Some(data))
        } else {
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

    fn entry_path(
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
        let store = CacheStore::with_max_size_bytes(dir.clone(), 10).unwrap();

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

    // ── Entry exceeds max size ────────────────────────────────────────────────

    #[test]
    fn test_single_entry_exceeds_max_size_is_rejected() {
        let dir = std::env::temp_dir().join("grat_test_exceed");
        let _ = std::fs::remove_dir_all(&dir);
        // max 5 bytes
        let store = CacheStore::with_max_size_bytes(dir.clone(), 5).unwrap();

        // 6 bytes — exceeds max
        let result = store.put(CacheCategory::WasmBlob, "big", b"123456", None);
        assert!(result.is_err(), "Entry exceeding max size should be rejected");
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("exceeds"),
            "Error message should mention 'exceeds', got: {err}"
        );

        // The entry must not have been written
        assert!(!store.contains(CacheCategory::WasmBlob, "big", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_entry_exactly_at_max_size_is_accepted() {
        let dir = std::env::temp_dir().join("grat_test_exact");
        let _ = std::fs::remove_dir_all(&dir);
        // max 5 bytes
        let store = CacheStore::with_max_size_bytes(dir.clone(), 5).unwrap();

        // Exactly 5 bytes — should be accepted
        let result = store.put(CacheCategory::WasmBlob, "exact", b"12345", None);
        assert!(result.is_ok(), "Entry of exactly max size should be accepted");
        assert!(store.contains(CacheCategory::WasmBlob, "exact", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── Eviction order (oldest accessed first) ────────────────────────────────

    #[test]
    fn test_eviction_order_oldest_accessed_first() {
        let dir = std::env::temp_dir().join("grat_test_evict_order");
        let _ = std::fs::remove_dir_all(&dir);
        // max 12 bytes to hold exactly 3 × 4-byte entries
        let store = CacheStore::with_max_size_bytes(dir.clone(), 12).unwrap();

        // Write three entries with deliberate timestamps (oldest → newest)
        store.put(CacheCategory::WasmBlob, "a", b"AAAA", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(15));
        store.put(CacheCategory::WasmBlob, "b", b"BBBB", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(15));
        store.put(CacheCategory::WasmBlob, "c", b"CCCC", None).unwrap();

        // All three fit
        assert!(store.contains(CacheCategory::WasmBlob, "a", None));
        assert!(store.contains(CacheCategory::WasmBlob, "b", None));
        assert!(store.contains(CacheCategory::WasmBlob, "c", None));

        // Adding a 4th entry forces eviction of the oldest ("a")
        std::thread::sleep(std::time::Duration::from_millis(15));
        store.put(CacheCategory::WasmBlob, "d", b"DDDD", None).unwrap();

        // "a" is oldest and should have been evicted
        assert!(!store.contains(CacheCategory::WasmBlob, "a", None));
        // "b", "c", "d" should still exist
        assert!(store.contains(CacheCategory::WasmBlob, "b", None));
        assert!(store.contains(CacheCategory::WasmBlob, "c", None));
        assert!(store.contains(CacheCategory::WasmBlob, "d", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── get() updates LRU order ───────────────────────────────────────────────

    #[test]
    fn test_get_updates_lru_order() {
        let dir = std::env::temp_dir().join("grat_test_get_lru");
        let _ = std::fs::remove_dir_all(&dir);
        // Exactly 8 bytes for 2 × 4-byte entries
        let store = CacheStore::with_max_size_bytes(dir.clone(), 8).unwrap();

        store.put(CacheCategory::WasmBlob, "old", b"XXXX", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(15));
        store.put(CacheCategory::WasmBlob, "new", b"YYYY", None).unwrap();

        // Both entries present
        assert!(store.contains(CacheCategory::WasmBlob, "old", None));
        assert!(store.contains(CacheCategory::WasmBlob, "new", None));

        // Access "old" to make it the most recently used
        std::thread::sleep(std::time::Duration::from_millis(15));
        let result = store.get(CacheCategory::WasmBlob, "old", None).unwrap();
        assert_eq!(result, Some(b"XXXX".to_vec()));

        // Now add another entry — "new" should be evicted (it's LRU now)
        std::thread::sleep(std::time::Duration::from_millis(15));
        store.put(CacheCategory::WasmBlob, "fresh", b"ZZZZ", None).unwrap();

        // "old" was touched most recently and should survive
        assert!(
            store.contains(CacheCategory::WasmBlob, "old", None),
            "old entry (recently accessed) should NOT have been evicted"
        );
        // "new" was the least recently accessed and should be gone
        assert!(
            !store.contains(CacheCategory::WasmBlob, "new", None),
            "new entry (least recently accessed) should have been evicted"
        );
        assert!(store.contains(CacheCategory::WasmBlob, "fresh", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── Concurrent access ─────────────────────────────────────────────────────

    #[test]
    fn test_concurrent_put_different_keys() {
        use std::sync::Arc;
        use std::thread;

        let dir = std::env::temp_dir().join("grat_test_concurrent");
        let _ = std::fs::remove_dir_all(&dir);
        // Plenty of room: 20 threads × 4 bytes each = 80 bytes, limit = 1 KB
        let store = Arc::new(CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap());

        let mut handles = Vec::new();
        for i in 0..20u32 {
            let store = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                let key = format!("thread-key-{i}");
                let val = format!("{i:04}").into_bytes();
                store
                    .put(CacheCategory::ContractSpec, &key, &val, None)
                    .expect("concurrent put should succeed");
            }));
        }

        for h in handles {
            h.join().expect("thread should not panic");
        }

        // All 20 entries should be present
        for i in 0..20u32 {
            let key = format!("thread-key-{i}");
            assert!(
                store.contains(CacheCategory::ContractSpec, &key, None),
                "key {key} should be present after concurrent writes"
            );
        }

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_concurrent_put_and_get() {
        use std::sync::Arc;
        use std::thread;

        let dir = std::env::temp_dir().join("grat_test_concurrent_rw");
        let _ = std::fs::remove_dir_all(&dir);
        let store = Arc::new(CacheStore::with_max_size_bytes(dir.clone(), 4096).unwrap());

        // Pre-populate keys
        for i in 0..10u32 {
            store
                .put(
                    CacheCategory::LedgerEntry,
                    &format!("rw-key-{i}"),
                    &format!("val{i}").into_bytes(),
                    None,
                )
                .unwrap();
        }

        // Spawn concurrent readers
        let mut handles = Vec::new();
        for i in 0..10u32 {
            let store = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                let key = format!("rw-key-{i}");
                let result = store
                    .get(CacheCategory::LedgerEntry, &key, None)
                    .expect("concurrent get should not error");
                assert!(result.is_some(), "key {key} should be found");
            }));
        }

        for h in handles {
            h.join().expect("reader thread should not panic");
        }

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── contains() returns false for missing keys ─────────────────────────────

    #[test]
    fn test_contains_returns_false_for_missing_key() {
        let dir = std::env::temp_dir().join("grat_test_contains_miss");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        assert!(!store.contains(CacheCategory::WasmBlob, "nonexistent", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── remove() makes an entry absent ───────────────────────────────────────

    #[test]
    fn test_remove_makes_entry_absent() {
        let dir = std::env::temp_dir().join("grat_test_remove");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store.put(CacheCategory::WasmBlob, "to_remove", b"data", None).unwrap();
        assert!(store.contains(CacheCategory::WasmBlob, "to_remove", None));

        store.remove(CacheCategory::WasmBlob, "to_remove", None).unwrap();
        assert!(!store.contains(CacheCategory::WasmBlob, "to_remove", None));
        assert_eq!(
            store.get(CacheCategory::WasmBlob, "to_remove", None).unwrap(),
            None
        );

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_remove_nonexistent_is_ok() {
        let dir = std::env::temp_dir().join("grat_test_remove_miss");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        // Removing a key that was never inserted should not error
        let result = store.remove(CacheCategory::WasmBlob, "ghost", None);
        assert!(result.is_ok());

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── Ledger sequence scoping ───────────────────────────────────────────────

    #[test]
    fn test_ledger_scoped_entries_are_isolated() {
        let dir = std::env::temp_dir().join("grat_test_ledger_scope");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store
            .put(CacheCategory::LedgerEntry, "state", b"ledger10", Some(10))
            .unwrap();
        store
            .put(CacheCategory::LedgerEntry, "state", b"ledger20", Some(20))
            .unwrap();

        let v10 = store
            .get(CacheCategory::LedgerEntry, "state", Some(10))
            .unwrap();
        let v20 = store
            .get(CacheCategory::LedgerEntry, "state", Some(20))
            .unwrap();
        let vmiss = store
            .get(CacheCategory::LedgerEntry, "state", Some(30))
            .unwrap();

        assert_eq!(v10, Some(b"ledger10".to_vec()));
        assert_eq!(v20, Some(b"ledger20".to_vec()));
        assert!(vmiss.is_none());

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prune_older_than_removes_stale_entries() {
        let dir = std::env::temp_dir().join("grat_test_prune");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store
            .put(CacheCategory::LedgerEntry, "old", b"1", Some(100))
            .unwrap();
        store
            .put(CacheCategory::LedgerEntry, "mid", b"2", Some(200))
            .unwrap();
        store
            .put(CacheCategory::LedgerEntry, "new", b"3", Some(300))
            .unwrap();

        store
            .prune_older_than(CacheCategory::LedgerEntry, 200)
            .unwrap();

        // ledger 100 < 200 → pruned
        assert!(!store.contains(CacheCategory::LedgerEntry, "old", Some(100)));
        // ledger 200 == 200 → NOT pruned (strictly less than)
        assert!(store.contains(CacheCategory::LedgerEntry, "mid", Some(200)));
        // ledger 300 > 200 → kept
        assert!(store.contains(CacheCategory::LedgerEntry, "new", Some(300)));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── clear() resets cache to empty ────────────────────────────────────────

    #[test]
    fn test_clear_removes_all_entries() {
        let dir = std::env::temp_dir().join("grat_test_clear_all");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store.put(CacheCategory::WasmBlob, "a", b"1", None).unwrap();
        store.put(CacheCategory::ContractSpec, "b", b"2", None).unwrap();
        store.put(CacheCategory::LedgerEntry, "c", b"3", Some(5)).unwrap();

        store.clear().unwrap();

        assert!(!store.contains(CacheCategory::WasmBlob, "a", None));
        assert!(!store.contains(CacheCategory::ContractSpec, "b", None));
        assert!(!store.contains(CacheCategory::LedgerEntry, "c", Some(5)));

        // Cache should still be usable after clear
        store.put(CacheCategory::WasmBlob, "after_clear", b"ok", None).unwrap();
        assert!(store.contains(CacheCategory::WasmBlob, "after_clear", None));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── Different categories are isolated from each other ─────────────────────

    #[test]
    fn test_categories_are_isolated() {
        let dir = std::env::temp_dir().join("grat_test_categories");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store
            .put(CacheCategory::WasmBlob, "shared_key", b"wasm", None)
            .unwrap();
        store
            .put(CacheCategory::ContractSpec, "shared_key", b"spec", None)
            .unwrap();

        let wasm = store
            .get(CacheCategory::WasmBlob, "shared_key", None)
            .unwrap();
        let spec = store
            .get(CacheCategory::ContractSpec, "shared_key", None)
            .unwrap();

        assert_eq!(wasm, Some(b"wasm".to_vec()));
        assert_eq!(spec, Some(b"spec".to_vec()));
        assert_ne!(wasm, spec);

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── Overwrite (put same key twice) ────────────────────────────────────────

    #[test]
    fn test_put_overwrites_existing_entry() {
        let dir = std::env::temp_dir().join("grat_test_overwrite");
        let _ = std::fs::remove_dir_all(&dir);
        let store = CacheStore::with_max_size_bytes(dir.clone(), 1024).unwrap();

        store
            .put(CacheCategory::WasmBlob, "key", b"first", None)
            .unwrap();
        store
            .put(CacheCategory::WasmBlob, "key", b"second", None)
            .unwrap();

        let result = store.get(CacheCategory::WasmBlob, "key", None).unwrap();
        assert_eq!(result, Some(b"second".to_vec()));

        store.clear().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }
}
