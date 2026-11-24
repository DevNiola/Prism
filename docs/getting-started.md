# Getting Started with Prism (Grat)

Welcome to the contributor guide for Prism! This comprehensive guide walks you through setting up your local development environment from scratch, configuring environment variables, running all project components, and troubleshooting common issues.

---

## 1. Prerequisites

Before getting started, make sure your operating system has the essential build tools installed:

- **Linux (Ubuntu/Debian)**:
  ```bash
  sudo apt-get update
  sudo apt-get install -y build-essential pkg-config libssl-dev git clang curl
  ```
- **macOS**:
  ```bash
  xcode-select --install
  brew install openssl pkg-config
  ```

---

## 2. Toolchain Setup

### Rust Toolchain

The project requires Rust stable (or MSRV as specified in `rust-toolchain.toml`) along with `wasm32-unknown-unknown` for WASM crate builds:

```bash
# Install rustup if not already installed:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Configure stable toolchain and components
rustup default stable
rustup component add rustfmt clippy
rustup target add wasm32-unknown-unknown
```

Verify your installation:
```bash
rustc --version
cargo --version
```

### Node.js & pnpm Setup

The frontend and API server require Node.js (v20+ recommended) and `pnpm`:

```bash
# Enable pnpm via corepack (recommended)
corepack enable
corepack prepare pnpm@latest --activate

# Or install pnpm via npm:
npm install -g pnpm
```

Install workspace dependencies:
```bash
pnpm install
```

---

## 3. Environment Variables Configuration

Prism contains multiple applications that read configuration from environment files.

### Server (`apps/server/.env`)

Copy the sample environment file or create `apps/server/.env`:
```env
PORT=4000
NODE_ENV=development
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
LOG_LEVEL=debug
CACHE_TTL_SECONDS=3600
MAX_CACHE_SIZE_MB=256
```

### Web App (`apps/web/.env.local`)

Create `apps/web/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_ENABLE_DEBUGGER_ANIMATIONS=true
```

---

## 4. Running the Project Locally

### Building Rust Crates

Build all Rust workspace members (`crates/core`, `crates/cli`, `crates/wasm`):
```bash
cargo build --workspace
```

To run the CLI locally:
```bash
cargo run --bin grat -- --help
```

### Running the Server (`apps/server`)

In a new terminal window:
```bash
cd apps/server
pnpm dev
# or from the monorepo root:
pnpm --filter @prism/server dev
```
The server will start at `http://localhost:4000`.

### Running the Web Application (`apps/web`)

In a new terminal window:
```bash
cd apps/web
pnpm dev
# or from the monorepo root:
pnpm --filter @prism/web dev
```
Open `http://localhost:3000` in your browser.

---

## 5. Development Workflow & Testing

- **Rust Formatting & Linting**:
  ```bash
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  ```
- **Taxonomy Validation**:
  ```bash
  ./scripts/lint_taxonomy.sh
  ```
- **Frontend Type Checking**:
  ```bash
  pnpm --filter @prism/web typecheck
  ```

---

## 6. Troubleshooting Common Issues

### Issue: `wasm32-unknown-unknown` target missing
**Symptom**: Compiling `crates/wasm` fails with target not found.
**Solution**: Run `rustup target add wasm32-unknown-unknown`.

### Issue: Sled database lock error
**Symptom**: `Failed to open sled database: lock held by another process`.
**Solution**: Ensure no other CLI instance or background server is currently holding the cache directory (`~/.cache/grat/disk_cache`). You can remove stale lock files or change the cache path.

### Issue: OpenSSL compilation error on Linux
**Symptom**: `Could not find directory of OpenSSL installation`.
**Solution**: Install development headers: `sudo apt-get install pkg-config libssl-dev`.

### Issue: Node.js and pnpm version mismatch
**Symptom**: `ERR_PNPM_UNSUPPORTED_ENGINE`.
**Solution**: Ensure you are running Node.js >= 20.x: `node --version`. Use `nvm` or `fnm` to switch to Node 20.
