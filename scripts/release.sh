#!/usr/bin/env bash
# The git/gh half of the release pipeline. Every step .github/workflows/*.yml
# takes is one of these subcommands, so anything CI does is reproducible here.
#
#   ./scripts/release.sh guard            # validate a PR's base, branch, title (env: BASE HEAD TITLE)
#   ./scripts/release.sh notes [RANGE]    # markdown changelog for a commit range
#   ./scripts/release.sh pr [BRANCH]      # open or refresh the draft release PR into main
#   ./scripts/release.sh branch [VERSION] # cut release/v<next> from main, versions bumped
#   ./scripts/release.sh delete BRANCH    # delete a remote branch, tolerating one already gone
#   ./scripts/release.sh tag              # tag v<version> and publish the GitHub Release
#   ./scripts/release.sh rulesets [--apply]  # diff or push .github/rulesets/*.json
#
# `pr`, `branch`, `delete`, `tag` and `rulesets` all talk to GitHub and need
# `gh` authenticated (GH_TOKEN in CI). `tag` and `branch` are idempotent — an
# existing tag or branch is reported and skipped.

# shellcheck source=./lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "$REPO_ROOT"

# $SCRIPTS comes from the Makefile; default it so the script also runs standalone.
: "${SCRIPTS:=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
VERSION_SH="$SCRIPTS/version.sh"

# Branch and PR-title types. Git forbids `:` in a ref name, so the
# conventional-commit form lives in the PR title, not the branch.
TYPES='feat|fix|chore|docs|ci|refactor|test|perf|build|style|revert'

# owner/name. Workflows export it from ${{ github.repository }}; `gh` reads the
# variable natively too.
: "${GH_REPO:=$(git config --get remote.origin.url 2>/dev/null | sed -E 's,.*github\.com[:/],,; s,\.git$,,')}"
export GH_REPO

version() { "$VERSION_SH" current; }

# --- guard ------------------------------------------------------------------

# reject <message> — a GitHub annotation has to start its own line, so this
# prints the bare `::error::` form rather than going through die().
reject() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

cmd_guard() {
  : "${BASE:?BASE is required}" "${HEAD:?HEAD is required}"

  case "$BASE" in
    main)
      echo "$HEAD" | grep -Eq '^release/v[0-9]+\.[0-9]+\.[0-9]+$' \
        || reject "main only accepts PRs from release/vX.Y.Z (got '$HEAD')"

      # The crate and both packages ship one number. A PR that bumped only some
      # of them would publish tauri-plugin-supabase-auth and @exegia/use-auth
      # under different versions, and nothing downstream could tell.
      "$VERSION_SH" check || reject "the three manifests declare different versions"

      local want
      want="release/v$(version)"
      [ "$want" = "$HEAD" ] \
        || reject "the manifests declare $want but the branch is $HEAD"
      ;;
    release/v*)
      echo "$HEAD" | grep -Eq "^($TYPES)/[a-z0-9][a-z0-9._-]*$" \
        || reject "branch must be <type>/<slug> — one of $TYPES (got '$HEAD')"
      # TITLE arrives as an environment variable and is never interpolated into
      # a command: a PR title is attacker-controlled text.
      printf '%s' "${TITLE-}" | grep -Eq "^($TYPES)(\([a-z0-9._/-]+\))?!?: .+" \
        || reject "PR title must read '<type>: summary' (got '${TITLE-}')"
      ;;
    *)
      reject "$BASE is not a valid base — target main or release/vX.Y.Z"
      ;;
  esac

  ok "guard passed: $HEAD -> $BASE"
}

# --- changelog and pull requests --------------------------------------------

cmd_notes() {
  local range="${1:-${RANGE:-origin/main..HEAD}}"
  git log --no-merges --reverse --pretty='- %s' "$range" | grep . \
    || echo '- _Nothing merged yet._'
}

cmd_pr() {
  local branch="${1:-${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}}"
  local version="${branch#release/v}"

  git fetch --quiet origin "main:refs/remotes/origin/main" "$branch:refs/remotes/origin/$branch"

  local body num
  body="$(mktemp)"
  {
    printf 'Release **v%s**.\n\n' "$version"
    printf 'Ships `tauri-plugin-supabase-auth`, `@exegia/plugin-supabase-auth` and `@exegia/use-auth`, all at v%s.\n\n## Changes\n\n' "$version"
    cmd_notes "origin/main..origin/$branch"
    printf '\n---\nRefreshed automatically whenever a PR lands on `%s`.\n' "$branch"
  } > "$body"

  num="$(gh pr list --base main --head "$branch" --state open --json number --jq '.[0].number // empty')"
  if [ -n "$num" ]; then
    gh pr edit "$num" --body-file "$body"
    ok "refreshed release PR #$num"
  else
    gh pr create --draft --base main --head "$branch" \
      --title "release: v$version" --body-file "$body"
  fi
  rm -f "$body"
}

cmd_delete() {
  local branch="${1:-${BRANCH:?BRANCH is required}}"
  if gh api -X DELETE "repos/$GH_REPO/git/refs/heads/$branch" >/dev/null 2>&1; then
    ok "deleted $branch"
  else
    info "$branch was already gone"
  fi
}

# --- releases ---------------------------------------------------------------

cmd_branch() {
  git fetch --quiet --force --tags origin "main:refs/remotes/origin/main"

  local version branch
  version="${1:-${VERSION:-$("$VERSION_SH" next "${BUMP:-minor}")}}"
  branch="release/v$version"

  if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    info "$branch already exists — nothing to do"
    return 0
  fi

  git checkout --quiet -B "$branch" origin/main
  "$VERSION_SH" set "$version"
  # bun.lock and Cargo.lock are rewritten by `version.sh set` alongside the
  # three manifests, and all five belong in the one bump commit.
  git add guest-js/package.json react/package.json Cargo.toml Cargo.lock bun.lock
  git commit --quiet -m "chore(release): open v$version"
  git push --quiet -u origin "$branch"
  ok "opened $branch"
}

cmd_tag() {
  local tag
  tag="v$(version)"
  if gh api "repos/$GH_REPO/git/ref/tags/$tag" >/dev/null 2>&1; then
    info "$tag already exists — skipping"
    return 0
  fi
  gh release create "$tag" --target "$(git rev-parse HEAD)" --title "$tag" --generate-notes
  ok "released $tag"
}

# --- repository settings ----------------------------------------------------

cmd_rulesets() {
  if [ "${1:-}" != "--apply" ]; then
    heading "Rulesets on $GH_REPO"
    gh api "repos/$GH_REPO/rulesets" --jq '.[] | "  \(.id)\t\(.name)"'
    echo ""
    info "run with --apply to push .github/rulesets/*.json (matched by name)"
    return 0
  fi

  local f name id
  for f in .github/rulesets/*.json; do
    name="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name)' "$f")"
    id="$(gh api "repos/$GH_REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id")"
    if [ -n "$id" ]; then
      gh api -X PUT "repos/$GH_REPO/rulesets/$id" --input "$f" >/dev/null
      ok "updated $name"
    else
      gh api -X POST "repos/$GH_REPO/rulesets" --input "$f" >/dev/null
      ok "created $name"
    fi
  done
}

case "${1:-}" in
  guard)    cmd_guard ;;
  notes)    shift; cmd_notes "$@" ;;
  pr)       shift; cmd_pr "$@" ;;
  branch)   shift; cmd_branch "$@" ;;
  delete)   shift; cmd_delete "$@" ;;
  tag)      cmd_tag ;;
  rulesets) shift; cmd_rulesets "$@" ;;
  -h|--help|"") sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown subcommand: $1" ;;
esac
