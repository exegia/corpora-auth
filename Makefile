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

# `--frozen-lockfile` in CI (the workflows set it), a plain install locally.
INSTALL_FLAGS ?=

# Workspace package names, so the targets read the way the registry does.
# Every script in every workspace package.json has a target below; `make help`
# is the index. The mapping is:
#
#   guest-js  @exegia/plugin-supabase-auth  build test
#   ui        @exegia/use-auth              build test typecheck
#   tauri-app tauri-app                    dev build preview tauri test
#   web-app   web-app                      dev build start
#
PKG_BINDINGS := @exegia/plugin-supabase-auth
PKG_UI       := @exegia/use-auth
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
install: ## bun install across the workspace (INSTALL_FLAGS=--frozen-lockfile in CI)
	@cd "$(REPO_ROOT)" && $(BUN) install $(INSTALL_FLAGS)

.PHONY: doctor
doctor: ## Diagnose the toolchain, Supabase stack and ports
	@"$(EXAMPLE)/scripts/doctor.sh"

# ---------------------------------------------------------------- run

# Both example apps render @exegia/use-auth, which imports the bindings package.
# That resolves to guest-js/dist through the workspace link, so the bindings
# have to exist before either dev server can start — the same ordering
# `test:ui` relies on.
#
# The web example goes one step further: its tsconfig maps @exegia/use-auth to
# react/dist (see the comment there), and bun honours tsconfig paths, so it needs
# the built UI kit rather than just the bindings. `build-ui` already depends on
# `build-bindings`.

dev\:web: dev-web ## Run the web example (Bun dev server, hot reload, port 3000)
dev-web: build-ui
	@cd "$(WEB)" && $(BUN) run dev

dev\:tauri: dev-tauri ## Run the Tauri example (Vite + Tauri)
dev-tauri: build-bindings
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" dev

dev\:mcp: dev-mcp ## Run the Tauri example with window.__TAURI__ exposed, for tauri-mcp
dev-mcp: build-bindings
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" dev-mcp

start\:web: start-web ## Serve the web example in production mode
start-web: build-ui
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

build\:ui: build-ui ## Build @exegia/use-auth into react/dist (needs the bindings' dist)
build-ui: build-bindings
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_UI)' build

build\:plugin: build-plugin ## Verify the Rust crate packages cleanly for crates.io (cargo publish --dry-run)
build-plugin:
	@"$(SCRIPTS)/build-plugin.sh"

build\:example: build-example ## Build the Tauri example's frontend bundle
build\:tauri: build-example ## Alias for build:example
build-example: build-ui
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" build

build\:web: build-web ## Build the web example's frontend bundle
build-web: build-ui
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
# is the same ordering the `check` job in .github/workflows/pr.yml relies on.
test\:ui: test-ui ## vitest for @exegia/use-auth (builds the bindings first)
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
typecheck: typecheck-ui typecheck-tauri typecheck-web ## tsc --noEmit across the TypeScript packages

# Same ordering `test-ui` needs, and for the same reason: the hooks import
# @exegia/plugin-supabase-auth, which resolves through the workspace link to
# guest-js/dist. Without this the whole package type-checks against a module
# that does not exist — every import becomes TS2307 and everything downstream
# of it implicit `any`. Only shows up on a cold tree, which is why `make ci`
# has to be verified after `make clean:build`.
typecheck\:ui: typecheck-ui ## tsc --noEmit for @exegia/use-auth (builds the bindings first)
typecheck-ui: build-bindings
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_UI)' typecheck

typecheck\:tauri: typecheck-tauri ## tsc --noEmit for the Tauri example
typecheck-tauri:
	@$(MAKE) --no-print-directory -C "$(EXAMPLE)" typecheck

# Resolves @exegia/use-auth through react/dist, so the package has to be built first.
typecheck\:web: typecheck-web ## tsc --noEmit for the web example
typecheck-web: build-ui
	@cd "$(REPO_ROOT)" && $(BUN) run --filter '$(PKG_WEB)' typecheck

# ---------------------------------------------------------------- release

