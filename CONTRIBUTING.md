# Contributing to Grat

We welcome contributions to Grat!

## Code of Conduct

By participating, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## How to Contribute

1. Fork the repository and create your feature branch.
2. Contributions to the **error taxonomy database** are highly encouraged.
3. For code changes, ensure all tests pass (`cargo test`).
4. Document any new features or API changes.
5. Open a Pull Request with a clear description of your work.

## Development Setup

Please refer to the comprehensive [Getting Started Guide](./docs/getting-started.md) for full instructions on setting up:
- The Rust toolchain (stable, wasm32-unknown-unknown, rustfmt, clippy)
- Node.js and pnpm monorepo dependencies
- Environment variables for `apps/server` and `apps/web`
- Running all crates, API server, and web frontend locally
- Troubleshooting common setup hurdles

### Install Git Hooks

Install `pre-commit` with pipx (install pipx with your OS package manager if needed), then install project dependencies and Rust lint components and enable the repository hooks:

```sh
pipx install pre-commit
pnpm install
rustup component add rustfmt clippy
pre-commit install
```

Hooks run Rust formatting and Clippy for staged Rust changes, and Prettier and the workspace ESLint scripts for staged TypeScript changes. To run them manually against all supported files:

```sh
pre-commit run --all-files
```

## Pre-Commit Hooks

We enforce consistent code formatting and linting across Rust and TypeScript via `pre-commit`.

### 1. Install Pre-Commit:
```bash
# Via pip:
pip install pre-commit

# Or via Homebrew (macOS):
brew install pre-commit
```

### 2. Install Git Hooks:
```bash
pre-commit install

# Or using pnpm shortcut:
pnpm run hooks:install
```

### 3. Run Manually:
```bash
# Run against all files:
pre-commit run --all-files

# Or using pnpm shortcut:
pnpm run hooks:run
```

The hooks automatically verify:
- **`rustfmt`**: Formats all workspace Rust crates (`cargo fmt --check`).
- **`clippy`**: Runs Clippy linter with `-D warnings` on all targets and features.
- **`prettier`**: Formats TypeScript, JavaScript, JSON, YAML, and Markdown files.
- **`eslint`**: Runs ESLint across all workspace packages (`pnpm -r lint`).
- **Hygiene**: Trailing whitespace, end-of-file fixer, TOML and YAML syntax.

## License

Contributions are licensed under the project's MIT License.
