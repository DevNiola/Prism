# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CHANGELOG.md and release process documentation (#90)
- WASM bridge documentation (#85)
- Caching layer architecture documentation (#89)
- Mintlify documentation site configuration guide (#83)

---

## [0.1.0] - 2024-01-01

### Added
- Initial release of Prism (Grat) — Soroban Transaction Debugger.
- **Core Library** (`crates/core`): Shared Rust engine for decoding, replaying, and debugging Soroban transactions.
- **CLI** (`crates/cli`): Command-line interface with `decode`, `inspect`, `trace`, `profile`, `diff`, `replay`, `whatif`, `export`, `serve`, and `db-update` commands.
- **WASM** (`crates/wasm`): Core logic compiled to WebAssembly for browser-based decoding via `wasm-bindgen`.
- **Web App** (`apps/web`): Interactive Next.js 16 dashboard for shareable debug sessions.
- **Server** (`apps/server`): Async task processor and WebSocket server for trace streaming.
- **VS Code Extension** (`extensions/vscode`): Inline error decoding and transaction debugging for VS Code.
- Three-tier caching system: in-memory (`DashMap`), disk (`sled`), and WASM-specific (SHA-256 keyed) backends.
- Authorization type detection: distinguishes Ed25519 account signatures from Smart Wallet contract authorizations.
- Diagnostic event walker for identifying failing contract IDs from XDR diagnostic events.
- Error taxonomy database (`taxonomy/enhanced_error_taxonomy.toml`) with categorized Soroban host errors.
- Resource profiling: CPU instruction and memory usage reporting against ledger limits.

### Security
- All network requests use `rustls-tls` — no OpenSSL dependency.

---

## How to Read This Changelog

- **Added** — new features.
- **Changed** — changes to existing functionality.
- **Deprecated** — soon-to-be-removed features.
- **Removed** — features removed in this release.
- **Fixed** — bug fixes.
- **Security** — security-related fixes or improvements.

[Unreleased]: https://github.com/DevNiola/Prism/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DevNiola/Prism/releases/tag/v0.1.0
