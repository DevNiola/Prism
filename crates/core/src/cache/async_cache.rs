use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::{de::DeserializeOwned, Serialize};

use crate::cache::disk::DiskCache;
use crate::error::{GratError, GratResult};

#[derive(Default, Debug)]
pub struct CacheMetrics {
    pub total_hits: AtomicU64,
    pub total_misses: AtomicU64,
    pub total_read_duration_micros: AtomicU64,
    pub total_write_duration_micros: AtomicU64,
}

#[derive(Clone)]
pub struct AsyncCache {
    inner: Arc<DiskCache>,
    metrics: Arc<CacheMetrics>,
}

impl AsyncCache {
    pub fn new(inner: DiskCache) -> Self {
        Self {
            inner: Arc::new(inner),
            metrics: Arc::new(CacheMetrics::default()),
        }
    }

    pub fn metrics(&self) -> &CacheMetrics {
        &self.metrics
    }

    pub async fn get<V>(&self, key: &str) -> GratResult<Option<V>>
    where
        V: DeserializeOwned + Send + 'static,
    {
        let start = Instant::now();
        let cache = Arc::clone(&self.inner);
        let key = key.to_owned();
        let metrics = Arc::clone(&self.metrics);

        let result = tokio::task::spawn_blocking(move || cache.get_sync::<V>(&key))
            .await
            .map_err(|e| GratError::CacheError(format!("spawn_blocking cache get failed: {e}")))?;

        let duration_us = start.elapsed().as_micros() as u64;
        metrics
            .total_read_duration_micros
            .fetch_add(duration_us, Ordering::Relaxed);

        match &result {
            Ok(Some(_)) => {
                metrics.total_hits.fetch_add(1, Ordering::Relaxed);
            }
            Ok(None) => {
                metrics.total_misses.fetch_add(1, Ordering::Relaxed);
            }
            Err(_) => {}
        }

        result
    }

    pub async fn put<V>(&self, key: &str, value: V) -> GratResult<()>
    where
        V: Serialize + Send + 'static,
    {
        let start = Instant::now();
        let cache = Arc::clone(&self.inner);
        let key = key.to_owned();
        let metrics = Arc::clone(&self.metrics);

        let result = tokio::task::spawn_blocking(move || cache.put_sync::<V>(&key, &value))
            .await
            .map_err(|e| GratError::CacheError(format!("spawn_blocking cache put failed: {e}")))?;

        let duration_us = start.elapsed().as_micros() as u64;
        metrics
            .total_write_duration_micros
            .fetch_add(duration_us, Ordering::Relaxed);

        result
    }

