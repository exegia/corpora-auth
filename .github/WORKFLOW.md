# Branching and release

Three long-lived things: `main`, the registries, and the tags. Everything else
is temporary.

```
feat/add-otp ──PR──> release/v0.7.0 ──PR──> main ──> crates.io + npm + tag v0.7.0
   (deleted on merge)   (deleted on release)          (opens release/v0.8.0)
```

One version number ships three artifacts, always in lockstep:

| Path        | Artifact                       | Registry                      |
| ----------- | ------------------------------ | ----------------------------- |
| `src/`      | `tauri-plugin-supabase-auth`   | crates.io                     |
| `guest-js/` | `@exegia/plugin-supabase-auth` | npmjs.org **and** GH Packages |
| `react/`    | `@exegia/use-auth`             | npmjs.org                     |

The bindings go to both registries from a single `make publish-bindings`, and
`make publish-verify` then asserts the two agree before anything is tagged.
`@exegia/use-auth` is public on npmjs and pins the bindings exactly, so a
consumer who maps `@exegia` at npmjs with no token must be able to resolve both
halves from there — publishing the bindings to GitHub Packages alone left the
hooks installable but not resolvable (issue #60).

## Feature branches

Named `<type>/<slug>` — `feat`, `fix`, `chore`, `docs`, `ci`, `refactor`,
`test`, `perf`, `build`, `style`, `revert`. (Git forbids `:` in a ref name, so
the conventional-commit form lives in the **PR title**: `feat: add OTP`.)

Branch off the open release branch and open a PR back into it. While the PR is
a draft only the guard runs; marking it **ready for review** starts the suite
and the AI review, which then re-run on every push.

When it merges the branch deletes itself, and the release's draft PR into `main`
is opened or refreshed with a changelog of everything on the branch so far.

## Release branches

Named `release/vX.Y.Z`, and always carry that version in **all three**
manifests — `guest-js/package.json`, `react/package.json` and `Cargo.toml`. The
guard rejects a PR into `main` where they disagree with each other or with the
branch name, because a partial bump publishes the crate and the packages under
different numbers and nothing downstream can tell.

Exactly one is open at a time. It is cut automatically after each release, and
its draft PR into `main` accumulates changes as features land. Marking that PR
ready for review runs the suite plus a real `make pack`, uploaded as an
artifact.

## `main`

No direct pushes; PRs only from `release/vX.Y.Z`. Merging one publishes all
three artifacts, creates the `vX.Y.Z` tag and GitHub Release, deletes the
release branch and opens the next one (minor bump by default).

## Workflows

| File            | Trigger                     | Does                                                          |
| --------------- | --------------------------- | ------------------------------------------------------------- |
| `pr.yml`        | PR opened / ready / pushed  | `guard`, `check`, `check-windows`, `check-macos`, `e2e`, `package` |
| `review.yml`    | PR into `release/v*`        | the AI review, alone in its own file on purpose               |
| `pr-merged.yml` | PR merged into `release/v*` | deletes the branch, upserts the release PR                    |
| `release.yml`   | PR merged into `main`       | publishes, tags, cuts the next release                        |
| `docs.yml`      | `docs/**` changes           | link check only — Mintlify's GitHub App publishes             |
| `docker.yml`    | `docker/**` changes         | publishes the Linux toolchain image to GHCR                   |

`review.yml` is separate because `anthropics/claude-code-action` is the one
action here that the org's allowed-actions policy does not list, and a single
disallowed action fails its **whole file** at startup — no jobs, no logs. On its
own, the worst case is a missing review; inside `pr.yml` it would take `guard`
and `check` with it.

`check` is one ubuntu job running `make ci` (fmt, clippy, tsc, the Rust and hook
suites, both npm builds, and `cargo publish --dry-run` for the crate).
`check-windows` and `check-macos` exist because `src/ceremony/{windows,macos}.rs`
are `cfg`-gated and reach no compiler otherwise; they run clippy and `cargo test`
only. macOS runners bill at 10x.

Every step is a `make` target, so anything CI does can be reproduced locally.

## Bootstrap and manual operations

Once this pipeline is on `main`, a release branch is opened for you after every
release, and you can always open one by hand: run the **Release** workflow
(`Actions → Release → Run workflow`, pick a bump) — the publish job skips and
the next-release job opens the branch. Locally:

```bash
make release:branch BUMP=minor
```

**Neither works for the very first one.** `workflow_dispatch` runs the *default
branch's* copy of a workflow, and `make release:branch` runs `version.sh` after
checking out `main` — so until `main` carries this pipeline, the dispatch runs
the workflow it replaced and the make target runs a script that isn't there.
Cut the first branch with a plain push, which the ruleset permits because it
guards `main` and nothing else:

```bash
git push origin origin/main:refs/heads/release/v0.7.0
```

Then take the normal route: feature PR into that branch, bump the versions on
it, and PR it into `main`. Merging that PR is what puts `release.yml` on `main`,
and every release after it uses the dispatch above.

Other useful targets:

```bash
make ci                            # what CI runs on a pull request
make version:next BUMP=patch       # what the next release would be called
make version:check                 # do the three manifests agree?
make release:notes RANGE=origin/main..HEAD
make pack                          # the tarballs, exactly as published
make rulesets:diff                 # rulesets GitHub actually has
make rulesets:apply                # push .github/rulesets/*.json
```

`make publish:*` and `make release:tag` are idempotent — a version already on a
registry, or a tag already released, is skipped rather than failed. That is what
makes re-running a partly-failed release safe.

## Secrets and installations

| Name                                               | Where             | Used by                            |
| -------------------------------------------------- | ----------------- | ---------------------------------- |
| `NPM_TOKEN`                                        | repository        | publishing `@exegia/use-auth`      |
| `GITHUB_TOKEN`                                     | automatic         | publishing the bindings to GHCR npm |
| `CARGO_REGISTRY_TOKEN`                             | **not set yet**   | publishing the crate to crates.io  |
| `AUTOMATION_APP_ID` / `AUTOMATION_APP_PRIVATE_KEY` | organization      | opening PRs and branches           |
| `CLAUDE_CODE_OAUTH_TOKEN`                          | organization      | the AI review (optional)           |

Without `CARGO_REGISTRY_TOKEN` the crate publish writes a note to the job
summary and succeeds — the two npm packages still ship. Without
`CLAUDE_CODE_OAUTH_TOKEN` the review job skips the same way. Neither leaves a
permanently-red check.

The automation App (`corpora-ui-automation`, app id 4425676 — the id
`rulesets/main.json` grants bypass to) is installed on *selected* repositories.
It has to include `corpora-auth`, or `pr-merged.yml` and the `next-release` job
fail at the token step.

## Migration notes (2026-08-01)

This flow replaced `dev → next → main` and its five workflows (`ci.yml`,
`stage-tag.yml`, `pr-base-policy.yml`, `publish-release.yml`, the dispatch-driven
`release.yml`). Three things are left for a human:

1. **Rulesets.** `rulesets/main.json` is named `Protect main branch` so
   `make rulesets:apply` updates the existing ruleset rather than adding a
   fifth — GitHub rulesets stack, most-restrictive-wins, so a second one would
   silently keep the old `required_approving_review_count: 1`. The `Protect dev
   branch`, `Protect next branch` and `life-cycle` rulesets guard branches this
   flow no longer uses; delete them, or `dev` and `next` linger as protected but
   entirely untested branches — nothing runs on a PR into either any more.
2. **App installation**, as above.
3. **Bootstrap** the first release branch with the manual dispatch.

Two publishing facts worth knowing before the first release:

- **No npm provenance.** corpora-ui publishes with `npm publish --provenance`;
  this repo publishes with `bun publish`, which has no equivalent flag, because
  bun is what correctly strips the `workspace:*` dependency on the bindings.
- **`@exegia/use-auth` has never been published to npmjs.org** — the old
  `@exegia/auth-ui` name went to GitHub Packages only. Confirm the `@exegia`
  scope exists there and that `NPM_TOKEN` is authorized for it before the first
  release. Publishing runs *before* tagging on purpose, so a failure leaves no
  tag pointing at a version nobody can install.
