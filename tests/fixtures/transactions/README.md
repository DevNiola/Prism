# Soroban Transaction Fixtures

This directory contains deterministic test fixtures representing real and simulated Soroban transactions used across Prism's integration test suite (`tests/integration/decode_test.rs`).

## Fixture Catalog

| File | Status | Category | Description | Key Verifications |
|------|--------|----------|-------------|-------------------|
| `single_op_success.json` | SUCCESS | Success | Single-operation contract call initializing contract state | Valid result XDR, zero errors, Info severity report |
| `single_op_failure.json` | FAILED | Contract | Contract call failing with user-defined contract error #1 | Error resolution, taxonomy matching, suggested fixes |
| `multi_op_with_error.json` | FAILED | Multi-Op | 3-operation transaction (Payment, InvokeHostFunction, SetOptions) where Op 1 fails | Cross-operation error linking (issue #11), rollback detection |
| `auth_ed25519.json` | FAILED | Auth | Contract invocation with Ed25519 signature credentials (`G...`) | Ed25519 detection, account address parsing, BadSignature diagnosis |
| `auth_smart_wallet.json` | FAILED | Auth | Contract invocation with Smart Wallet credentials (`C...`) | Smart Wallet detection, contract address parsing, custom verification |
| `budget_exceeded.json` | FAILED | Budget | Transaction exceeding the Soroban host CPU instruction budget | Diagnostic events, cpu limit vs used comparison, resource profiling |
| `storage_error.json` | FAILED | Storage | Contract attempting to access missing or non-footprint ledger entry | Storage taxonomy mapping, EntryNotFound diagnosis, TTL suggested fixes |
| `wasm_trap.json` | FAILED | WASM | Guest WebAssembly VM trap triggered by unreachable instruction | WASM taxonomy mapping, Unreachable trap diagnosis, panic remediation |
| `event_decoding.json` | SUCCESS | Events | Successful contract invocation emitting structured transfer events | Topic decoding (Symbol, Addresses), data extraction, payload parsing |
| `cross_contract_call.json` | FAILED | Chain | 3-level contract call chain (A -> B -> C) failing at depth 2 | Chain analyzer, call depth calculation, root-cause contract attribution |
| `auth_failed.json` | FAILED | Auth | Authorization error where required address does not match provided | Address discrepancy detection, auth mismatch reporting |
| `auth_mixed.json` | FAILED | Auth | Transaction combining both Ed25519 and Smart Wallet authorizations | Multi-credential resolution, signature verification tracking |
| `auth_missing.json` | FAILED | Auth | Transaction missing required authorization signatures | Missing signer detection, required vs provided diff |
| `contract_error.json` | FAILED | Contract | Direct contract invocation returning custom error code #3 | Contract address format validation (`C...`), error payload handling |

## Schema

Each fixture provides:
- `status`: Transaction status string (`SUCCESS` or `FAILED`).
- `hash`: 32-byte hexadecimal transaction hash.
- `ledger`: Ledger sequence number.
- `resultXdr`: Base64-encoded Stellar transaction result XDR.
- `envelopeXdr`: Optional Base64-encoded Stellar transaction envelope XDR.
- `diagnosticEvents`: Array of diagnostic event objects emitted by the Soroban host environment.
- `auth_entries`: List of expected authorization credentials detected in the transaction.
- `expected_report`: Expected `DiagnosticReport` attributes after running through Prism's decode pipeline.
