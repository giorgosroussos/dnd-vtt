# Emberglass root command contract (AGENTS.md "Commands", FND-01).
#
# Every target is real. Node targets need Node 24 or newer on PATH (`nvm use`
# reads .nvmrc); they check it first and say so instead of failing obscurely.
# The target list itself is the contract and does not change without a
# DECISIONS.md entry.
#
# `.env` (copied from `.env.example` by `make setup`) sets the development data
# directory and port for `make dev`, `make migrate` and `make smoke`. A value
# already in the environment wins over the file. The product itself never reads
# `.env` (specs/09-operations.md §7).

SHELL := /bin/bash
.DEFAULT_GOAL := help

ENV_FILE_VARS := EMBERGLASS_DATA_DIR EMBERGLASS_PORT
$(foreach v,$(ENV_FILE_VARS),$(if $(filter environment,$(origin $v)),$(eval _env_$v := $($v))))
-include .env
$(foreach v,$(ENV_FILE_VARS),$(if $(_env_$v),$(eval $v := $(_env_$v))))
export EMBERGLASS_DATA_DIR EMBERGLASS_PORT

NODE_MIN_MAJOR := 24
NODE_MAJOR = $(shell node -p "process.versions.node.split('.')[0]" 2>/dev/null)
SMOKE_WAIT ?= 0
# Browsers `make setup` installs for Playwright; CI sets it empty on jobs that run no browser.
SETUP_BROWSERS ?= chromium

.PHONY: help node-check setup infra-up infra-status infra-down migrate dev test lint format format-check typecheck e2e build verify smoke audit scan-secrets tripwire check-docs check-locks verify-chain rebuild-decisions rebuild-questions install-hooks unlock clean-start

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

node-check:
	@major='$(NODE_MAJOR)'; \
	 if [ -z "$$major" ] || [ "$$major" -lt $(NODE_MIN_MAJOR) ]; then \
	   echo "Node.js $(NODE_MIN_MAJOR) or newer is required on PATH (found: $$(node --version 2>/dev/null || echo none)). Run \`nvm use\`, which reads .nvmrc." >&2; exit 1; \
	 fi

setup: node-check ## Install dependencies from lockfiles, copy env examples
	npm ci
	@if [ -n "$(SETUP_BROWSERS)" ]; then npx playwright install $(SETUP_BROWSERS); else echo "SETUP_BROWSERS is empty: no Playwright browser installed."; fi
	@if [ -f .env ]; then echo ".env exists; left as it is."; else cp .env.example .env && echo "Copied .env.example to .env."; fi

infra-up: ## Start local infrastructure and wait for health
	@echo "No local infrastructure: Emberglass is one Node process with an SQLite file (specs/02-architecture.md §2). Nothing to start."

infra-status: ## Show infrastructure status
	@echo "No local infrastructure: there are no services to report on."

infra-down: ## Stop local infrastructure (data kept)
	@echo "No local infrastructure: nothing to stop."

migrate: node-check ## Apply database migrations locally
	npm run migrate

dev: node-check ## Run every application process for local development
	npm run dev

test: node-check ## All automated tests against the real database engine
	npm test

lint: node-check ## Linters
	npm run lint

format: node-check ## Apply formatting
	npm run format

format-check: node-check ## Verify formatting without changing files
	npm run format:check

typecheck: node-check ## Static analysis and type checks
	npm run typecheck

e2e: node-check ## End-to-end tests driving a DM view and a player view against a running server
	npm run e2e

build: node-check ## Production builds
	npm run build

verify: lint format-check typecheck test e2e build check-docs ## All quality gates

smoke: node-check ## Health of the running system through its public entry points
	node scripts/smoke.mjs --wait $(SMOKE_WAIT)

audit: node-check ## Dependency advisories
	npm audit --audit-level=high

scan-secrets: node-check ## Secret scan of everything Git tracks
	node scripts/scan-secrets.mjs

tripwire: node-check ## Failing-forward tripwire for a missing gate: make tripwire [GATE=<id>]; no GATE runs all
	node scripts/tripwire.mjs $(GATE)

verify-chain: ## Recompute every hash and link in the event log
	python3 scripts/verify-chain.py

rebuild-decisions: ## Render DECISIONS.md from the event log's decisions stream
	python3 scripts/rebuild-decisions.py

rebuild-questions: ## Render QUESTIONS.md from the event log's questions stream
	python3 scripts/rebuild-questions.py

# `rebuild-decisions` is deliberately NOT a prerequisite of check-docs: it would
# repair a drifted projection instead of failing on it, which is the opposite of
# what the gate is for. check-docs rebuilds into a buffer and compares.
check-docs: verify-chain ## Mechanical consistency of the documentation layer
	python3 scripts/check-docs.py

check-locks: ## Lock manifest check of the staged change (what the pre-commit hook runs)
	python3 scripts/lock-guard.py --staged

install-hooks: ## Point git at the versioned hooks in .githooks/ and re-apply read-only modes (once per clone)
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-commit .githooks/post-commit .githooks/pre-receive
	python3 scripts/lock-guard.py --relock
	@echo "hooks active from $$(git config core.hooksPath). The remote needs .githooks/pre-receive installed separately; see .githooks/README.md."

unlock: ## Ceremonial unlock of one hard-locked path: make unlock PATH=<path> REASON="why"
	@target='$(or $(TARGET),$(PATH))'; \
	 case "$$target" in *:*) target='' ;; esac; \
	 PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'; export PATH; \
	 sh scripts/unlock.sh "$$target" "$(REASON)"

clean-start: node-check ## Fresh isolated environment: setup, infra-up, migrate, verify, smoke, teardown
	bash scripts/clean-start.sh