# Everything .github/workflows/*.yml does is one of these, so a workflow step is
# always a one-line `make` and always reproducible locally. See .github/WORKFLOW.md
# for the branch flow they implement.
#
#   BUMP=major|minor|patch   which version `release:branch` cuts next
#   VERSION=x.y.z            an explicit version, overriding BUMP
#   RANGE=a..b               commit range for `release:notes`
#   BASE/HEAD/TITLE          the PR `pr:guard` validates
#   BRANCH                   the branch `release:pr` / `release:delete` acts on
BUMP    ?= minor
VERSION ?=
RANGE   ?=
BRANCH  ?=

export BUMP VERSION RANGE BRANCH

.PHONY: ci
ci: install check test build ## Everything CI runs on a pull request

pr\:guard: pr-guard ## Validate a PR's base, branch name and title (env: BASE, HEAD, TITLE)
pr-guard:
	@"$(SCRIPTS)/release.sh" guard

version\:current: version-current ## Print the version the three manifests declare
version-current:
	@"$(SCRIPTS)/version.sh" current

version\:next: version-next ## Print the version after the newest vX.Y.Z tag (env: BUMP)
version-next:
	@"$(SCRIPTS)/version.sh" next "$(BUMP)"

version\:set: version-set ## Write VERSION into both packages and the crate, refresh lockfiles
version-set:
	@"$(SCRIPTS)/version.sh" set "$(VERSION)"

version\:check: version-check ## Fail unless both packages and the crate agree on one version
version-check:
	@"$(SCRIPTS)/version.sh" check

release\:notes: release-notes ## Print a markdown changelog for RANGE (default origin/main..HEAD)
release-notes:
	@"$(SCRIPTS)/release.sh" notes

release\:pr: release-pr ## Open or refresh the draft release PR into main (env: BRANCH)
release-pr:
	@"$(SCRIPTS)/release.sh" pr

release\:branch: release-branch ## Cut release/v<next> from main with the versions bumped
release-branch:
	@"$(SCRIPTS)/release.sh" branch

release\:delete: release-delete ## Delete a remote branch, tolerating one already gone (env: BRANCH)
release-delete:
	@"$(SCRIPTS)/release.sh" delete

release\:tag: release-tag ## Tag v<version> and publish the GitHub Release
release-tag:
	@"$(SCRIPTS)/release.sh" tag

.PHONY: publish
publish: publish-bindings publish-ui publish-crate ## Publish all three artifacts (CI only — needs registry tokens)

publish\:bindings: publish-bindings ## Publish @exegia/plugin-supabase-auth to GitHub Packages
publish-bindings:
	@"$(SCRIPTS)/publish.sh" bindings

publish\:ui: publish-ui ## Publish @exegia/use-auth to npmjs.org
publish-ui:
	@"$(SCRIPTS)/publish.sh" ui

publish\:crate: publish-crate ## Publish tauri-plugin-supabase-auth to crates.io (skips without a token)
publish-crate:
	@"$(SCRIPTS)/publish.sh" crate

rulesets\:diff: rulesets-diff ## List the rulesets GitHub currently has
rulesets-diff:
	@"$(SCRIPTS)/release.sh" rulesets

rulesets\:apply: rulesets-apply ## Push .github/rulesets/*.json to GitHub (matched by name)
rulesets-apply:
	@"$(SCRIPTS)/release.sh" rulesets --apply

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
.PHONY: typecheck\:ui typecheck\:tauri typecheck\:web
.PHONY: typecheck-ui typecheck-tauri typecheck-web
.PHONY: pr\:guard version\:current version\:next version\:set version\:check
.PHONY: pr-guard version-current version-next version-set version-check
.PHONY: release\:notes release\:pr release\:branch release\:delete release\:tag
.PHONY: release-notes release-pr release-branch release-delete release-tag
.PHONY: publish\:bindings publish\:ui publish\:crate rulesets\:diff rulesets\:apply
.PHONY: publish-bindings publish-ui publish-crate rulesets-diff rulesets-apply
.PHONY: clean\:build clean\:dry clean-build clean-dry
