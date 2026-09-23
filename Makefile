# Emberglass root command contract (AGENTS.md "Commands").
#
# `check-docs`, `check-locks`, `verify-chain`, the two `rebuild-*` targets,
# `install-hooks` and `unlock` are real from the first commit. Every other target is delivered by
# the work package named in its recipe and, until then, fails with that message
# instead of passing: a missing gate and a passing gate must never look alike.
# FND-01 replaces the placeholder bodies with the real commands; the target list
# itself is the contract and does not change without a DECISIONS.md entry.

SHELL := /bin/bash
.DEFAULT_GOAL := help

define not_yet
	@echo "make $(1): not implemented yet. Delivered by work package $(2); see PLAN.md and specs/13-implementation-plan.md §3." >&2; exit 1
endef

.PHONY: help setup infra-up infra-status infra-down migrate dev test lint format format-check typecheck e2e build verify smoke audit scan-secrets check-docs check-locks verify-chain rebuild-decisions rebuild-questions install-hooks unlock clean-start

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

setup: ## Install dependencies from lockfiles, copy env examples
	$(call not_yet,setup,FND-01)

infra-up: ## Start local infrastructure and wait for health
	$(call not_yet,infra-up,FND-01)

infra-status: ## Show infrastructure status
	$(call not_yet,infra-status,FND-01)

infra-down: ## Stop local infrastructure (data kept)
	$(call not_yet,infra-down,FND-01)

migrate: ## Apply database migrations locally
	$(call not_yet,migrate,FND-01)

dev: ## Run every application process for local development
	$(call not_yet,dev,FND-01)

test: ## All automated tests against the real database engine
	$(call not_yet,test,FND-01)

lint: ## Linters
	$(call not_yet,lint,FND-01)

format: ## Apply formatting
	$(call not_yet,format,FND-01)

format-check: ## Verify formatting without changing files
	$(call not_yet,format-check,FND-01)

typecheck: ## Static analysis and type checks
	$(call not_yet,typecheck,FND-01)

e2e: ## End-to-end tests driving a DM view and a player view against a running server
	$(call not_yet,e2e,FND-01)

build: ## Production builds
	$(call not_yet,build,FND-01)

verify: lint format-check typecheck test e2e build check-docs ## All quality gates

smoke: ## Health of the running system through its public entry points
	$(call not_yet,smoke,FND-01)

audit: ## Dependency advisories
	$(call not_yet,audit,FND-01)

scan-secrets: ## Secret scan of everything Git tracks
	$(call not_yet,scan-secrets,FND-01)

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

clean-start: ## Fresh isolated environment: setup, infra-up, migrate, verify, smoke, teardown
	$(call not_yet,clean-start,FND-01)