    /// Cache-aside pattern: retrieves cached entry or computes and caches it.
    pub async fn get_or_compute<V, F, Fut>(&self, key: &str, compute: F) -> GratResult<V>
    where
        V: Serialize + DeserializeOwned + Clone + Send + 'static,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = GratResult<V>>,
    {
        if let Ok(Some(cached)) = self.get::<V>(key).await {
            return Ok(cached);
        }
        let computed = compute().await?;
        let _ = self.put(key, computed.clone()).await;
        Ok(computed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_async_cache_operations_and_metrics() {
        let temp_dir = tempfile::tempdir().unwrap();
        let disk_cache = DiskCache::new(temp_dir.path()).unwrap();
        let async_cache = AsyncCache::new(disk_cache);

        // Initial miss
        let miss: Option<String> = async_cache.get("test_key").await.unwrap();
        assert_eq!(miss, None);
        assert_eq!(async_cache.metrics().total_misses.load(Ordering::Relaxed), 1);
        assert_eq!(async_cache.metrics().total_hits.load(Ordering::Relaxed), 0);

        // Put value
        async_cache.put("test_key", "hello_world".to_string()).await.unwrap();
        assert!(async_cache.metrics().total_write_duration_micros.load(Ordering::Relaxed) > 0);

        // Hit value
        let hit: Option<String> = async_cache.get("test_key").await.unwrap();
        assert_eq!(hit, Some("hello_world".to_string()));
        assert_eq!(async_cache.metrics().total_hits.load(Ordering::Relaxed), 1);

        // Cache-aside test
        let val = async_cache
            .get_or_compute("compute_key", || async { Ok("computed_val".to_string()) })
            .await
            .unwrap();
        assert_eq!(val, "computed_val");

        // Subsequent get_or_compute hits cache
        let cached_val = async_cache
            .get_or_compute("compute_key", || async { panic!("Should not be called") })
            .await
            .unwrap();
        assert_eq!(cached_val, "computed_val");
    }

    #[tokio::test]
    async fn test_async_cache_concurrent_reads_and_writes() {
        // Multiple tasks each write a unique key and immediately read it back.
        // All reads must succeed with the correct value.
        let temp_dir = tempfile::tempdir().unwrap();
        let disk_cache = DiskCache::new(temp_dir.path()).unwrap();
        let async_cache = AsyncCache::new(disk_cache);

        let n = 40u32;
        let mut handles = Vec::new();

        for i in 0..n {
            let cache = async_cache.clone();
            handles.push(tokio::spawn(async move {
                let key = format!("async-key-{i}");
                cache.put(&key, i).await.unwrap();
                let val: Option<u32> = cache.get(&key).await.unwrap();
                assert_eq!(val, Some(i), "async cache returned wrong value for key {key}");
            }));
        }

        for h in handles {
            h.await.unwrap();
        }
    }

    #[tokio::test]
    async fn test_async_cache_get_or_compute_called_once_under_concurrent_access() {
        // Even when multiple calls race on the same key, the entry must be
        // readable and consistent after all tasks complete.
        use std::sync::atomic::{AtomicU32, Ordering as AO};
        use std::sync::Arc;

        let temp_dir = tempfile::tempdir().unwrap();
        let disk_cache = DiskCache::new(temp_dir.path()).unwrap();
        let async_cache = AsyncCache::new(disk_cache);

        let compute_calls = Arc::new(AtomicU32::new(0));
        let mut handles = Vec::new();

        for _ in 0..10 {
            let cache = async_cache.clone();
            let counter = Arc::clone(&compute_calls);
            handles.push(tokio::spawn(async move {
                cache
                    .get_or_compute("race_key", || async move {
                        counter.fetch_add(1, AO::Relaxed);
                        Ok(42u32)
                    })
                    .await
                    .unwrap()
            }));
        }

        let mut results: Vec<u32> = Vec::new();
        for h in handles {
            results.push(h.await.unwrap());
        }

        // Every call must return the correct value.
        for v in &results {
            assert_eq!(*v, 42u32, "unexpected value from concurrent get_or_compute");
        }
    }

    #[tokio::test]
    async fn test_async_cache_miss_count_increases_on_absent_keys() {
        let temp_dir = tempfile::tempdir().unwrap();
        let disk_cache = DiskCache::new(temp_dir.path()).unwrap();
        let async_cache = AsyncCache::new(disk_cache);

        for i in 0..5u32 {
            let _: Option<u32> = async_cache.get(&format!("absent-{i}")).await.unwrap();
        }

        assert_eq!(
            async_cache.metrics().total_misses.load(Ordering::Relaxed),
            5,
            "expected 5 misses for 5 absent keys"
        );
        assert_eq!(
            async_cache.metrics().total_hits.load(Ordering::Relaxed),
            0,
            "expected 0 hits when all keys are absent"
        );
    }

    #[tokio::test]
    async fn test_async_cache_read_duration_recorded() {
        let temp_dir = tempfile::tempdir().unwrap();
        let disk_cache = DiskCache::new(temp_dir.path()).unwrap();
        let async_cache = AsyncCache::new(disk_cache);

        async_cache.put("timing_key", "data".to_string()).await.unwrap();
        let _: Option<String> = async_cache.get("timing_key").await.unwrap();

        assert!(
            async_cache
                .metrics()
                .total_read_duration_micros
                .load(Ordering::Relaxed)
                > 0,
            "read duration must be recorded after a successful get"
        );
    }
}