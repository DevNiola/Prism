# =============================================================================
# Prism — Makefile
# =============================================================================
# Provides convenient shortcuts for common development tasks.
#
# Usage:
#   make up        — build images and start all services in the background
#   make down      — stop and remove containers
#   make logs      — stream logs from all services
#   make restart   — restart all services
#   make clean     — stop containers and remove volumes (DESTRUCTIVE)
#   make ps        — show running containers
#   make build     — build all Docker images without starting
#
# Rust shortcuts:
#   make rust-build  — cargo build --workspace
#   make rust-test   — cargo test --workspace
#   make rust-fmt    — cargo fmt --all
#   make rust-lint   — cargo clippy --workspace
#
# Node shortcuts:
#   make install   — pnpm install
#   make web-dev   — start Next.js dev server
#   make server-dev — start Fastify dev server
# =============================================================================

.PHONY: up down logs restart clean ps build \
        rust-build rust-test rust-fmt rust-lint \
        install web-dev server-dev

COMPOSE := docker compose

# ---------------------------------------------------------------------------
# Docker Compose targets
# ---------------------------------------------------------------------------

## up: build images and start all services in detached mode
up:
	$(COMPOSE) up --build -d

## down: stop and remove containers (volumes are preserved)
down:
	$(COMPOSE) down

## logs: follow logs from all running services
logs:
	$(COMPOSE) logs -f

## restart: restart all services
restart:
	$(COMPOSE) restart

## clean: stop containers and destroy all volumes (data will be lost)
clean:
	$(COMPOSE) down -v --remove-orphans

## ps: list running containers for this project
ps:
	$(COMPOSE) ps

## build: build all Docker images without starting
build:
	$(COMPOSE) build

# ---------------------------------------------------------------------------
# Rust targets
# ---------------------------------------------------------------------------

## rust-build: build the entire Cargo workspace
rust-build:
	cargo build --workspace --all-targets

## rust-test: run all Rust tests
rust-test:
	cargo test --workspace --all-targets

## rust-fmt: auto-format all Rust code
rust-fmt:
	cargo fmt --all

## rust-lint: run Clippy lints across the workspace
rust-lint:
	cargo clippy --workspace --all-targets -- -D warnings

# ---------------------------------------------------------------------------
# Node / pnpm targets
# ---------------------------------------------------------------------------

## install: install all Node dependencies via pnpm
install:
	pnpm install

## web-dev: start the Next.js web app in development mode
web-dev:
	pnpm --filter grat-web run dev

## server-dev: start the Fastify server in development mode
server-dev:
	pnpm --filter grat-server run dev
