# Linux build/test toolchain for tauri-plugin-supabase-auth.
#
# Reproduces what the ubuntu jobs in .github/workflows/ci.yml install, so a
# macOS or Windows developer can run the Linux build locally and CI can skip
# the per-run toolchain setup. Contains no repo sources — mount or clone the
# working tree into it.
#
#   docker run --rm -it -v "$PWD:/work" ghcr.io/exegia/corpora-auth-ci
#
# Base is ubuntu:24.04 to match the ubuntu-24.04 runner image.
FROM ubuntu:24.04

# Pinned deliberately: the point of the image is that everyone gets the same
# toolchain. bun tracks package.json's packageManager field.
ARG RUST_VERSION=stable
ARG BUN_VERSION=1.3.2
ARG NODE_VERSION=20.20.2
ARG SUPABASE_VERSION=2.109.1

ENV DEBIAN_FRONTEND=noninteractive \
    CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    BUN_INSTALL=/usr/local/bun
ENV PATH=$CARGO_HOME/bin:$BUN_INSTALL/bin:$PATH

# The Tauri system dependencies are copied verbatim from ci.yml's `rust` job —
# that exact line is proven on ubuntu-24.04, so it is not "modernised" here.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libdbus-1-dev \
      build-essential pkg-config libssl-dev \
      ca-certificates curl git unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Rust, with the components the clippy/fmt jobs need.
RUN curl -fsSL https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal \
          --default-toolchain "$RUST_VERSION" --component clippy --component rustfmt \
    && chmod -R a+w "$CARGO_HOME" "$RUSTUP_HOME"

# Node — vitest and the tsc shims spawn it directly, so bun alone is not enough.
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) node_arch=x64 ;; \
         arm64) node_arch=arm64 ;; \
         *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
       | tar -xJ -C /usr/local --strip-components=1 \
    && node --version && npm --version

# bun. The installer picks its own target; BUN_INSTALL puts it on a shared path
# rather than root's home, so non-root users in the container can reach it.
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && chmod -R a+rx "$BUN_INSTALL"

# supabase CLI — the e2e job drives a local stack with it.
RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL -o /tmp/supabase.tar.gz \
       "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_${SUPABASE_VERSION}_linux_${arch}.tar.gz" \
    && tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase \
    && rm /tmp/supabase.tar.gz

# Fail the build rather than shipping an image that only looks right. The
# pkg-config check is the one that matters: apt can succeed while leaving the
# .pc file unusable, and that is exactly what a cargo build of the plugin needs.
RUN cargo --version && rustc --version && cargo clippy --version && cargo fmt --version \
    && bun --version && node --version && supabase --version \
    && pkg-config --exists webkit2gtk-4.1 \
    && echo "toolchain OK"

WORKDIR /work
CMD ["bash"]
