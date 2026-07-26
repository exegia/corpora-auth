# Supabase Auth example app — developer task runner.
#
#   make            # list targets
#   make setup      # one-time machine + workspace preflight
#   make supabase-up dev
#
# Every target can be run from this directory or via `make -C examples/tauri-app <target>`.

SHELL := /bin/bash

MAKEFILE_PATH := $(abspath $(lastword $(MAKEFILE_LIST)))
APP_DIR       := $(patsubst %/,%,$(dir $(MAKEFILE_PATH)))
REPO_ROOT     := $(abspath $(APP_DIR)/../..)
SCRIPTS       := $(APP_DIR)/scripts
TAURI_DIR     := $(APP_DIR)/src-tauri
MCP_CONFIG    := $(TAURI_DIR)/tauri.mcp.conf.json
ARTIFACTS     := $(APP_DIR)/.mcp-artifacts

PKG  := tauri-app
BUN ?= bun

# Ports. Override on the command line, e.g. `make dev-mcp MCP_PORT=9225`.
VITE_PORT     ?= 1420
MCP_PORT      ?= 9223
SUPABASE_PORT ?= 54321
MAIL_URL      ?= http://127.0.0.1:54324

# Exported so the scripts see the same values as the Makefile.
export REPO_ROOT APP_DIR TAURI_DIR MCP_CONFIG ARTIFACTS
export VITE_PORT MCP_PORT SUPABASE_PORT MAIL_URL PKG BUN

.DEFAULT_GOAL := help

# ---------------------------------------------------------------- meta

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "  Supabase Auth example app"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} \
		/^# -+ [a-z]/ { sub(/^# -+ /, ""); printf "\n  \033[1m%s\033[0m\n", $$0; next } \
		/^[a-zA-Z0-9_-]+:.*?## / { printf "    \033[36m%-24s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_PATH)
	@echo ""

# ---------------------------------------------------------------- setup

.PHONY: setup
setup: ## Preflight the toolchain and install workspace dependencies
	@"$(SCRIPTS)/setup.sh"

.PHONY: install
install: ## bun install at the repo root (installs the whole workspace)
	@cd "$(REPO_ROOT)" && $(BUN) install

.PHONY: doctor
doctor: ## Diagnose toolchain, ports, Supabase stack and MCP wiring
	@"$(SCRIPTS)/doctor.sh"

# ---------------------------------------------------------------- run

.PHONY: dev
dev: ## Run the app in development mode (Vite + Tauri)
	@cd "$(APP_DIR)" && $(BUN) run tauri dev

.PHONY: dev-mcp
dev-mcp: ## Run in dev mode with window.__TAURI__ exposed, for tauri-mcp automation
	@echo "==> dev + MCP overlay ($(MCP_CONFIG))"
	@echo "    withGlobalTauri is enabled for this run only; the committed config stays off."
	@echo "    bridge base port: $(MCP_PORT)"
	@cd "$(APP_DIR)" && MCP_BRIDGE_PORT=$(MCP_PORT) $(BUN) run tauri dev --config "$(MCP_CONFIG)"

.PHONY: preview
preview: ## Serve the built frontend without Tauri
	@cd "$(APP_DIR)" && $(BUN) run preview

# ---------------------------------------------------------------- build

.PHONY: build
build: ## Type-check and build the frontend bundle
	@cd "$(APP_DIR)" && $(BUN) run build

.PHONY: build-app
build-app: ## Build the Tauri app binary (bundling is disabled in tauri.conf.json)
	@cd "$(APP_DIR)" && $(BUN) run tauri build

.PHONY: typecheck
typecheck: ## tsc --noEmit for the example frontend
	@cd "$(APP_DIR)" && $(BUN) x tsc --noEmit

.PHONY: fmt
fmt: ## Format the example's Rust sources
	@cd "$(TAURI_DIR)" && cargo fmt

.PHONY: lint
lint: ## cargo fmt --check + clippy for the example's own Cargo workspace
	@cd "$(TAURI_DIR)" && cargo fmt --check
	@cd "$(TAURI_DIR)" && cargo clippy --all-targets -- -D warnings

.PHONY: check
check: typecheck lint ## typecheck + lint

# ---------------------------------------------------------------- test

.PHONY: test
test: ## Run the workspace unit tests (plugin + UI kit)
	@cd "$(REPO_ROOT)" && $(BUN) run test

