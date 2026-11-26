# Contributing to Grat

We welcome contributions to Grat!

## Code of Conduct

By participating, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## How to Contribute

1. Fork the repository and create your feature branch from `main`.
2. Contributions to the **error taxonomy database** are highly encouraged — see `taxonomy/README.md`.
3. Ensure all checks pass before opening a PR (see the [CI section](#running-ci-locally) below).
4. Document any new features or API changes.
5. Open a Pull Request with a clear description of your work.

---

## Development Setup

### Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Rust | `stable` (via `rust-toolchain.toml`) | Includes `rustfmt`, `clippy`, `wasm32-unknown-unknown` target |
| Node.js | ≥ 20 | |
| pnpm | ≥ 9 | `npm install -g pnpm` |
| Docker | any recent version | Required for Redis and e2e tests |

### First-time setup

```bash
# 1. Clone and enter the repo
git clone https://github.com/DevNiola/Prism.git
cd Prism

# 2. Install the Rust toolchain (reads rust-toolchain.toml automatically)
rustup show

# 3. Install Node dependencies
pnpm install

# 4. (Optional) Install pre-commit hooks so linters run before every commit
pip install pre-commit
pre-commit install
```

### Running the server locally

The server requires Redis. The quickest way is Docker:

```bash
# Start Redis
docker compose up -d redis

# Start the development server (hot-reload)
pnpm dev:server
```

### Building WASM

```bash
pnpm build:wasm        # Windows (PowerShell script)
# or directly:
cargo build -p grat-wasm --target wasm32-unknown-unknown --release
```

---

## Running CI Locally

A `Makefile` mirrors every CI step so you can reproduce failures before pushing.

```bash
make ci          # fmt-check + clippy + taxonomy-lint + test + pnpm lint + typecheck
make fmt         # auto-fix Rust formatting
make test        # cargo test only
make lint        # pnpm lint only
make e2e         # docker-compose up → Playwright → docker-compose down
```

Run `make help` for the full list of targets.

---

## Testing

| Test type | Command |
|-----------|---------|
| Rust unit & integration | `cargo test --workspace --all-features` |
| Taxonomy TOML lint | `bash scripts/lint_taxonomy.sh` |
| TypeScript unit | `pnpm test` |
| End-to-end (Playwright) | `make e2e` |

---

## License

Contributions are licensed under the project's MIT License.
