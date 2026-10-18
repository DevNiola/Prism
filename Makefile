# Prism - Soroban Transaction Debugger
# Local Development & Orchestration Makefile

.PHONY: help up down restart logs ps clean build

help:
	@echo "Prism Local Development Commands:"
	@echo "  make up       - Start all services (web, server, redis) in background"
	@echo "  make down     - Stop all running services"
	@echo "  make restart  - Restart all services"
	@echo "  make logs     - Follow logs from all services"
	@echo "  make ps       - List container statuses and health"
	@echo "  make build    - Rebuild all container images"
	@echo "  make clean    - Remove containers, networks, and Redis volumes"

up:
	docker compose up -d --build

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

ps:
	docker compose ps

build:
	docker compose build

clean:
	docker compose down -v --remove-orphans
