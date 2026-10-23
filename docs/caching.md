# Caching Layer Architecture

The `crates/core` crate includes a multi-tier caching system that reduces redundant network requests, expensive XDR decoding, and WASM compilation overhead. This document explains each tier, how cache keys are generated, how entries are invalidated, and how to configure the system.

---

## Overview

```
┌──────────────────────────────────────────────────────────┐
│                     Consumer Code                        │
│  (decoder, replayer, spec resolver, …)                   │
└──────────────────┬───────────────────────────────────────┘
                   │  CacheProvider trait
         ┌─────────┼──────────┐
         ▼         ▼          ▼
   ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │MemoryCache│ │DiskCache │ │  WasmCache   │
   │(DashMap)  │ │ (sled)   │ │ (SHA-256 key)│
   └──────────┘ └──────────┘ └──────────────┘
         │         │
         └────┬────┘
              ▼
       ┌─────────────┐
       │  CacheStore │  (filesystem, LRU eviction)
       └─────────────┘
```

All backends implement the `CacheProvider` trait, making them interchangeable. The `CacheStore` is a lower-level filesystem cache used directly by some subsystems.

---

## Tier 1: In-Memory Cache (`MemoryCache`)

**File:** `crates/core/src/cache/memory.rs`

### What it is

A high-frequency, low-latency cache backed by [`DashMap`](https://docs.rs/dashmap) — a concurrent, sharded hash map. Data lives entirely on the process heap and is lost when the process exits.

### When to use it

- Repeated lookups of the same decoded value within a single CLI invocation or HTTP request.
- Caching deserialized structs that are expensive to reconstruct from raw bytes.
- Any case where persistence across restarts is not required.

### Key characteristics

| Property | Value |
|---|---|
| Backend | `DashMap<String, Arc<[u8]>>` |
| Serialization | `bincode` |
| Persistence | None (process-lifetime only) |
| Thread-safety | Lock-free for distinct keys; shard-level locking for same key |
| Clone cost | Cheap — all clones share the same `Arc<DashMap>` |

### Usage

```rust
use grat_core::cache::memory::MemoryCache;
use grat_core::cache::provider::CacheProvider;

let cache = MemoryCache::new();

// Store any serde::Serialize value
cache.put("ledger:12345:entry", &my_ledger_entry).await?;

// Retrieve it (returns Ok(None) on miss, never an error)
let entry: Option<LedgerEntry> = cache.get("ledger:12345:entry").await?;

// Remove one entry
cache.remove("ledger:12345:entry").await?;

// Wipe everything
cache.clear().await?;
```

### Implementation notes

- Values are serialized with `bincode` before insertion; lookups clone only an `Arc` (atomic reference count bump) while the shard lock is held, then deserialize outside the lock.
- `DashMap`'s internal sharding means concurrent operations on different keys never contend.

---

## Tier 2: Disk Cache (`DiskCache`)

**File:** `crates/core/src/cache/disk.rs`

### What it is

A persistent cache backed by [`sled`](https://docs.rs/sled) — an embedded, lock-free B+tree database. Entries survive process restarts.

### When to use it

- Ledger state and transaction results fetched from the Stellar RPC — these are immutable once confirmed and expensive to re-fetch.
- Compiled contract specs parsed from WASM metadata.
- Any data that is slow to obtain but cheap to store.

### Key characteristics

| Property | Value |
|---|---|
| Backend | `sled` embedded B+tree |
| Serialization | `bincode` |
| Persistence | Survives restarts |
| Default location | Platform cache directory (see below) |
| Async I/O | `tokio::task::spawn_blocking` to avoid blocking the executor |

### Default cache location

```
Linux:   ~/.cache/grat/disk_cache/
macOS:   ~/Library/Caches/dev.grat.grat/disk_cache/
Windows: C:\Users\<User>\AppData\Local\grat\grat\cache\disk_cache\
```

Open at the default location:

```rust
use grat_core::cache::disk::DiskCache;

let cache = DiskCache::default_location()?;
```

Or at a custom path:

```rust
let cache = DiskCache::new("/var/cache/myapp/prism")?;
```

### Ledger-scoped keys

The disk cache supports an optional `ledger_sequence` parameter that namespaces entries by ledger. This allows efficient pruning of historical data:

```rust
// Store a ledger entry scoped to ledger 12345
cache.put("GABC...XYZ", &ledger_entry, Some(12345)).await?;

// Retrieve it (must provide the same ledger sequence)
let entry = cache.get::<LedgerEntry>("GABC...XYZ", Some(12345)).await?;

// Prune all entries older than ledger 12345
cache.prune_older_than(12345).await?;
```

### CacheProvider trait

`DiskCache` also implements `CacheProvider` using `None` as the ledger sequence. This makes it a drop-in replacement for `MemoryCache` in generic code:

```rust
fn build_cache() -> impl CacheProvider {
    DiskCache::default_location().unwrap()
}
```

### Flushing to disk

`sled` batches writes for performance. Call `flush()` explicitly if you need durability before a restart:

```rust
cache.flush().await?;
```

---

## Tier 3: WASM Cache (`WasmCache`)

**File:** `crates/core/src/cache/wasm.rs`

### What it is

A specialized cache for compiled WebAssembly modules, wrapping any `CacheProvider` with SHA-256–keyed lookups. It stores the output of the WASM compilation step so contracts don't need to be re-parsed on every invocation.

### When to use it

When invoking `soroban-env-host` with contract WASM — compilation is expensive and the bytecode rarely changes for a given contract version.

### Key generation

The cache key is the **SHA-256 hash** of the raw WASM bytecode:

```rust
pub fn hash_bytecode(bytecode: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytecode);
    hex::encode(hasher.finalize())
}
```

This means:
- Identical bytecode always maps to the same key.
- Any change to the bytecode (even one byte) produces a different key.
- There is no need for the caller to manage key naming.

### Usage

```rust
use grat_core::cache::wasm::WasmCache;
use grat_core::cache::memory::MemoryCache;

// Wrap any CacheProvider
let wasm_cache = WasmCache::new(MemoryCache::new());

let bytecode: &[u8] = &[ /* raw WASM bytes */ ];
let compiled: &[u8] = &[ /* compiled native module bytes */ ];

// Store compiled output keyed by bytecode hash
wasm_cache.put(bytecode, compiled).await?;

// Retrieve — returns None if not yet compiled
let cached: Option<Vec<u8>> = wasm_cache.get(bytecode).await?;
```

For persistent caching of compiled modules, back it with `DiskCache`:

```rust
let wasm_cache = WasmCache::new(DiskCache::default_location()?);
```

---

## Filesystem Cache Store (`CacheStore`)

**File:** `crates/core/src/cache/store.rs`

### What it is

A lower-level filesystem cache used by the CLI and core modules that need fine-grained control over file layout and LRU eviction. It organizes entries by **category** and optionally by **ledger sequence**.

### Cache categories

| Category | Constant | On-disk Directory | Stores |
|---|---|---|---|
| WASM blob | `WasmBlob` | `<cache_dir>/wasm/` | Raw WASM bytecode |
| Contract spec | `ContractSpec` | `<cache_dir>/spec/` | Parsed ABI specs |
| Ledger entry | `LedgerEntry` | `<cache_dir>/ledger/` | Ledger key-value pairs |
| Transaction result | `TransactionResult` | `<cache_dir>/tx/` | Raw transaction results |

### LRU eviction

When a new entry would exceed `max_size`, the store evicts the **least recently used** (LRU) file — the one with the oldest access or modification timestamp — until enough space is available.

```rust
use grat_core::cache::store::{CacheStore, CacheCategory};
use std::path::PathBuf;

// 512 MB limit
let store = CacheStore::new(PathBuf::from("/tmp/grat_cache"), 512)?;

// Store a WASM blob (no ledger scope)
store.put(CacheCategory::WasmBlob, "contract_hash_hex", &wasm_bytes, None)?;

// Retrieve it
let bytes: Option<Vec<u8>> = store.get(CacheCategory::WasmBlob, "contract_hash_hex", None)?;

// Store a ledger entry scoped to ledger 12345
store.put(CacheCategory::LedgerEntry, "GABC...XYZ", &entry_bytes, Some(12345))?;

// Prune ledger entries older than ledger 50000
store.prune_older_than(CacheCategory::LedgerEntry, 50000)?;
```

### Default location

```rust
let store = CacheStore::default_location()?;
// Equivalent to: ~/.cache/grat/  (Linux)
```

---

## `CacheProvider` Trait

**File:** `crates/core/src/cache/provider.rs`

All async backends implement this trait:

```rust
pub trait CacheProvider: Send + Sync {
    fn get<V>(&self, key: &str) -> impl Future<Output = GratResult<Option<V>>> + Send
    where
        V: DeserializeOwned + Send;

    fn put<V>(&self, key: &str, value: &V) -> impl Future<Output = GratResult<()>> + Send
    where
        V: Serialize + Sync;

    fn remove(&self, key: &str) -> impl Future<Output = GratResult<()>> + Send;

    fn clear(&self) -> impl Future<Output = GratResult<()>> + Send;
}
```

**Cache miss is not an error.** `get` returns `Ok(None)` on a miss. Only backend failures (I/O errors, deserialization mismatches) return `Err`.

To implement a custom backend:

```rust
use grat_core::cache::provider::CacheProvider;
use grat_core::error::GratResult;

struct MyRedisCache { /* ... */ }

impl CacheProvider for MyRedisCache {
    fn get<V>(&self, key: &str) -> impl Future<Output = GratResult<Option<V>>> + Send
    where V: serde::de::DeserializeOwned + Send
    {
        async move {
            // Fetch from Redis, deserialize, return Ok(None) on miss
            todo!()
        }
    }
    // ... implement put, remove, clear
}
```

---

## Cache Key Generation

| Subsystem | Key Format | Example |
|---|---|---|
| Ledger entries | `"<strkey>:<ledger_seq>"` (disk) or plain string (memory) | `"GABC...XYZ:12345"` |
| WASM modules | SHA-256 hex of raw bytecode | `"a3f2d1..."` |
| Transaction results | Transaction hash | `"deadbeef..."` |
| Contract specs | Contract ID (strkey) | `"CABC...XYZ"` |

The `DiskCache` uses a binary key format for ledger-scoped entries (`<big-endian u32>:<key string>`) to enable efficient prefix scans during pruning.

---

## Cache Invalidation

### Time-based (ledger sequence)

Both `DiskCache` and `CacheStore` support pruning entries associated with ledger sequences older than a given threshold:

```rust
// Remove all ledger-scoped entries before ledger 50000
disk_cache.prune_older_than(50000).await?;
cache_store.prune_older_than(CacheCategory::LedgerEntry, 50000)?;
```

This is the primary invalidation strategy for ledger data: Stellar ledgers are immutable, so entries are valid indefinitely for their specific ledger but can be pruned once historical access is no longer needed.

### Size-based (LRU eviction)

`CacheStore` automatically evicts the least-recently-used files when the total cache size would exceed `max_size`. Access timestamps are explicitly updated on every `get` call to maintain accurate LRU ordering even when the filesystem disables `atime` updates.

### Manual invalidation

Any tier supports targeted invalidation:

```rust
cache.remove("specific-key").await?;
cache.clear().await?;  // wipe everything
```

### WASM cache invalidation

Because the WASM cache key is a hash of the bytecode, invalidation is automatic: deploying an updated contract produces a different hash, so the old compiled module is never returned for new bytecode.

---

## Configuration

### `CacheStore` (filesystem)

```rust
// Custom path and max size in MB
let store = CacheStore::new(PathBuf::from("/data/prism/cache"), 1024)?;

// Custom path with exact byte limit
let store = CacheStore::with_max_size_bytes(PathBuf::from("/data/prism/cache"), 1_073_741_824)?;
```

### `DiskCache` (sled)

```rust
// Custom sled database path
let cache = DiskCache::new("/data/prism/sled_cache")?;
```

`sled` has its own internal configuration; for advanced tuning (flush frequency, cache size) consult the [sled documentation](https://docs.rs/sled).

### `MemoryCache`

`MemoryCache` has no configurable size limit — it grows until the process runs out of memory or until `clear()` is called. Size management is the responsibility of the caller.

---

## Choosing the Right Backend

| Scenario | Recommended Backend |
|---|---|
| Short-lived CLI invocation | `MemoryCache` |
| Long-running server / repeated queries | `DiskCache` + `MemoryCache` (L1/L2 pattern) |
| WASM module compilation caching | `WasmCache<DiskCache>` |
| Large raw file storage | `CacheStore` |
| Custom distributed cache | Implement `CacheProvider` |
