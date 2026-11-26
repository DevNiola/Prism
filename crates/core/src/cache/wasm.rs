use crate::cache::provider::CacheProvider;
use crate::error::GratResult;
use sha2::{Digest, Sha256};

/// Specialized cache for compiled WebAssembly modules.
///
/// Cache keys are the **SHA-256 hash** of the raw WASM bytecode, not the
/// contract id. This means:
///
/// - Identical bytecode always maps to the same key (content-addressable).
/// - Any change to the bytecode — including a full contract redeployment under
///   the same contract id — produces a different hash and therefore a different
///   cache entry. Stale compiled modules are never returned for new bytecode.
/// - The caller does not need to manage key naming or perform explicit
///   invalidation on redeployment.
///
/// # Cache invalidation
///
/// Because the key is derived entirely from the bytecode hash, invalidation is
/// automatic: deploying new bytecode under an existing contract id results in a
/// cache miss, triggering a fresh compilation. The old entry for the previous
/// bytecode remains in the backing store until it is evicted by TTL or LRU
/// pressure, but it will never be served for the new bytecode.
pub struct WasmCache<P: CacheProvider> {
    provider: P,
}

impl<P: CacheProvider> WasmCache<P> {
    /// Creates a new WasmCache wrapping the given cache provider.
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    /// Computes the SHA-256 hash of the given bytecode to be used as a cache key.
    ///
    /// The returned string is the lowercase hex encoding of the 32-byte digest,
    /// e.g. `"a3f2d1..."`. Two distinct byte slices with identical content
    /// always produce the same key; a one-byte difference produces a completely
    /// different key.
    pub fn hash_bytecode(bytecode: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytecode);
        hex::encode(hasher.finalize())
    }

    /// Retrieves a cached compiled Wasm module for the given original bytecode.
    ///
    /// The lookup key is derived from the **SHA-256 hash of `bytecode`**, not
    /// from any contract identifier. Passing different bytecode (e.g. from a
    /// redeployed contract) will always produce a cache miss, even if the
    /// contract id is the same.
    pub async fn get(&self, bytecode: &[u8]) -> GratResult<Option<Vec<u8>>> {
        let key = Self::hash_bytecode(bytecode);
        self.provider.get(&key).await
    }

    /// Stores a compiled Wasm module into the cache, keyed by the SHA-256 hash
    /// of the original bytecode.
    ///
    /// If a previous version of the contract was stored under a different
    /// bytecode hash, it occupies a different cache slot and will not interfere
    /// with this entry.
    pub async fn put(&self, bytecode: &[u8], compiled_module: &[u8]) -> GratResult<()> {
        let key = Self::hash_bytecode(bytecode);
        self.provider.put(&key, &compiled_module.to_vec()).await
    }

    /// Clears the underlying cache.
    pub async fn clear(&self) -> GratResult<()> {
        self.provider.clear().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::provider::CacheProvider;
    use crate::error::GratResult;
    use serde::{de::DeserializeOwned, Serialize};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct InMemoryCacheDouble {
        entries: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl InMemoryCacheDouble {
        fn new() -> Self {
            Self::default()
        }

        /// Returns every key currently stored in the cache.
        fn keys(&self) -> Vec<String> {
            self.entries.lock().unwrap().keys().cloned().collect()
        }
    }

    impl CacheProvider for InMemoryCacheDouble {
        async fn get<V>(&self, key: &str) -> GratResult<Option<V>>
        where
            V: DeserializeOwned + Send,
        {
            let bytes = self.entries.lock().unwrap().get(key).cloned();
            match bytes {
                Some(bytes) => {
                    let value = serde_json::from_slice(&bytes).unwrap();
                    Ok(Some(value))
                }
                None => Ok(None),
            }
        }

        async fn put<V>(&self, key: &str, value: &V) -> GratResult<()>
        where
            V: Serialize + Sync,
        {
            let encoded = serde_json::to_vec(value).unwrap();
            self.entries
                .lock()
                .unwrap()
                .insert(key.to_string(), encoded);
            Ok(())
        }

        async fn remove(&self, key: &str) -> GratResult<()> {
            self.entries.lock().unwrap().remove(key);
            Ok(())
        }

        async fn clear(&self) -> GratResult<()> {
            self.entries.lock().unwrap().clear();
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_wasm_cache_roundtrip() {
        let provider = InMemoryCacheDouble::new();
        let cache = WasmCache::new(provider);

        let bytecode = b"dummy wasm module";
        let compiled = b"compiled native code";

        // Should be empty initially
        assert_eq!(cache.get(bytecode).await.unwrap(), None);

        // Put into cache
        cache.put(bytecode, compiled).await.unwrap();

        // Should retrieve exactly the compiled bytecode
        let retrieved = cache.get(bytecode).await.unwrap();
        assert_eq!(retrieved, Some(compiled.to_vec()));
    }

    #[tokio::test]
    async fn test_wasm_cache_hash_consistency() {
        let bytecode = b"test bytes";
        let hash1 = WasmCache::<InMemoryCacheDouble>::hash_bytecode(bytecode);
        let hash2 = WasmCache::<InMemoryCacheDouble>::hash_bytecode(bytecode);
        assert_eq!(hash1, hash2);

        let hash3 = WasmCache::<InMemoryCacheDouble>::hash_bytecode(b"other bytes");
        assert_ne!(hash1, hash3);
    }

    /// The cache key must be derived from the WASM hash, not from any
    /// caller-supplied contract identifier.  Two calls that supply different
    /// bytecode should use different keys even when the logical "contract id"
    /// would be the same.
    #[tokio::test]
    async fn test_cache_key_is_hash_of_bytecode_not_contract_id() {
        let provider = InMemoryCacheDouble::new();
        let cache = WasmCache::new(provider);

        let bytecode_v1: &[u8] = b"\x00asm\x01\x00\x00\x00contract_v1";
        let bytecode_v2: &[u8] = b"\x00asm\x01\x00\x00\x00contract_v2";

        let hash_v1 = WasmCache::<InMemoryCacheDouble>::hash_bytecode(bytecode_v1);
        let hash_v2 = WasmCache::<InMemoryCacheDouble>::hash_bytecode(bytecode_v2);

        // Different bytecode must produce different keys.
        assert_ne!(hash_v1, hash_v2, "distinct bytecode must yield distinct cache keys");

        // Keys must be non-empty hex strings (SHA-256 produces 64 hex chars).
        assert_eq!(hash_v1.len(), 64);
        assert_eq!(hash_v2.len(), 64);
        assert!(hash_v1.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(hash_v2.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Redeploying different bytecode under the same conceptual contract id
    /// must return fresh spec data (cache miss) rather than the previously
    /// compiled module.
    #[tokio::test]
    async fn test_redeploy_same_id_different_bytecode_returns_fresh_data() {
        let provider = InMemoryCacheDouble::new();
        let cache = WasmCache::new(provider);

        // "Deploy" version 1: compile and cache it.
        let bytecode_v1: &[u8] = b"\x00asm\x01\x00\x00\x00spec_v1";
        let compiled_v1: &[u8] = b"compiled_spec_v1";
        cache.put(bytecode_v1, compiled_v1).await.unwrap();

        // The contract is redeployed (same id, new bytecode).
        let bytecode_v2: &[u8] = b"\x00asm\x01\x00\x00\x00spec_v2";
        let compiled_v2: &[u8] = b"compiled_spec_v2";

        // Before caching v2, the new bytecode must produce a cache miss.
        assert_eq!(
            cache.get(bytecode_v2).await.unwrap(),
            None,
            "new bytecode must miss even though v1 is cached"
        );

        // The old bytecode still hits the cache.
        assert_eq!(
            cache.get(bytecode_v1).await.unwrap(),
            Some(compiled_v1.to_vec()),
            "old bytecode must still resolve from cache"
        );

        // Cache the new compilation result.
        cache.put(bytecode_v2, compiled_v2).await.unwrap();

        // Now v2 resolves to its own compiled module, not v1's.
        assert_eq!(
            cache.get(bytecode_v2).await.unwrap(),
            Some(compiled_v2.to_vec()),
            "new bytecode must resolve to its own compiled module"
        );
        assert_eq!(
            cache.get(bytecode_v1).await.unwrap(),
            Some(compiled_v1.to_vec()),
            "old bytecode must still resolve to the old compiled module"
        );
    }

    /// The backing store must hold exactly one entry per distinct bytecode
    /// hash. Two `put` calls for the same bytecode overwrite the same slot;
    /// two `put` calls for different bytecode occupy separate slots.
    #[tokio::test]
    async fn test_separate_cache_slots_per_bytecode_version() {
        let provider = InMemoryCacheDouble::new();
        let cache = WasmCache::new(provider);

        let bytecode_a: &[u8] = b"wasm_a";
        let bytecode_b: &[u8] = b"wasm_b";

        cache.put(bytecode_a, b"compiled_a").await.unwrap();
        cache.put(bytecode_b, b"compiled_b").await.unwrap();

        // The underlying provider must have exactly two distinct entries.
        let keys = cache.provider.keys();
        assert_eq!(keys.len(), 2, "each bytecode version occupies its own cache slot");

        // Each slot resolves to the correct module.
        assert_eq!(cache.get(bytecode_a).await.unwrap(), Some(b"compiled_a".to_vec()));
        assert_eq!(cache.get(bytecode_b).await.unwrap(), Some(b"compiled_b".to_vec()));
    }
}
