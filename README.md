# Prism


<p align="center">
  <img src="https://img.shields.io/badge/Rust-1.77+-orange?style=for-the-badge&logo=rust" alt="Rust 1.77" />
  <img src="https://img.shields.io/badge/Next.js-16.x-black?style=for-the-badge&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript" alt="TS 5" />
  <a href="https://codecov.io/gh/DevNiola/Prism"><img src="https://codecov.io/gh/DevNiola/Prism/branch/main/graph/badge.svg" alt="Codecov coverage" /></a>
  <img src="https://img.shields.io/badge/Documentation-Live-blue?style=for-the-badge&logo=gitbook&logoColor=white" alt="Docs" />
</p>

**Prism** is a developer tool that makes Soroban smart contract errors easy to understand. It takes raw, cryptic error codes from failed transactions and turns them into plain English explanations with suggested fixes. It also lets developers replay past transactions step by step to see exactly what went wrong and why, so they can find and fix the problem in seconds instead of guessing.

## Features

- **Instant Error Decoding**: Decodes Soroban host errors into plain English with suggested fixes.
- **Contract-Specific Resolution**: Cross-references WASM metadata to resolve custom error codes (e.g., `#3` → `InsufficientBalance`).
- **Execution Trace Replay**: Replays transactions against historical ledger state for deep inspection.
- **Resource Profiling**: Identifies budget hotspots and expensive host function calls.
- **Time-Travel Debugging**: Supports breakpoints, step-through execution, and "what-if" re-simulation.
- **Multi-Interface Support**: Available via Rust CLI, VS Code Extension, and a Web Application.
- **Authorization Type Detection**: Distinguishes Ed25519 account signatures from Smart Wallet (contract) authorizations and surfaces the relevant address or contract ID.

## Architecture

Prism is organized as a modular monorepo:

- **Core Library (`crates/core`)**: The shared Rust engine for decoding, replaying, and debugging.
- **CLI (`crates/cli`)**: Powerful command-line interface for terminal-native diagnostics.
- **WASM (`crates/wasm`)**: Core logic compiled to WASM for client-side web integration.
- **Web App (`apps/web`)**: Interactive Next.js 16 dashboard for shareable debug sessions.
- **Server (`apps/server`)**: Async task processor and WebSocket server for trace streaming.

## Tech Stack

- **Core Engine**: Rust (edition 2021)
- **Blockchain**: Stellar Soroban SDK (v21)
- **Web Frontend**: Next.js 16, React 19, TypeScript 5
- **WASM Processing**: wasmparser & wasm-pack
- **CLI Framework**: Clap & Ratatui (TUI)

## Quick Start

Use Bash, Git, and the stable Rust toolchain installed with [rustup](https://rustup.rs/). The CLI binary is named `grat`. For web or extension development, install Node.js 20 or later and pnpm 9.

```bash
git clone https://github.com/DevNiola/Prism.git
cd Prism
cargo build --release -p grat-cli
```

Verify the CLI with the result XDR from the checked-in budget failure fixture:

```bash
./target/release/grat decode --raw 'AAAAAAAAAGT/////AAAAAQAAAAAAAAAB////+wAAAAA=' --output json
```

Expect `"error_name": "RawXdr"` and an explanation that says 32 bytes were decoded. To look up a failed testnet transaction, paste its hash when prompted:

```bash
read -r -p 'Failed testnet transaction hash: ' tx_hash
./target/release/grat decode "$tx_hash" --network testnet
```

## Documentation

For full technical specifications, architecture deep-dives, and API references, visit our [Live Documentation](https://prism-ddf93e61.mintlify.app/docs/introduction).

<CardGroup cols={2}>
  <Card title="Quickstart" icon="bolt" href="https://prism-ddf93e61.mintlify.app/docs/quickstart">
    Get up and running in under 60 seconds.
  </Card>
  <Card title="CLI Reference" icon="terminal" href="https://prism-ddf93e61.mintlify.app/docs/cli/decode">
    Complete guide to all Prism commands.
  </Card>
  <Card title="Architecture" icon="sitemap" href="https://prism-ddf93e61.mintlify.app/docs/architecture/overview">
    Deep dive into the 3-tier diagnostic engine.
  </Card>
  <Card title="Guides" icon="book" href="https://prism-ddf93e61.mintlify.app/docs/guides/debugging-transactions">
    Real-world walkthroughs and optimization tips.
  </Card>
</CardGroup>

## Use Cases

### Debugging Failed Transactions

Instantly understand why a mainnet transaction failed without redeploying or adding print statements.

### Resource Optimization

Profile contract execution to identify expensive storage reads or CPU-heavy host function calls before deploying to mainnet.

### Regression Testing

Export failed transactions as standalone test cases to ensure bugs are permanently resolved.

## Authorization Type Detection

Prism automatically identifies the kind of authorization used in each Soroban transaction and includes this information in every diagnostic report.

### Supported Types

| Type             | Address Prefix | Description                                                                               |
| ---------------- | -------------- | ----------------------------------------------------------------------------------------- |
| **Ed25519**      | `G...`         | Classic Stellar account signing with its ed25519 key pair.                                |
| **Smart Wallet** | `C...`         | Deployed contract implementing custom signature verification (e.g., multi-sig, passkeys). |

### Detection Logic

Detection is based on the `ScAddress` variant inside each `SorobanAddressCredentials` entry:

- `ScAddress::Account(...)` → **Ed25519** — a standard Stellar account.
- `ScAddress::Contract(...)` → **Smart Wallet** — a deployed contract acting as an authorizer.

`SourceAccount` credentials (where the transaction's own source account implicitly authorizes the entry) are not typed because they carry no separate address.

### Report Fields

Each decoded `DiagnosticReport` includes an `auth_entries` array with one entry per authorization found in the transaction:

```json
{
  "auth_entries": [
    {
      "auth_type": "Ed25519",
      "address": "GABC...XYZ"
    },
    {
      "auth_type": "Smart Wallet",
      "address": "CABC...XYZ",
      "contract_id": "CABC...XYZ"
    }
  ]
}
```

The existing `auth_signatures` field (hex-encoded ed25519 signature bytes) is preserved unchanged for backward compatibility.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

Empowering Soroban developers with clear, actionable diagnostics.