.PHONY: test-e2e
test-e2e: ## Run the live-stack Rust E2E lifecycle tests (needs `make supabase-up`)
	@"$(SCRIPTS)/doctor.sh" --require supabase
	@cd "$(REPO_ROOT)" && eval "$$(supabase status -o env)" && \
		SUPABASE_E2E_URL="$${SUPABASE_E2E_URL:-$$API_URL}" \
		SUPABASE_E2E_KEY="$${SUPABASE_E2E_KEY:-$$ANON_KEY}" \
		$(BUN) run test:e2e

# ---------------------------------------------------------------- supabase

.PHONY: supabase-up
supabase-up: ## Start the local Supabase stack (config lives at the repo root)
	@cd "$(REPO_ROOT)" && supabase start

.PHONY: supabase-down
supabase-down: ## Stop the local Supabase stack
	@cd "$(REPO_ROOT)" && supabase stop

.PHONY: supabase-restart
supabase-restart: supabase-down supabase-up ## Restart the stack (needed after editing supabase/config.toml)

.PHONY: supabase-status
supabase-status: ## Show local Supabase service URLs and keys
	@cd "$(REPO_ROOT)" && supabase status

.PHONY: supabase-reset
supabase-reset: ## Reset the local database (destroys all local auth users)
	@echo "This deletes every user and row in the local Supabase database."
	@read -r -p "Type 'reset' to continue: " ans; \
		if [ "$$ans" = "reset" ]; then cd "$(REPO_ROOT)" && supabase db reset; \
		else echo "Aborted."; exit 1; fi

.PHONY: supabase-flags
supabase-flags: ## Report the auth flags the README walkthroughs depend on
	@"$(SCRIPTS)/supabase-flags.sh"

.PHONY: mail
mail: ## Open the local mailbox (magic links, OTP codes, recovery codes)
	@echo "$(MAIL_URL)"
	@command -v open >/dev/null 2>&1 && open "$(MAIL_URL)" || true

# ---------------------------------------------------------------- mcp

.PHONY: mcp-install
mcp-install: ## Install the tauri-mcp CLI globally (otherwise npx is used per call)
	@"$(SCRIPTS)/mcp.sh" install

.PHONY: mcp-doctor
mcp-doctor: ## Verify every prerequisite for tauri-mcp automation
	@"$(SCRIPTS)/doctor.sh" --mcp --require mcp

.PHONY: mcp-start
mcp-start: ## Start a driver session against the running app and assert it connected
	@"$(SCRIPTS)/mcp.sh" start

.PHONY: mcp-status
mcp-status: ## Print driver session status as JSON
	@"$(SCRIPTS)/mcp.sh" status

.PHONY: mcp-stop
mcp-stop: ## Stop the driver session
	@"$(SCRIPTS)/mcp.sh" stop

.PHONY: mcp-restart
mcp-restart: ## Restart the keep-alive daemon and re-establish the session
	@"$(SCRIPTS)/mcp.sh" restart

.PHONY: mcp-shot
mcp-shot: ## Screenshot the webview into .mcp-artifacts/ (FILE=path to override)
	@"$(SCRIPTS)/mcp.sh" shot $(FILE)

.PHONY: mcp-logs
mcp-logs: ## Tail the webview console log (FILTER=text to narrow)
	@"$(SCRIPTS)/mcp.sh" logs $(FILTER)

# ---------------------------------------------------------------- clean

.PHONY: clean
clean: ## Remove build output and MCP artifacts (keeps dependencies)
	@rm -rf "$(APP_DIR)/dist" "$(ARTIFACTS)"
	@cd "$(TAURI_DIR)" && cargo clean
	@echo "Cleaned frontend dist, example target/ and MCP artifacts."

.PHONY: clean-plugin
clean-plugin: ## Also clean the plugin's own Cargo target dir at the repo root
	@cd "$(REPO_ROOT)" && cargo clean

.PHONY: distclean
distclean: clean clean-plugin ## Clean everything including node_modules
	@rm -rf "$(REPO_ROOT)/node_modules" "$(APP_DIR)/node_modules" \
		"$(REPO_ROOT)/ui/node_modules" "$(REPO_ROOT)/guest-js/node_modules"
	@echo "Removed node_modules. Run 'make setup' to reinstall."
