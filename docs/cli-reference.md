# Grat CLI Reference

A complete reference for every `grat` command, flag, and output format.

---

## Installation & Setup

After building from source, the binary is at `./target/release/grat`. Add it to your `PATH`:

```bash
cargo build --release
export PATH="$PATH:$(pwd)/target/release"
```

Verify the installation:

```bash
grat --version
```

---

## Global Flags

These flags apply to every subcommand and must be placed **before** the subcommand name.

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--output <FORMAT>` | | `human` | Output format: `human`, `json`, `compact`, `short` |
| `--network <NETWORK>` | `-n` | `testnet` | Network to use: `mainnet`, `testnet`, `futurenet` |
| `--rpc-url <URL>` | | | Override the RPC endpoint URL |
| `--verbose` | `-v` | | Increase log verbosity. Use `-v` for debug, `-vv` for trace |
| `--save <PATH>` | | | Write the result to a file in addition to stdout |
| `--config-path <PATH>` | | `~/.grat/config.toml` | Path to a custom config file |
| `--quiet` | `-q` | | Suppress informational output |
| `--no-color` | | | Disable ANSI color in output |
| `--offline` | | | Disable automatic taxonomy update checks |
| `--no-cache` | | | Bypass local cache and always fetch live data |

### Examples

```bash
# Use mainnet with JSON output
grat --network mainnet --output json decode <TX_HASH>

# Save result to file while also printing
grat --save report.json decode <TX_HASH>

# Use a custom RPC endpoint
grat --rpc-url https://my-rpc.example.com decode <TX_HASH>

# Increase verbosity for debugging
grat -vv decode <TX_HASH>
```

---

## Analysis Commands

### `decode`

Decodes a failed transaction and produces a full diagnostic report explaining the error in plain English.

```
grat decode <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to decode (64-character hex string) |

**Flags:**

| Flag | Description |
|------|-------------|
| `--raw` | Decode a raw base64-encoded XDR string instead of a transaction hash |
| `--short` | Use condensed output (equivalent to `--output short`) |

**Examples:**

```bash
# Decode a failed mainnet transaction
grat decode d5c3b2a1f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2 --network mainnet

# Decode with JSON output (useful for piping to jq)
grat --output json decode <TX_HASH> | jq '.error_name'

# Decode raw XDR from a log message
grat decode --raw AAAAA...base64...AAAAA

# Decode and save the report
grat --save ./report.json decode <TX_HASH>

# Short output for quick scanning
grat decode <TX_HASH> --short
```

**Sample Output (human):**

```
✔ Transaction Fetched
✔ Error Classified: Contract
✔ Custom Error Resolved: InsufficientBalance
  Source: MyToken.rs:87
  Severity: Error
  Summary: The caller does not have enough balance to complete this transfer.
  Fix: Check the caller's balance with get_balance() before calling transfer().
```

---

### `batch`

Decodes multiple transactions in one command and displays an error summary table.

```
grat batch <TX_HASH>... [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH...` | One or more transaction hashes (space-separated) |

**Examples:**

```bash
# Decode two transactions at once
grat batch <TX_HASH_1> <TX_HASH_2>

# Decode a list of transactions on mainnet
grat --network mainnet batch hash1 hash2 hash3
```

---

### `inspect`

Similar to `decode`, but allows targeting a specific operation index within a multi-operation transaction.

```
grat inspect <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to inspect |

**Flags:**

| Flag | Description |
|------|-------------|
| `--op-index <N>` | Zero-based index of the operation to inspect. Omit to inspect all operations. |

**Examples:**

```bash
# Inspect all operations in a transaction
grat inspect <TX_HASH>

# Inspect only the second operation (index 1)
grat inspect <TX_HASH> --op-index 1

# Inspect with JSON output
grat --output json inspect <TX_HASH> --op-index 0
```

---

### `trace`

Replays a transaction and outputs a detailed, hierarchical execution timeline showing every host function call, event, and state mutation.

```
grat trace <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to trace |

**Flags:**

| Flag | Description |
|------|-------------|
| `--output-file <PATH>` | Write the trace output to a file instead of stdout |
| `--auth` | Append an authorization tree to the trace output |
| `--auth-only` | Display only the authorization tree, not the full trace |

**Examples:**

