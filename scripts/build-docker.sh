#!/usr/bin/env bash
# Build the Linux build/test toolchain image (docker/Dockerfile).
#
#   ./scripts/build-docker.sh                 # build for the host architecture
#   ./scripts/build-docker.sh --platform linux/amd64
#   ./scripts/build-docker.sh --verify        # build, then exercise the toolchain
#   ./scripts/build-docker.sh --shell         # build, then drop into it on /work
#
# Publishing is CI's job (.github/workflows/docker.yml) — this script never
# pushes. On Apple Silicon the default build is arm64; the amd64 image CI runs
# on is only really proven by CI itself.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

: "${IMAGE:=ghcr.io/exegia/corpora-auth-ci}"
: "${TAG:=local}"

PLATFORM=""
VERIFY=0
SHELL_IN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="${2:-}"; shift ;;
    --verify) VERIFY=1 ;;
    --shell) SHELL_IN=1 ;;
    --tag) TAG="${2:-}"; shift ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
  shift
done

have docker || die "docker not found — install Docker Desktop or the engine"
docker info >/dev/null 2>&1 || die "the docker daemon is not running"

REF="$IMAGE:$TAG"

heading "Building $REF"
info "context: $REPO_ROOT (see .dockerignore — the image carries no repo sources)"
[ -n "$PLATFORM" ] && info "platform: $PLATFORM"

ARGS=(build -f "$REPO_ROOT/docker/Dockerfile" -t "$REF")
[ -n "$PLATFORM" ] && ARGS+=(--platform "$PLATFORM")
ARGS+=("$REPO_ROOT")

docker "${ARGS[@]}"
ok "built $REF"

# The Dockerfile already runs this check at build time; repeating it against the
# finished image catches anything a later layer broke.
if [ "$VERIFY" -eq 1 ]; then
  heading "Toolchain"
  docker run --rm "$REF" bash -lc '
    set -e
    printf "  rust      %s\n" "$(rustc --version)"
    printf "  cargo     %s\n" "$(cargo --version)"
    printf "  clippy    %s\n" "$(cargo clippy --version)"
    printf "  rustfmt   %s\n" "$(cargo fmt --version)"
    printf "  bun       %s\n" "$(bun --version)"
    printf "  node      %s\n" "$(node --version)"
    printf "  supabase  %s\n" "$(supabase --version)"
    pkg-config --exists webkit2gtk-4.1 && printf "  webkit2gtk-4.1 present\n"
  '
  ok "toolchain verified"
fi

if [ "$SHELL_IN" -eq 1 ]; then
  heading "Shell"
  info "repo mounted at /work"
  exec docker run --rm -it -v "$REPO_ROOT:/work" -w /work "$REF" bash
fi

heading "Next"
info "poke around:   ./scripts/build-docker.sh --shell"
info "publish:       push to dev/next/main — .github/workflows/docker.yml does it"
echo ""
