# CLI Integration

This example shows how an external Node.js process (e.g., an IDE extension,
web-app backend, or CI pipeline) can programmatically invoke the `prism` Rust
binary via `child_process.execFile` and consume the JSON output it writes to
stdout.

## What it demonstrates

- Spawning the `prism decode` command from Node.js without a shell, which
  avoids shell-injection risks.
- Validating the Base64 XDR string before passing it to the binary.
- Parsing and logging the structured JSON diagnostic report returned by Prism.

## Prerequisites

- Prism CLI built locally:
  ```bash
  cargo build          # debug build
  # or
  cargo build --release
  ```
  The script expects the binary at `../../target/debug/prism` relative to this
  directory (i.e., `<repo-root>/target/debug/prism`).
- Node.js 18 or higher.

## Installation

No external npm dependencies are required.

## Running the Example

Pass a valid Base64-encoded XDR transaction envelope as the first argument:

```bash
node index.js <base64_xdr_string>
```

### Example

```bash
node index.js AAAAAQAAAA...==
```

A successful run prints the JSON diagnostic report to stdout.  On error the
script exits with a non-zero status and prints a message to stderr.

## How it works

1. The script validates that the input is a correctly-padded Base64 string.
2. It resolves the absolute path to the `prism` binary.
3. `execFile` spawns the binary with `["decode", "<xdr>", "format", "json"]`
   as the argument array — no shell expansion, no injection risk.
4. The raw stdout is printed; consumers can pipe it to `jq` or parse it with
   `JSON.parse`.
