# Makefile
# Local development targets that mirror CI.
# Run `make help` to list all targets.

.PHONY: help fmt fmt-check clippy lint test taxonomy-lint build ci e2e

# Default target
help:
	@echo ""
	@echo "  Grat — local development targets"
	@echo ""
	@echo "  Rust"
	@echo "    make fmt           Run cargo fmt --all (auto-fix)"
	@echo "    make fmt-check     Check formatting (matches CI)"
	@echo "    make clippy        Run clippy -D warnings (matches CI)"
	@echo "    make test          Run cargo test --workspace --all-features"
	@echo "    make taxonomy-lint Run the taxonomy TOML linter"
	@echo "    make build         Build all Rust crates"
	@echo ""
	@echo "  Node / TypeScript"
	@echo "    make lint          Run pnpm lint across all packages"
	@echo "    make typecheck     Run pnpm typecheck across all packages"
	@echo ""
	@echo "  Combined"
	@echo "    make ci            Run every check that CI runs (no e2e)"
	@echo "    make e2e           Start docker-compose, run Playwright, tear down"
	@echo ""

# ---------------------------------------------------------------------------
# Rust targets
# ---------------------------------------------------------------------------

fmt:
	cargo fmt --all

fmt-check:
	cargo fmt --all -- --check

clippy:
	cargo clippy --workspace --all-targets --all-features -- -D warnings

test:
	cargo test --workspace --all-features

taxonomy-lint:
	bash scripts/lint_taxonomy.sh

build:
	cargo build --workspace --all-targets --all-features

# ---------------------------------------------------------------------------
# Node / TypeScript targets
# ---------------------------------------------------------------------------

lint:
	pnpm lint

typecheck:
	pnpm typecheck

# ---------------------------------------------------------------------------
# Combined CI target — mirrors .github/workflows/rust-ci.yml + ci.yml
# ---------------------------------------------------------------------------

ci: fmt-check clippy taxonomy-lint test lint typecheck
	@echo ""
	@echo "✅  All CI checks passed locally."
	@echo ""

# ---------------------------------------------------------------------------
# End-to-end target
# ---------------------------------------------------------------------------

e2e:
	@echo "▶  Starting services via docker-compose…"
	docker compose up -d
	@echo "▶  Waiting for server to become healthy…"
	@timeout 60 sh -c 'until curl -sf http://localhost:3001/health; do sleep 2; done'
	@echo ""
	@echo "▶  Running Playwright tests…"
	pnpm --filter grat-web exec playwright test || (docker compose down && exit 1)
	@echo "▶  Tearing down services…"
	docker compose down
	@echo ""
	@echo "✅  e2e tests passed."
	@echo ""
