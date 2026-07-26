#!/usr/bin/env bash
# `make build:docker` — deliberately unimplemented.
#
# The request left this one as "...", and there is no Docker anywhere in the
# repo to infer an answer from: no Dockerfile, no compose file, no image
# reference in CI. This is a Rust crate plus two npm packages plus a desktop
# example — there is no long-running service to containerize, so guessing here
# would mean inventing an artifact nobody asked for.
#
# Fill this in once the intent is settled; the three readings below produce
# very different images.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

heading "build:docker is not implemented yet"

info "No Dockerfile or compose file exists in this repo, and the brief left this"
info "target unspecified. Pick a reading and this script becomes a few lines."

heading "Candidate readings"

printf '  %s1. Linux build/test toolchain image%s\n' "$C_BOLD" "$C_RESET"
info "   Rust + libwebkit2gtk-4.1-dev + node/pnpm, mirroring the ubuntu jobs in"
info "   .github/workflows/ci.yml. Lets macOS developers reproduce the Linux"
info "   build locally and gives CI a warm cache. Publishable to ghcr.io."

printf '\n  %s2. Devcontainer%s\n' "$C_BOLD" "$C_RESET"
info "   Same base as (1) plus the supabase CLI and editor tooling, wired up as"
info "   .devcontainer/ rather than a published image."

printf '\n  %s3. Something else entirely%s\n' "$C_BOLD" "$C_RESET"
info "   e.g. pinning the local Supabase stack — but 'supabase start' already"
info "   manages its own containers, so this would duplicate the CLI."

heading "Note on registries"

info "ghcr.io is a container registry: the npm packages cannot be published"
info "there. @exegia/auth-ui and @exegia/plugin-supabase-auth already publish to"
info "GitHub Packages (npm.pkg.github.com) via publishConfig — see 'make pack'."

echo ""
die "choose a reading above, then implement scripts/build-docker.sh"