```bash
# Print a full execution trace
grat trace <TX_HASH>

# Save the trace to a file
grat trace <TX_HASH> --output-file trace.txt

# Show only the authorization flow
grat trace <TX_HASH> --auth-only

# Trace with authorization tree appended, save raw JSON
grat --save trace.json trace <TX_HASH> --auth
```

---

### `profile`

Replays a transaction and produces a resource usage profile showing CPU instructions and memory bytes consumed per call.

```
grat profile <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to profile |

**Examples:**

```bash
# Profile a transaction
grat profile <TX_HASH>

# Profile on mainnet with JSON output
grat --network mainnet --output json profile <TX_HASH>

# Profile and save the result
grat --save profile.json profile <TX_HASH>
```

**Sample Output (human):**

```
Resource Profile
────────────────────────────────────────
  CPU Instructions    45,230 / 100,000,000
  Memory Bytes       512,048 / 41,943,040
  Top Consumers:
    1. call_host_fn::invoke_contract   23,100 instructions
    2. call_host_fn::get_ledger_entry  12,800 instructions
    3. call_host_fn::put_ledger_entry   8,200 instructions
```

---

### `diff`

Computes and displays the ledger state diff for a transaction — what storage entries were created, updated, or deleted.

```
grat diff <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to diff |

**Examples:**

```bash
# Show state changes for a transaction
grat diff <TX_HASH>

# Output diff as JSON
grat --output json diff <TX_HASH>

# Save diff to file
grat --save state_diff.json diff <TX_HASH>
```

**Sample Output (human):**

```
State Diff
──────────────────────────────────────────────────────────────
  UPDATED  Contract::Balance[GABC...XYZ]  1000 → 750
  UPDATED  Contract::Balance[GDEF...UVW]  500  → 750
  CREATED  Contract::Allowance[GABC...XYZ:GDEF...UVW]  0 → 0
```

---

## Debug & TUI Commands

### `replay`

Launches an interactive TUI (Terminal UI) debugger for step-by-step transaction replay. Supports breakpoints, stepping, and live inspection.

```
grat replay <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to replay |

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--interactive` | `-i` | Launch the TUI debugger. Required for interactive mode. |

**Examples:**

```bash
# Launch the interactive TUI debugger
grat replay <TX_HASH> --interactive

# Short form
grat replay <TX_HASH> -i

# Pipe the TUI launch event as JSON (useful for tooling)
grat --output json replay <TX_HASH> --interactive
```

#### TUI Mode

When launched with `--interactive`, the TUI debugger opens in your terminal. It provides:

- **Timeline Panel** — Scrollable list of all execution steps in chronological order.
- **Inspector Panel** — Detailed view of the selected step: inputs, outputs, resource cost.
- **Controls Panel** — Keyboard shortcuts shown at the bottom.

**TUI Key Bindings:**

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate the timeline |
| `Enter` | Expand / inspect a step |
| `n` | Step forward to next event |
| `p` | Step backward to previous event |
| `b` | Set / clear a breakpoint on the selected step |
| `r` | Run to next breakpoint |
| `q` | Quit the TUI |
| `?` | Show help overlay |

> **Tip:** For a non-interactive trace, use `grat trace <TX_HASH>` which outputs the full timeline to stdout without launching a TUI.

---

### `whatif`

Re-simulates a transaction with optional modifications to test hypothetical scenarios ("what if the input was different?").

```
grat whatif <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to re-simulate |

**Flags:**

| Flag | Description |
|------|-------------|
| `--modify <PATH>` | Path to a JSON file containing patches to apply before re-simulation |

**Patch File Format:**

```json
[
  {
    "path": "args.amount",
    "value": 500
  },
  {
    "path": "auth.source_account",
    "value": "GABC...XYZ"
  }
]
```

**Examples:**

```bash
# Inspect the transaction without modifications
grat whatif <TX_HASH>

# Re-simulate with a patch file
grat whatif <TX_HASH> --modify patches.json

# Save the what-if result
grat --save whatif_result.json whatif <TX_HASH> --modify patches.json
```

---

### `export`

Exports a failed transaction as a standalone Rust test case that can be added to a test suite for regression testing.

```
grat export <TX_HASH> [FLAGS]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `TX_HASH` | The transaction hash to export |

**Flags:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--format <FORMAT>` | | `test` | Export format. Currently supports `test` (Rust test case). |
| `--output <PATH>` | `-o` | `grat_test_<HASH_PREFIX>.rs` | Output file path |

**Examples:**

```bash
# Export as a Rust test case with default filename
grat export <TX_HASH>

