# Troubleshooting Guide

This guide covers the most common errors users encounter when running Grat, explains why each error happens, and shows exactly how to fix it. If your problem is not listed here, see [Reporting Bugs](#reporting-bugs) at the bottom of this page.

---

## Table of Contents

1. [RPC Node Unavailable / Network Timeout](#1-rpc-node-unavailable--network-timeout)
2. [Transaction Not Found](#2-transaction-not-found)
3. [Malformed or Invalid XDR](#3-malformed-or-invalid-xdr)
4. [Unsupported or Unknown Error Code](#4-unsupported-or-unknown-error-code)
5. [Transaction Succeeded — Nothing to Decode](#5-transaction-succeeded--nothing-to-decode)
6. [Not a Soroban Transaction](#6-not-a-soroban-transaction)
7. [Contract Not Found / WASM Fetch Failed](#7-contract-not-found--wasm-fetch-failed)
8. [State Reconstruction Failed (Replay)](#8-state-reconstruction-failed-replay)
9. [Cache Errors](#9-cache-errors)
10. [Config File Parse Error](#10-config-file-parse-error)

---

## 1. RPC Node Unavailable / Network Timeout

### Error messages

```
Error: RPC request timed out after 30s (method: getTransaction)
Error: RPC error: connection refused (http://127.0.0.1:8000/rpc)
Error: RPC error: 503 Service Unavailable
```

### Why it happens

- The Soroban RPC node at the configured `rpc_url` is unreachable, overloaded, or has gone offline.
- You are pointing at a local node (`http://127.0.0.1:8000/rpc`) that is not running.
- A third-party RPC provider is rate-limiting your requests.
- Your machine has no internet access and you are targeting a public network.

### How to fix it

**Check that the node is up:**
```bash
curl -s https://soroban-testnet.stellar.org/health
# expected: {"status":"healthy"}
```

**Switch to a different RPC endpoint:**
```bash
grat --rpc-url https://soroban-testnet.stellar.org decode <TX_HASH>
```

**Increase the timeout** in `~/.grat/config.toml`:
```toml
[[networks]]
network = "testnet"
rpc_url = "https://soroban-testnet.stellar.org"
request_timeout_secs = 60
```

**For local nodes**, make sure your Quickstart container is running:
```bash
docker ps | grep quickstart
# If missing, restart it:
docker run --rm -it -p 8000:8000 stellar/quickstart:latest --standalone --enable-soroban-rpc
```

---

## 2. Transaction Not Found

### Error message

```
Error: Transaction not found: <TX_HASH>
```

### Why it happens

- The transaction hash is incorrect (typo, wrong case, or truncated).
- You are querying the wrong network — the transaction is on mainnet but you are querying testnet (or vice versa).
- The transaction is too old to be in the RPC node's retention window (default: 17 280 ledgers ≈ 24 hours). Older transactions require history archive access.
- The RPC node has not yet ingested the ledger containing this transaction (very recent transactions).

### How to fix it

**Verify the network:**
```bash
# Mainnet transaction
grat --network mainnet decode <TX_HASH>

# Testnet transaction
grat --network testnet decode <TX_HASH>
```

**Double-check the hash** — transaction hashes are 64 hex characters:
```bash
echo -n "<TX_HASH>" | wc -c
# should print 64
```

**Wait for ingestion** — if the transaction was just submitted, wait ~10 seconds and retry.

**For old transactions**, enable the history archive path by ensuring `archive_urls` is set in your network config (it is set by default for mainnet, testnet, and futurenet).

---

## 3. Malformed or Invalid XDR

### Error messages

```
Error: XDR error: unexpected end of input
Error: XDR decoding failed for TransactionResultPair: invalid enum discriminant
Error: invalid JSON input: expected value at line 1 column 1
```

### Why it happens

- The XDR string passed to `--xdr` is truncated, corrupted, or incorrectly base64-encoded.
- A copy/paste of the XDR dropped characters or introduced whitespace.
- The XDR was encoded for a different protocol version than the one Grat expects.

### How to fix it

**Always copy the full XDR** — it is a long base64 string with no spaces or newlines.

**Validate base64 encoding:**
```bash
echo "<XDR_STRING>" | base64 --decode | xxd | head -5
# should show recognizable XDR structure bytes (0x00 0x00 0x00 0x...)
```

**Use the transaction hash instead of raw XDR** when possible — Grat fetches and decodes XDR automatically:
```bash
grat decode <TX_HASH>
# instead of:
grat decode --xdr <LONG_XDR_STRING>
```

**Enable verbose logging** to see the exact decode step that fails:
```bash
grat -vv decode <TX_HASH> 2>&1 | head -50
```

---

## 4. Unsupported or Unknown Error Code

### Error messages

```
Warning: No taxonomy entry found for error code: wasm(7)
Warning: Unknown host error type: value(12)
```

### Why it happens

- A Soroban protocol upgrade introduced a new error code that the local taxonomy database does not yet know about.
- The taxonomy database file is outdated.

### How to fix it

**Update the taxonomy database:**
```bash
grat db update
```

This fetches the latest `enhanced_error_taxonomy.toml` from the Grat repository. You need internet access for this command.

**Check the current taxonomy version:**
```bash
grat db update --check
```

**Force an offline decode** — Grat will still report the raw error code even without a taxonomy match:
```bash
grat --offline decode <TX_HASH>
```

If the error code is genuinely new, consider [contributing a taxonomy entry](./contributing-taxonomy.md) so future users benefit from the description.

---

## 5. Transaction Succeeded — Nothing to Decode

### Error message

```
Error: Transaction succeeded — no error to decode
```

### Why it happens

You ran `grat decode` on a transaction that completed successfully. There is no error to explain.

### How to fix it

This is not a bug — it is a guard to prevent confusing output on successful transactions.

- If you are looking for resource usage, use `grat profile` instead:
  ```bash
  grat profile <TX_HASH>
  ```
- If you want a full execution trace of a successful transaction, use `grat trace`:
  ```bash
  grat trace <TX_HASH>
  ```
- If you believe the transaction should have failed, double-check the hash or network.

---

## 6. Not a Soroban Transaction

### Error message

```
Error: Not a Soroban transaction: no InvokeHostFunction operation found
```

### Why it happens

The transaction hash refers to a classic Stellar transaction (e.g., a payment, account creation, or trustline operation) rather than a Soroban smart contract invocation.

### How to fix it

Grat only decodes Soroban transactions. Verify the transaction on a Stellar explorer:

- **Mainnet:** https://stellar.expert/explorer/public/tx/`<TX_HASH>`
- **Testnet:** https://stellar.expert/explorer/testnet/tx/`<TX_HASH>`

Look for an `InvokeHostFunction` operation type. If the transaction does not contain one, it is a classic transaction and outside Grat's scope.

---

## 7. Contract Not Found / WASM Fetch Failed

### Error messages

```
Error: Contract not found: CABC...XYZ
Error: Archive error: failed to fetch 'contracts/CABC...XYZ.wasm' from all archive backends
```

### Why it happens

- The contract ID is incorrect.
- The contract was deployed on a different network than the one you specified.
- The contract's WASM bytecode is not available from the RPC node (e.g., it was deployed before the node's retention window).
- The history archive is temporarily unavailable.

### How to fix it

**Verify the contract exists on the correct network:**
```bash
grat --network mainnet inspect <CONTRACT_ID>
```

**Try without custom error resolution** — Grat will still decode the numeric error code:
```bash
grat decode <TX_HASH>
# Custom error names like "InsufficientBalance" may show as "#3" but the report is still useful
```

**Check archive availability:**
```bash
curl -s https://history.stellar.org/prd/core-testnet/core_testnet_001/.well-known/stellar-history.json | head -5
```

If the archive is unreachable, wait a few minutes and retry, or configure an alternative archive URL in `~/.grat/config.toml`.

---

## 8. State Reconstruction Failed (Replay)

### Error messages

```
Error: Replay error: failed to reconstruct ledger state at sequence 49523801
Error: Archive error: checksum mismatch for 'ledger/00/2f/43/ledger-00002f43.xdr.gz'
Error: Archive error: decompression failed for 'bucket/...': unexpected EOF
```

### Why it happens

- The transaction is from a ledger that is older than the RPC node's hot path window (approximately last 50 000 ledgers) and the history archive fetch failed.
- A history archive returned a corrupted file (checksum mismatch).
- The history archive server is temporarily offline or rate-limiting requests.
- Network interruption mid-download of a large archive snapshot.

### How to fix it

**Retry the command** — transient network issues often resolve themselves:
```bash
grat trace <TX_HASH>
```

**Bypass the cache** — a stale cached partial download can cause this:
```bash
grat --no-cache trace <TX_HASH>
```

**Add a redundant archive URL** in `~/.grat/config.toml`:
```toml
[[networks]]
network = "mainnet"
archive_urls = [
  "https://history.stellar.org/prd/core-live/core_live_001",
  "https://history.stellar.org/prd/core-live/core_live_002",
  "https://history.stellar.org/prd/core-live/core_live_003"
]
```

**Enable verbose logging** to see which archive step fails:
```bash
grat -vv trace <TX_HASH> 2>&1 | grep -i archive
```

For checksum mismatch errors, the archive file is corrupted on the server side. This is rare but can occur; try a different archive URL or wait for the archive operator to fix the issue.

---

## 9. Cache Errors

### Error messages

```
Error: Cache error: failed to write entry for key '...': disk quota exceeded
Error: Cache entry for key '...' (524288 bytes) exceeds capacity limit of 524288000 bytes
Error: Cache error: failed to deserialize cache value for key '...': invalid MessagePack data
```

### Why it happens

- The local disk cache has hit its configured size limit.
- The cache directory's filesystem is full.
- A previous Grat version wrote cache entries in a format incompatible with the current version.

### How to fix it

**Clear the entire cache:**
```bash
grat clean
```

**Clear only stale entries** (keeps recent results):
```bash
grat clean --stale
```

**Increase the cache size limit** in `~/.grat/config.toml`:
```toml
max_cache_size_mb = 1024
```

**Move the cache to a larger disk:**
```toml
cache_dir = "/mnt/large-disk/grat-cache"
```

**Bypass the cache for a single command:**
```bash
grat --no-cache decode <TX_HASH>
```

If the issue is a deserialization error from a format mismatch after upgrading Grat, run `grat clean` to wipe the old-format entries.

---

## 10. Config File Parse Error

### Error messages

```
Error: Failed to parse config file /home/user/.grat/config.toml as TOML: expected newline, found 'n' at line 7 column 3
Error: Failed to parse config file ...: missing field `network`
```

### Why it happens

- The TOML config file has a syntax error (missing quotes, invalid key, etc.).
- A required field in a `[[networks]]` entry is missing.
- You edited the file manually and introduced a typo.

### How to fix it

**Validate the TOML syntax** using the `taplo` formatter/linter (optional but helpful):
```bash
# Install taplo (optional)
cargo install taplo-cli
taplo lint ~/.grat/config.toml
```

**Check with `toml` directly:**
```bash
python3 -c "import tomllib; tomllib.load(open('$HOME/.grat/config.toml', 'rb'))"
```

**Common TOML mistakes:**
```toml
# ✗ Wrong — string values must be quoted
rpc_url = https://soroban-testnet.stellar.org

# ✓ Correct
rpc_url = "https://soroban-testnet.stellar.org"

# ✗ Wrong — no_cache is a boolean, not a string
no_cache = "true"

# ✓ Correct
no_cache = true

# ✗ Wrong — each network needs the network field
[[networks]]
rpc_url = "https://soroban-testnet.stellar.org"

# ✓ Correct
[[networks]]
network = "testnet"
rpc_url = "https://soroban-testnet.stellar.org"
```

**Reset to defaults** by deleting the config file:
```bash
rm ~/.grat/config.toml
# Grat will use built-in defaults on next run
```

---

## Enabling Debug Logging

For any issue not immediately obvious from the error message, enable verbose logging to get a detailed trace of what Grat is doing internally.

### Verbosity Levels

| Flag | Level | What is shown |
|---|---|---|
| (none) | `WARN` | Errors and warnings only |
| `-v` | `DEBUG` | Network requests, cache hits/misses, decode steps |
| `-vv` | `TRACE` | Everything including internal state, XDR bytes, archive chunk downloads |

### Usage

```bash
# Debug level
grat -v decode <TX_HASH>

# Trace level (very verbose — redirect to file for readability)
grat -vv trace <TX_HASH> 2> grat-trace.log
cat grat-trace.log
```

All log output goes to **stderr**, so it does not interfere with `--output json` or `--save` redirection.

### Environment Variable Override

You can also control log levels via the `RUST_LOG` environment variable for fine-grained control:

```bash
# Show only network module at trace level
RUST_LOG=grat_core::rpc=trace grat decode <TX_HASH>

# Show everything at debug
RUST_LOG=debug grat trace <TX_HASH>
```

---

## Reporting Bugs

If you have worked through the steps above and the problem persists, please file a bug report.

### Before You File

1. **Reproduce on the latest version:**
   ```bash
   grat --version
   ```
   Check [GitHub Releases](https://github.com/DevNiola/Prism/releases) for the current version.

2. **Update the taxonomy database:**
   ```bash
   grat db update
   ```

3. **Collect a debug log:**
   ```bash
   grat -vv <SUBCOMMAND> <ARGS> 2> grat-debug.log
   ```

### What to Include in the Bug Report

Please include all of the following in your issue:

- **Grat version:** output of `grat --version`
- **Operating system and version:** e.g., Ubuntu 24.04, macOS 14.5
- **Network:** mainnet / testnet / futurenet / custom
- **Transaction hash:** the full 64-character hex hash (or a reproducible example)
- **Full error message:** exact text from stderr
- **Debug log:** the `grat-debug.log` file from step 3 above (redact any API keys)
- **Config file:** contents of `~/.grat/config.toml` with API keys removed

### Filing the Issue

Open a new issue at: **https://github.com/DevNiola/Prism/issues/new**

Use the label **`bug`** and the title format: `[bug] <short description of the problem>`.

> **Do not include private keys, API keys, or account secrets in bug reports.**
> Redact them with `<REDACTED>` before posting.
