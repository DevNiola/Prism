---
title: "Exporting Failed Transactions as Test Cases"
description: "Turn any failed mainnet transaction into a reproducible Rust test case you can run locally and in CI."
---

## Overview

One of the most powerful uses of Prism is **regression testing**: once you've
fixed a bug, you can export the original failing transaction as a standalone
test case so the bug can never silently return.

The `prism export` command captures the full on-chain context of a failed
transaction — XDR envelope, result metadata, ledger state snapshot — and
writes it as a Rust test file that replays the exact same scenario locally.

---

## CLI Export Command

```bash
prism export <tx-hash> [OPTIONS]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<tx-hash>` | The transaction hash (64 hex characters) of the failed transaction. |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--format <format>` | `test` | Output format. `test` produces a Rust test file; `json` produces a machine-readable JSON payload. |
| `--output <path>` | `prism_test_<hash-prefix>.rs` | Path to write the generated test case. If omitted, the file is written to the current directory. |

### Examples

Export as a Rust test (default):

```bash
prism export a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
# Writes: prism_test_a1b2c3d4.rs
```

Export to a specific path:

```bash
prism export <tx-hash> --output tests/regression/my_bug.rs
```

Export as JSON (useful for CI tooling):

```bash
prism export <tx-hash> --format json
```

JSON output:

```json
{
  "tx_hash": "a1b2c3d4...",
  "network": "Mainnet",
  "format": "test",
  "output_path": "prism_test_a1b2c3d4.rs",
  "status": "exported"
}
```

---

## Exported Test Case Format

The generated `.rs` file is a self-contained Rust test that can be dropped
into any crate in your project. It contains:

1. **Transaction hash** — the exact hash used to fetch the on-chain data.
2. **Network** — `Mainnet`, `Testnet`, or a custom RPC URL so the test always
   replays against the right ledger state.
3. **Expected error** — the decoded error code and description captured at
   export time, used as the assertion target.
4. **Replay invocation** — a call to `prism_core::replay::replay_transaction`
   that re-executes the transaction against the historical ledger state.

Example generated file (`prism_test_a1b2c3d4.rs`):

```rust
//! Regression test exported by Prism.
//! Transaction: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
//! Network:     Mainnet
//! Exported:    2026-10-20

#[cfg(test)]
mod regression_a1b2c3d4 {
    use prism_core::replay::replay_transaction;
    use prism_core::types::config::NetworkConfig;

    const TX_HASH: &str =
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

    #[tokio::test]
    async fn reproduces_original_failure() {
        let network = NetworkConfig::mainnet();
        let report = replay_transaction(TX_HASH, &network)
            .await
            .expect("replay should not return a network error");

        // Assert the transaction still fails with the same error code.
        assert!(
            report.failed,
            "transaction should still fail — if this assertion is false \
             the bug may have been fixed upstream"
        );
        assert_eq!(
            report.error_code,
            Some(3),  // InsufficientBalance
            "expected error code 3 (InsufficientBalance)"
        );
    }
}
```

---

## Integrating Exported Test Cases into CI

### 1. Place the generated file in your test directory

```bash
prism export <tx-hash> --output crates/my-contract/tests/regression/<descriptive-name>.rs
```

Keep regression tests in a dedicated directory so they are easy to review
and update as a batch.

### 2. Include the file in your crate

Add a `mod` declaration in your integration test entry point:

```rust
// crates/my-contract/tests/integration.rs
mod regression {
    include!("regression/prism_test_a1b2c3d4.rs");
}
```

Or, for multiple files, use a glob-style include with the `include_dir` crate
or a build script.

### 3. Add the test step to your CI workflow

```yaml
# .github/workflows/ci.yml
- name: Run regression tests
  run: cargo test --test integration regression
```

### 4. Complete example GitHub Actions step

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Run unit and regression tests
        run: cargo test --workspace
        env:
          PRISM_RPC_URL: ${{ secrets.STELLAR_RPC_URL }}
```

Set `PRISM_RPC_URL` (or `PRISM_NETWORK`) in your repository secrets so the
replay tests can reach the correct Stellar RPC endpoint.

---

## Tips

- **Export immediately after fixing a bug.** The closer the export is to the
  original failure, the more faithful the replay will be.
- **Name your files descriptively.** Use `--output tests/regression/<issue-number>_<short-description>.rs`
  so the test name makes the intent obvious in CI output.
- **Keep exports in source control.** Treat the generated `.rs` files as
  first-class test assets — commit them, review them in PRs, and update them
  when the contract interface changes.
- **Run locally before pushing.** Use `cargo test` locally to confirm the
  exported test reproduces the failure before relying on CI.

---

## Related

- [CLI Reference — `prism decode`](./cli-reference.mdx)
- [Regression Testing concept](./regression-testing.mdx)
- [Resource Optimization guide](./resource-optimization.mdx)