# Specify the output path
grat export <TX_HASH> --output tests/regression/my_test.rs

# Export on mainnet
grat --network mainnet export <TX_HASH> --output tests/mainnet_regression.rs
```

---

## System & Data Commands

### `db`

Manages the local taxonomy database of Soroban error definitions.

#### `db update`

Downloads the latest version of the taxonomy database from the official release channel.

```
grat db update [FLAGS]
```

**Examples:**

```bash
# Update the taxonomy database
grat db update

# Update and confirm via JSON
grat --output json db update
```

#### `db stats`

Displays the number of error definitions currently loaded in the local database.

```
grat db stats [FLAGS]
```

**Examples:**

```bash
grat db stats
# → Taxonomy database: 142 entries

grat --output json db stats
# → { "status": "ok", "entries": 142 }
```

#### `db search`

Searches the taxonomy database for errors matching a query string. Case-insensitive substring match against error names, categories, and descriptions.

```
grat db search <QUERY>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `QUERY` | Case-insensitive search query |

**Examples:**

```bash
# Search for budget-related errors
grat db search budget

# Search for auth errors
grat db search auth

# Search for a specific error name
grat db search "cpu exceeded"
```

---

### `search-error`

Alias for a taxonomy search with a rich tabular output. Prints results as a formatted table with category, code, name, and summary columns.

```
grat search-error <QUERY>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `QUERY` | Case-insensitive search query |

**Examples:**

```bash
grat search-error storage
grat search-error "wasm trap"
```

**Sample Output:**

```
┌──────────┬──────┬───────────────────────┬────────────────────────────────────────────────────────┐
│ Category │ Code │ Name                  │ Summary                                                │
├──────────┼──────┼───────────────────────┼────────────────────────────────────────────────────────┤
│ Storage  │  0   │ MissingEntry          │ The requested ledger entry does not exist.             │
│ Storage  │  1   │ ExistingEntry         │ Attempted to create an entry that already exists.      │
│ Storage  │  2   │ AccessDenied          │ The contract does not have permission to access entry. │
└──────────┴──────┴───────────────────────┴────────────────────────────────────────────────────────┘
```

---

### `clean`

Clears the local disk cache of fetched transaction data and compiled WASM artifacts.

```
grat clean [FLAGS]
```

**Examples:**

```bash
# Clean the cache
grat clean

# Clean with verbose output
grat -v clean
```

---

### `auth`

Manages authentication credentials used for connecting to private RPC endpoints or the Grat cloud service.

```
grat auth <SUBCOMMAND>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `login` | Log in and store credentials |
| `logout` | Remove stored credentials |
| `status` | Show current authentication status |
| `token` | Display or rotate the current API token |

**Examples:**

```bash
# Authenticate
grat auth login

# Check current auth status
grat auth status

# Log out
grat auth logout
```

---

### `diagnostic`

Runs a suite of health checks covering binary version, network reachability, and local cache state.

```
grat diagnostic [FLAGS]
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--quiet` | `-q` | Only print warnings and errors, skip passing checks |

**Examples:**

```bash
# Run all checks
grat diagnostic

# Only show problems
grat diagnostic --quiet
```

**Sample Output:**

```
  Grat Diagnostic Report
  ──────────────────────────────────────────────────────────

  [  OK   ]  Binary version                    v0.3.1
  [  OK   ]  RPC connectivity  (testnet)        312ms
  [ WARN  ]  RPC connectivity  (mainnet)
             └─ High latency: 2340ms
  [  OK   ]  Cache directory   /home/user/.cache/grat
  [  OK   ]  Cache writability
  [  OK   ]  Disk space                        8192MiB free
  [  OK   ]  Cache size                        24MiB used

  ──────────────────────────────────────────────────────────
  1 warning(s), 0 error(s).
```

---

### `history`

Displays the last 10 transaction hashes that were decoded in the current environment.

```
grat history [FLAGS]
```

**Examples:**

```bash
grat history
```

**Sample Output:**

```
#    Transaction Hash                                                   Decoded
----------------------------------------------------------------------------------------------------
1    d5c3b2a1f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2  2 minutes ago
2    aaabbbcccdddeeefff000111222333444555666777888999aaabbbcccdddeeefff0  1 hour ago
```

---

### `serve`

