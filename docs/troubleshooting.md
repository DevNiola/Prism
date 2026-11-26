# Troubleshooting Guide

This guide covers the most common errors users encounter when running Grat, explains why each error happens, and shows exactly how to fix it. If your problem is not listed here, see [Reporting Bugs](#reporting-bugs) at the bottom of this page.

---

## Common RPC and replay errors

Use the [CLI decode reference](./cli/decode.mdx) for a failure report by
transaction hash and the [CLI inspect reference](./cli/inspect.mdx) to focus
on an operation with `--op-index`. The [error taxonomy](./concepts/error-taxonomy.mdx)
explains Soroban host errors, including auth failures. Transport, archive
and XDR errors can occur before a host error is available to classify.

### Network timeout or connection failure

**Symptom.** `RPC request timed out after 30s (method: getTransaction)`
(`GratError::NetworkTimeout`) or an RPC connection refused error.

**Cause.** The node is unreachable, overloaded, or still starting. For a
local node, the RPC port may be unpublished or reachable only from a different
container.

**Fix.** Check the configured endpoint with a JSON-RPC `getHealth` request:

```bash
curl -fsS http://127.0.0.1:8000/rpc \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

If connectivity still fails, retry with another endpoint on the same
network. Use `--network <NETWORK>` (or `-n`) to select the network and
`--rpc-url <URL>` to override the endpoint. Add `--no-cache` for a fresh
fetch. `--config-path <PATH>` selects an alternate TOML file for validation,
while the CLI flags supply the network and RPC used by the command.
See [network configuration](./network-config.md).

### RPC errors and missing transactions

**Symptom.** `RPC error:`, `JSON-RPC error:`, an HTTP 401, 403, 429 or 503
response, or `Transaction not found`.

**Cause.** The provider may require credentials, reject a method, rate-limit
requests or be temporarily unavailable. A missing transaction can also mean
the hash is wrong, the node is on a different network, ingestion is still
in progress, or the ledger has been pruned from the node’s retained history.

**Fix.** Verify that the hash contains 64 hexadecimal characters and that the
endpoint serves the transaction’s network. For a recent transaction, let the
node finish ingestion and retry. For 429 or 503 responses, retry after a
delay or switch to a healthy same-network provider. For 401 or 403, check the
provider’s access requirements and use an endpoint that accepts requests from
your CLI. These HTTP statuses concern access to the RPC service. Soroban
authorization failures appear in transaction diagnostics.

If `getTransaction` returns `NOT_FOUND`, compare the transaction’s ledger
with the response’s `oldestLedger`. Use a same-network endpoint that still
serves that transaction when its ledger is older than the retention window.

```bash
grat --network testnet --rpc-url https://soroban-testnet.stellar.org --no-cache decode YOUR_TX_HASH
```

### Archive and replay state

**Symptom.** `Archive error:` with a fetch failure, checksum mismatch or
decompression failure, or `Replay error:` during state reconstruction.

**Cause.** Replay first needs the transaction and its ledger from RPC. For
older ledgers that it can locate, it may need a history archive checkpoint for
state reconstruction. An unavailable archive or an incomplete download can
interrupt that step.

**Fix.** If the transaction lookup failed, fix RPC retention first. Once RPC
can retrieve the transaction, verify that the selected network’s history
archive is reachable and has published the relevant checkpoint. Retry with
verbose logging and a fresh fetch:

```bash
grat -vv --network mainnet --no-cache trace YOUR_TX_HASH
```

If archive integrity errors persist, record the failing file and ledger
sequence for the archive operator. An RPC URL override keeps the selected
network’s archive settings.

### Invalid XDR or missing contract metadata

**Symptom.** `XDR error:`, `XDR decoding failed for ...`, or a numeric
contract error code with no resolved name.

**Cause.** XDR may be truncated, malformed base64 or incompatible with the
expected XDR type or protocol. A numeric contract code can also be valid XDR
whose WASM contract spec is unavailable.

**Fix.** Copy the full base64 value and check its encoding. If you have the
transaction hash, use it so Grat can fetch the result XDR directly. For raw
base64 input, use `grat decode --raw "$RESULT_XDR"`. Some diagnostics mention
`--resolve` for WASM metadata lookup. The current `decode` and `inspect`
commands attempt contract-error resolution automatically when the spec is
available. Their CLI parsers do not accept `--resolve`.

### Soroban authorization

**Symptom.** The diagnostic report identifies an auth failure, such as a
missing authorization or invalid signature.

**Cause.** The signing account, allowed invocation, nonce or signature
expiration ledger may differ from what the contract requires. Switching
networks can invalidate signatures because they are tied to the network
passphrase.

**Fix.** Inspect the failing operation on the transaction’s network. If
replay succeeds, use the authorization trace to examine its invocation chain.

```bash
grat --network testnet inspect --op-index 0 YOUR_TX_HASH
grat --network testnet trace --auth-only YOUR_TX_HASH
```

Simulate the intended call again on that network, compare the required
addresses and invocation arguments, and collect fresh authorizations before
resubmitting. See the [Auth category in the error taxonomy](./concepts/error-taxonomy.mdx#error-categories).

---

## 1. Unsupported or Unknown Error Code

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

## 2. Transaction Succeeded — Nothing to Decode

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

## 3. Not a Soroban Transaction

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

## 4. Cache Errors

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

## 5. Config File Parse Error

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
