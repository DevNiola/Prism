# Network Configuration

This document explains how Prism (Grat) resolves and manages network connections for the Stellar Soroban ecosystem, covering the `NetworkConfig` structure, built-in network types, the CLI `--network` flag, the config file format, and how to add a custom local or private network.

---

## NetworkConfig Structure

`NetworkConfig` is defined in `crates/core/src/network/config.rs`. It holds everything Grat needs to talk to a Soroban RPC node and its associated history archives.

```rust
pub struct NetworkConfig {
    /// The logical network identity (Mainnet, Testnet, Futurenet, or Custom).
    pub network: Network,

    /// The Soroban JSON-RPC endpoint URL.
    pub rpc_url: String,

    /// The network passphrase used to sign and verify transactions.
    pub network_passphrase: String,

    /// Ordered list of Stellar History Archive base URLs used for state reconstruction.
    pub archive_urls: Vec<String>,

    /// Optional API key sent as a header on all RPC requests.
    pub api_key: Option<String>,

    /// Seconds before an RPC request times out. Default: 30.
    pub request_timeout_secs: u64,

    /// When true, every request bypasses the local disk cache.
    pub no_cache: bool,
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `network` | `Network` | `Testnet` | Logical network identifier |
| `rpc_url` | `String` | Network-specific | Soroban RPC endpoint |
| `network_passphrase` | `String` | Network-specific | Stellar network passphrase |
| `archive_urls` | `Vec<String>` | Network-specific | History archive base URLs |
| `api_key` | `Option<String>` | `None` | Bearer token for private RPC nodes |
| `request_timeout_secs` | `u64` | `30` | Request timeout in seconds |
| `no_cache` | `bool` | `false` | Bypass local cache when `true` |

---

## Network Enum

The `Network` enum identifies the target network. It serializes and deserializes as a plain string, making it suitable for TOML config files and JSON API responses.

```rust
pub enum Network {
    Mainnet,
    Testnet,   // default
    Futurenet,
    Custom(String),
}
```

### Built-in Network Constants

| Network | RPC URL | Network Passphrase |
|---|---|---|
| **Mainnet** | `https://soroban-mainnet.stellar.org` | `Public Global Stellar Network ; September 2015` |
| **Testnet** | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` |
| **Futurenet** | `https://rpc-futurenet.stellar.org` | `Test SDF Future Network ; October 2022` |
| **Local** (`Custom("local")`) | `http://127.0.0.1:8000/rpc` | `Standalone Network ; February 2017` |

---

## Network Name Aliases

The `Network::parse()` function accepts several aliases and is case-insensitive:

| Input | Resolved Network |
|---|---|
| `mainnet`, `main`, `pubnet`, `public` | `Network::Mainnet` |
| `testnet`, `test` | `Network::Testnet` |
| `futurenet`, `future` | `Network::Futurenet` |
| `local`, `localhost`, `standalone` | `Network::Custom("local")` |
| `http://...` or `https://...` | `Network::Custom(<url>)` (URL used as both name and RPC endpoint) |
| any other string | `Network::Custom(<string>)` (name only — you must supply RPC details in config) |

---

## CLI `--network` Flag

Every Grat command accepts a global `--network` flag (short: `-n`). The default is `testnet`.

```
grat [--network <NETWORK>] [--rpc-url <URL>] [--no-cache] [--config-path <PATH>] <SUBCOMMAND>
```

### Examples

**Decode an error on mainnet:**
```bash
grat --network mainnet decode <TX_HASH>
```

**Use testnet (default):**
```bash
grat decode <TX_HASH>
# equivalent to:
grat --network testnet decode <TX_HASH>
```

**Use futurenet:**
```bash
grat --network futurenet trace <TX_HASH>
```

**Point directly at a custom RPC node by URL:**
```bash
grat --network http://127.0.0.1:8000/rpc decode <TX_HASH>
```

**Override only the RPC URL while keeping the named network's passphrase and archives:**
```bash
grat --network testnet --rpc-url https://my-testnet-rpc.example.com decode <TX_HASH>
```

**Bypass cache for a fresh fetch:**
```bash
grat --network mainnet --no-cache decode <TX_HASH>
```

### Resolution Order

When Grat resolves the final `NetworkConfig` for a command:

1. `--network` value is parsed into a `Network` variant (aliases applied).
2. The built-in defaults for that variant are loaded (RPC URL, passphrase, archives).
3. If `--rpc-url` is provided, it **overrides** the network's default `rpc_url`.
4. If `--no-cache` is set, `NetworkConfig::no_cache` is set to `true`.
5. If a matching named network entry exists in `~/.grat/config.toml`, those values are used instead of built-in defaults.

---

## Config File (`~/.grat/config.toml`)

Grat reads a TOML config file at `~/.grat/config.toml` on startup. Use `--config-path` to specify an alternate path.

```bash
grat --config-path /path/to/custom-config.toml decode <TX_HASH>
```

### Full Config File Structure

