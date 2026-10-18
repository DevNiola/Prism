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

Refer to the [Requirements section in the README](../README.md#requirements) for environment setup.

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
