# tauri-plugin-supabase-auth — repository task runner.
#
#   make                 # list targets
#   make setup           # install everything
#   make build test      # build all artifacts, run all suites
#
# Target names use the `area:thing` form the team asked for. The example app has
# its own Makefile; the `example:*` targets here delegate to it rather than
# duplicating it — run `make -C examples/tauri-app help` for the full list.

SHELL := /bin/bash

REPO_ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
SCRIPTS   := $(REPO_ROOT)/scripts
EXAMPLE   := $(REPO_ROOT)/examples/tauri-app

PNPM ?= pnpm

# Workspace package names, so the targets read the way the registry does.
PKG_BINDINGS := @exegia/plugin-supabase-auth
PKG_UI       := @exegia/auth-ui
CRATE        := tauri-plugin-supabase-auth

# Where `make pack` drops inspectable tarballs.
DIST := $(REPO_ROOT)/dist-packages

export REPO_ROOT SCRIPTS EXAMPLE PNPM PKG_BINDINGS PKG_UI CRATE DIST

.DEFAULT_GOAL := help

# ---------------------------------------------------------------- meta

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "  tauri-plugin-supabase-auth"
	@echo ""
	@awk 'BEGIN {FS = "## "} \
		/^# -+ [a-z]/ { sub(/^# -+ /, ""); printf "\n  \033[1m%s\033[0m\n", $$0; next } \
		/^[a-zA-Z0-9_\\:-]+:.*## / { \
			target = $$1; \
			if (match(target, /[^\\]:/)) target = substr(target, 1, RSTART); \
			gsub(/\\/, "", target); \
			printf "    \033[36m%-20s\033[0m %s\n", target, $$2 }' \
		$(REPO_ROOT)/Makefile
	@echo ""
	@echo "  Example app targets: make -C examples/tauri-app help"
	@echo ""

# ---------------------------------------------------------------- setup

.PHONY: setup
setup: install ## Install dependencies and preflight the toolchain
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" doctor

.PHONY: install
install: ## pnpm install across the workspace
	@cd "$(REPO_ROOT)" && $(PNPM) install

.PHONY: doctor
doctor: ## Diagnose the toolchain, Supabase stack and ports
	@"$(EXAMPLE)/scripts/doctor.sh"

# ---------------------------------------------------------------- build

# The `area:thing` names are aliases over plain-named rules. GNU make accepts an
# escaped colon in a target but does not resolve one in a *prerequisite* list, so
# every dependency below is expressed between the plain names.

.PHONY: build
build: build-bindings build-ui build-plugin ## Build every publishable artifact

build\:bindings: build-bindings ## Build @exegia/plugin-supabase-auth (tsup, esm+cjs+dts)
build-bindings:
	@cd "$(REPO_ROOT)" && $(PNPM) --filter $(PKG_BINDINGS) build

build\:ui: build-ui ## Build @exegia/auth-ui into ui/dist (needs the bindings' dist)
build-ui: build-bindings
	@cd "$(REPO_ROOT)" && $(PNPM) --filter $(PKG_UI) build

build\:plugin: build-plugin ## Verify the Rust crate packages cleanly for crates.io (cargo publish --dry-run)
build-plugin:
	@"$(SCRIPTS)/build-plugin.sh"

build\:example: build-example ## Build the example app's frontend bundle
build-example: build-ui
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" build

build\:docker: build-docker ## (unspecified — prints the candidate readings and exits)
build-docker:
	@"$(SCRIPTS)/build-docker.sh"

.PHONY: pack
pack: build-bindings build-ui ## Produce inspectable npm tarballs in dist-packages/
	@mkdir -p "$(DIST)"
	@cd "$(REPO_ROOT)/guest-js" && $(PNPM) pack --pack-destination "$(DIST)"
	@cd "$(REPO_ROOT)/ui" && $(PNPM) pack --pack-destination "$(DIST)"
	@echo ""
	@ls -1 "$(DIST)"
	@echo ""
	@echo "Publishing is done by .github/workflows/release.yml, not from a dev machine."

# ---------------------------------------------------------------- test

.PHONY: test
test: test-rust test-ui ## Run every offline suite (Rust + UI)

test\:rust: test-rust ## cargo test for the plugin crate
test\:plugin: test-rust ## Alias for test:rust
test-rust:
	@cd "$(REPO_ROOT)" && cargo test

# The UI suite imports @exegia/plugin-supabase-auth, which resolves through the
# workspace link to guest-js/dist — so the bindings have to be built first. This
# is the same ordering the `web` job in .github/workflows/ci.yml relies on.
test\:ui: test-ui ## vitest for @exegia/auth-ui (builds the bindings first)
test-ui: build-bindings
	@cd "$(REPO_ROOT)" && $(PNPM) --filter $(PKG_UI) test

test\:e2e: test-e2e ## Full auth lifecycle against the local Supabase stack
test-e2e:
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" test-e2e

test\:example: test-example ## Run the example app's own test script
test-example:
	@cd "$(REPO_ROOT)" && $(PNPM) --filter tauri-app test

# ---------------------------------------------------------------- quality

.PHONY: check
check: lint typecheck ## Lint and type-check everything

.PHONY: lint
lint: ## cargo fmt --check + clippy for the plugin and the example
	@cd "$(REPO_ROOT)" && cargo fmt --check
	@cd "$(REPO_ROOT)" && cargo clippy --all-targets -- -D warnings
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" lint

.PHONY: fmt
fmt: ## Format the Rust sources
	@cd "$(REPO_ROOT)" && cargo fmt
	@cd "$(EXAMPLE)/src-tauri" && cargo fmt

.PHONY: typecheck
typecheck: ## tsc --noEmit across the TypeScript packages
	@cd "$(REPO_ROOT)" && $(PNPM) --filter $(PKG_UI) typecheck
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" typecheck

# ---------------------------------------------------------------- supabase

.PHONY: supabase-up
supabase-up: ## Start the local Supabase stack
	@cd "$(REPO_ROOT)" && supabase start

.PHONY: supabase-down
supabase-down: ## Stop the local Supabase stack
	@cd "$(REPO_ROOT)" && supabase stop

.PHONY: supabase-status
supabase-status: ## Show local Supabase service URLs and keys
	@cd "$(REPO_ROOT)" && supabase status

# ---------------------------------------------------------------- clean

.PHONY: clean
clean: ## Remove node_modules, build output, Cargo targets and generated files
	@"$(SCRIPTS)/clean.sh"

clean\:build: clean-build ## Remove build output only, keeping node_modules
clean-build:
	@"$(SCRIPTS)/clean.sh" --keep-deps

clean\:dry: clean-dry ## Show what clean would remove, without removing it
clean-dry:
	@"$(SCRIPTS)/clean.sh" --dry-run

# Declared last so both spellings of every target are covered in one place.
.PHONY: build\:bindings build\:ui build\:plugin build\:example build\:docker
.PHONY: build-bindings build-ui build-plugin build-example build-docker
.PHONY: test\:rust test\:plugin test\:ui test\:e2e test\:example
.PHONY: test-rust test-ui test-e2e test-example
.PHONY: clean\:build clean\:dry clean-build clean-dry