```toml
# The network used when no --network flag is given.
default_network = "testnet"

# Directory for the local cache. Defaults to OS cache directory.
# cache_dir = "/tmp/grat-cache"

# Maximum cache size in megabytes.
max_cache_size_mb = 512

# ─── Built-in network overrides ──────────────────────────────────────────────
# You can override any field of a built-in network. Fields you omit keep their
# default values.

[[networks]]
network = "testnet"
rpc_url = "https://soroban-testnet.stellar.org"
network_passphrase = "Test SDF Network ; September 2015"
archive_urls = ["https://history.stellar.org/prd/core-testnet/core_testnet_001"]
request_timeout_secs = 30

[[networks]]
network = "mainnet"
rpc_url = "https://soroban-mainnet.stellar.org"
network_passphrase = "Public Global Stellar Network ; September 2015"
archive_urls = ["https://history.stellar.org/prd/core-live/core_live_001"]
request_timeout_secs = 30

[[networks]]
network = "futurenet"
rpc_url = "https://rpc-futurenet.stellar.org"
network_passphrase = "Test SDF Future Network ; October 2022"
archive_urls = ["https://history-futurenet.stellar.org"]
request_timeout_secs = 30
```

---

## Adding a Custom Network

A **custom network** is any network whose name is not one of the three built-ins. This is useful for:

- A local Stellar Quickstart node during development
- A private devnet or staging environment
- A third-party RPC provider with a non-standard URL

### Example 1 — Local Quickstart Node

Run the standard Stellar Quickstart Docker image:

```bash
docker run --rm -it \
  -p 8000:8000 \
  stellar/quickstart:latest \
  --standalone \
  --enable-soroban-rpc
```

Add the following to `~/.grat/config.toml`:

```toml
default_network = "local"

[[networks]]
network = "local"
rpc_url = "http://127.0.0.1:8000/rpc"
network_passphrase = "Standalone Network ; February 2017"
archive_urls = []
request_timeout_secs = 10
no_cache = true
```

Then run any Grat command against it:

```bash
grat --network local decode <TX_HASH>
# or, since default_network = "local":
grat decode <TX_HASH>
```

### Example 2 — Private Devnet

```toml
default_network = "devnet"

[[networks]]
network = "devnet"
rpc_url = "https://rpc.devnet.example.com"
network_passphrase = "My Private Devnet ; 2024"
archive_urls = ["https://archives.devnet.example.com"]
api_key = "sk-your-private-api-key"
request_timeout_secs = 60
```

```bash
grat --network devnet trace <TX_HASH>
```

### Example 3 — Inline URL Without a Config Entry

For a quick one-off test, pass the RPC URL directly as the network name:

```bash
grat --network https://rpc.devnet.example.com decode <TX_HASH>
```

Grat will use that URL as both the network identifier and the RPC endpoint. The network passphrase and archive URLs will be empty; if you need them for replay commands, use a full config entry instead.

---

## Config File Precedence

| Source | Wins over |
|---|---|
| `--rpc-url` flag | Everything — always overrides the resolved `rpc_url` |
| Named entry in `~/.grat/config.toml` | Built-in network defaults |
| Built-in network defaults | Nothing — lowest priority |

---

## `GratConfig` Reference

The top-level config struct (`crates/core/src/types/config.rs`) that maps to the TOML file:

```rust
pub struct GratConfig {
    /// Fallback network when --network is not specified.
    pub default_network: Network,

    /// Per-network configuration entries.
    pub networks: Vec<NetworkConfig>,

    /// Override for the local cache directory.
    pub cache_dir: Option<String>,

    /// Maximum disk space the local cache may use (megabytes).
    pub max_cache_size_mb: u64,
}
```

Default values when no config file exists:

| Field | Default |
|---|---|
| `default_network` | `testnet` |
| `networks` | testnet, mainnet, futurenet, local (all with built-in defaults) |
| `cache_dir` | OS cache directory |
| `max_cache_size_mb` | `512` |

---

## Verifying Network Connectivity

Grat can probe a network's health before running a command. This is done automatically in some scenarios, but you can also run it manually via the Rust API:

```rust
use grat_core::network::config::{NetworkConfig, validate_network};

let config = NetworkConfig::testnet();
let is_healthy = validate_network(&config).await;
println!("Testnet reachable: {is_healthy}");
```

The probe sends a `getHealth` JSON-RPC call to the configured `rpc_url` and returns `true` if the node responds successfully.

---

## Troubleshooting

**`error: network selector cannot be empty`**
You passed an empty string to `--network`. Specify a valid network name or URL.

**RPC requests time out immediately on `--network local`**
Make sure your local node is running and listening on `http://127.0.0.1:8000/rpc`. If you changed the port, update `rpc_url` in your config file or use `--rpc-url`.

**`Unknown network, defaulting to testnet`** (warning log)
Grat could not find a config entry for the requested custom network name. It fell back to testnet. Add a matching `[[networks]]` entry to your config file.

**`Failed to parse config file … as TOML`**
Your config file has a syntax error. Validate it with `taplo lint ~/.grat/config.toml` or check the TOML spec at <https://toml.io>.