Starts a local HTTP and WebSocket server that bridges the CLI engine to the Grat web dashboard. The server streams live trace events over WebSocket as the replay progresses.

```
grat serve [FLAGS]
```

**Flags:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port <PORT>` | `-p` | `8080` | Port to listen on |
| `--host <HOST>` | | `127.0.0.1` | Host address to bind to |

**Examples:**

```bash
# Start on default port 8080
grat serve

# Start on a custom port
grat serve --port 9090

# Bind to all interfaces (expose on LAN)
grat serve --host 0.0.0.0 --port 8080
```

**Endpoints exposed by `grat serve`:**

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web dashboard placeholder page |
| `GET /api/trace/:tx_hash` | Fetch a full replay trace as JSON |
| `GET /ws` | WebSocket endpoint for streaming trace events |

**WebSocket Protocol:**

Connect to `ws://127.0.0.1:8080/ws` and send a JSON message:

```json
{
  "tx_hash": "<TX_HASH>",
  "resume_from": null
}
```

The server streams back a sequence of typed messages:

```jsonc
// Replay started
{ "type": "trace_started", "tx_hash": "...", "ledger_sequence": 12345 }

// A single execution step
{ "type": "trace_node", "node": { ... }, "path": [0] }

// Budget snapshot
{ "type": "resource_update", "cpu_used": 45000, "memory_used": 512000, ... }

// State change
{ "type": "state_diff_entry", "key": "...", "before": "...", "after": "..." }

// Completion
{ "type": "trace_completed", "total_nodes": 48, "duration_ms": 1240 }

// Error
{ "type": "trace_error", "error": "Failed to reconstruct state: ..." }
```

Use `"resume_from": <last_node_index>` to resume a dropped connection without re-receiving previously delivered nodes.

---

### `completions`

Generates shell completion scripts.

```
grat completions <SHELL>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `SHELL` | Target shell: `bash`, `zsh`, `fish`, `powershell`, `elvish` |

**Examples:**

```bash
# Add bash completions
grat completions bash >> ~/.bashrc

# Add zsh completions
grat completions zsh > ~/.zfunc/_grat
echo 'fpath=(~/.zfunc $fpath)' >> ~/.zshrc
autoload -Uz compinit && compinit

# Fish completions
grat completions fish > ~/.config/fish/completions/grat.fish
```

---

## Output Formats

All analysis commands accept `--output <FORMAT>` (or the global `--output` flag placed before the subcommand).

| Format | Description |
|--------|-------------|
| `human` | Colored, human-readable output with icons and aligned tables (default) |
| `json` | Structured JSON output suitable for piping to `jq` or other tools |
| `compact` | Single-line summary per result, no color |
| `short` | Condensed human output with less detail |

### Examples

```bash
# Machine-readable JSON for scripting
grat --output json decode <TX_HASH> | jq '.severity'

# Compact for quick scanning in CI logs
grat --output compact batch hash1 hash2 hash3

# Short for quick terminal checks
grat decode <TX_HASH> --short
```

---

## Configuration File

Grat reads configuration from `~/.grat/config.toml` on startup. Override the path with `--config-path`.

```toml
# ~/.grat/config.toml

default_network = "mainnet"
max_cache_size_mb = 512
```

Override the config file for a single invocation:

```bash
grat --config-path /path/to/custom.toml decode <TX_HASH>
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RUST_LOG` | Fine-grained log filter (e.g. `RUST_LOG=grat=debug`) |

---

## Quick Reference

```
grat decode <TX_HASH>                    # Decode a failed transaction
grat batch <HASH> <HASH> ...             # Decode multiple transactions
grat inspect <TX_HASH> [--op-index N]   # Inspect a specific operation
grat trace <TX_HASH>                     # Full execution timeline
grat profile <TX_HASH>                   # Resource usage breakdown
grat diff <TX_HASH>                      # Ledger state diff
grat replay <TX_HASH> -i                 # Interactive TUI debugger
grat whatif <TX_HASH> [--modify f.json] # Re-simulate with changes
grat export <TX_HASH>                    # Export as Rust test case
grat search-error <QUERY>               # Search error taxonomy
grat db update                           # Update taxonomy database
grat db stats                            # Show database entry count
grat clean                               # Clear local cache
grat auth login                          # Authenticate
grat diagnostic                          # Health check
grat history                             # Recent transaction history
grat serve [--port N]                    # Start local web server
grat completions <SHELL>                 # Generate shell completions
```
