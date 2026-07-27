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
WEB       := $(REPO_ROOT)/examples/web-app

BUN ?= bun

# Workspace package names, so the targets read the way the registry does.
# Every script in every workspace package.json has a target below; `make help`
# is the index. The mapping is:
#
#   guest-js  @exegia/plugin-supabase-auth  build test
#   ui        @exegia/auth-ui              build test typecheck
#   tauri-app tauri-app                    dev build preview tauri test
#   web-app   web-app                      dev build start
#
PKG_BINDINGS := @exegia/plugin-supabase-auth
PKG_UI       := @exegia/auth-ui
PKG_TAURI    := tauri-app
PKG_WEB      := web-app
CRATE        := tauri-plugin-supabase-auth

# Extra arguments forwarded by the `tauri` passthrough target: make tauri ARGS="info"
ARGS ?=

# Where `make pack` drops inspectable tarballs.
DIST := $(REPO_ROOT)/dist-packages

export REPO_ROOT SCRIPTS EXAMPLE WEB BUN PKG_BINDINGS PKG_UI PKG_TAURI PKG_WEB CRATE DIST

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
	@echo "  Tauri example targets: make -C examples/tauri-app help"
	@echo ""

# ---------------------------------------------------------------- setup

.PHONY: setup
setup: install ## Install dependencies and preflight the toolchain
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" doctor

.PHONY: install
install: ## bun install across the workspace
	@cd "$(REPO_ROOT)" && $(BUN) install

.PHONY: doctor
doctor: ## Diagnose the toolchain, Supabase stack and ports
	@"$(EXAMPLE)/scripts/doctor.sh"

# ---------------------------------------------------------------- run

# Both example apps render @exegia/auth-ui, which imports the bindings package.
# That resolves to guest-js/dist through the workspace link, so the bindings
# have to exist before either dev server can start — the same ordering
# `test:ui` relies on.

dev\:web: dev-web ## Run the web example (Bun dev server, hot reload, port 3000)
dev-web: build-bindings
	@cd "$(WEB)" && $(BUN) run dev

dev\:tauri: dev-tauri ## Run the Tauri example (Vite + Tauri)
dev-tauri: build-bindings
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" dev

dev\:mcp: dev-mcp ## Run the Tauri example with window.__TAURI__ exposed, for tauri-mcp
dev-mcp: build-bindings
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" dev-mcp

start\:web: start-web ## Serve the web example in production mode
start-web: build-bindings
	@cd "$(WEB)" && $(BUN) run start

preview\:tauri: preview-tauri ## Serve the built Tauri frontend without Tauri
preview-tauri:
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" preview

.PHONY: tauri
tauri: ## Run the Tauri CLI in the example app: make tauri ARGS="info"
	@cd "$(EXAMPLE)" && $(BUN) run tauri $(ARGS)

# ---------------------------------------------------------------- build

# The `area:thing` names are aliases over plain-named rules. GNU make accepts an
# escaped colon in a target but does not resolve one in a *prerequisite* list, so
# every dependency below is expressed between the plain names.

.PHONY: build
build: build-bindings build-ui build-plugin ## Build every publishable artifact

build\:bindings: build-bindings ## Build @exegia/plugin-supabase-auth (tsup, esm+cjs+dts)
build-bindings:
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_BINDINGS)' build

build\:ui: build-ui ## Build @exegia/auth-ui into ui/dist (needs the bindings' dist)
build-ui: build-bindings
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_UI)' build

build\:plugin: build-plugin ## Verify the Rust crate packages cleanly for crates.io (cargo publish --dry-run)
build-plugin:
	@"$(SCRIPTS)/build-plugin.sh"

build\:example: build-example ## Build the Tauri example's frontend bundle
build\:tauri: build-example ## Alias for build:example
build-example: build-ui
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" build

# The web example bundles @exegia/auth-ui from source (its package entry points
# at src/), so it needs the bindings' dist but not ui/dist.
build\:web: build-web ## Build the web example's frontend bundle
build-web: build-bindings
	@cd "$(WEB)" && $(BUN) run build

build\:docker: build-docker ## Build the Linux CI toolchain image (CI publishes it to GHCR)
build-docker:
	@"$(SCRIPTS)/build-docker.sh" --verify

docker\:shell: docker-shell ## Build the image and open a shell in it with the repo mounted
docker-shell:
	@"$(SCRIPTS)/build-docker.sh" --shell

.PHONY: pack
pack: build-bindings build-ui ## Produce inspectable npm tarballs in dist-packages/
	@"$(SCRIPTS)/pack.sh"

# ---------------------------------------------------------------- test

.PHONY: test
test: test-rust test-ui ## Run every offline suite (Rust + UI)

test\:rust: test-rust ## cargo test for the plugin crate
test\:plugin: test-rust ## Alias for test:rust
test-rust:
	@cd "$(REPO_ROOT)" && cargo test

test\:bindings: test-bindings ## Run @exegia/plugin-supabase-auth's test script
test-bindings:
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_BINDINGS)' test

test\:workspaces: test-workspaces ## Run the `test` script in every workspace package
test-workspaces: build-bindings
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '*' test

# The UI suite imports @exegia/plugin-supabase-auth, which resolves through the
# workspace link to guest-js/dist — so the bindings have to be built first. This
# is the same ordering the `web` job in .github/workflows/ci.yml relies on.
test\:ui: test-ui ## vitest for @exegia/auth-ui (builds the bindings first)
test-ui: build-bindings
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_UI)' test

test\:e2e: test-e2e ## Full auth lifecycle against the local Supabase stack
test-e2e:
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" test-e2e

test\:example: test-example ## Run the Tauri example's own test script
test-example:
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_TAURI)' test

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
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_UI)' typecheck
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
.PHONY: dev\:web dev\:tauri dev\:mcp start\:web preview\:tauri
.PHONY: dev-web dev-tauri dev-mcp start-web preview-tauri
.PHONY: build\:bindings build\:ui build\:plugin build\:example build\:tauri build\:web build\:docker docker\:shell
.PHONY: build-bindings build-ui build-plugin build-example build-web build-docker docker-shell
.PHONY: test\:rust test\:plugin test\:bindings test\:workspaces test\:ui test\:e2e test\:example
.PHONY: test-rust test-bindings test-workspaces test-ui test-e2e test-example
.PHONY: clean\:build clean\:dry clean-build clean-dry
