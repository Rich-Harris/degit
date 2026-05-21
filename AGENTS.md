# AGENTS.md

Instructions and entry points for coding agents working on this repository. For the open format background, see [agents.md](https://agents.md/).

## Documentation sync

Treat **AGENTS.md** as part of the same documentation set as [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [help.md](help.md). When anything in that set changes how people or agents install, build, test, lint, release, or navigate the repo, update every affected file in the **same pull request** so instructions and the agent index stay consistent.

Human-facing narrative belongs primarily in README and CONTRIBUTING; AGENTS.md should reflect the same facts (versions, commands, CI steps, paths). If you notice a mismatch, fix all involved files before merging.

## Agent index

| Topic                                                          | Where to look                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keeping human docs and this file aligned                       | [Documentation sync](#documentation-sync)                                                                                                                                                                                                                                                                                                                                    |
| User-facing behavior, CLI usage, examples                      | [README.md](README.md)                                                                                                                                                                                                                                                                                                                                                       |
| Contributing flow, PR checks, commit style, security reporting | [CONTRIBUTING.md](CONTRIBUTING.md)                                                                                                                                                                                                                                                                                                                                           |
| Community expectations                                         | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)                                                                                                                                                                                                                                                                                                                                     |
| Published CLI help text                                        | [help.md](help.md)                                                                                                                                                                                                                                                                                                                                                           |
| CI workflows (Bun + Node 20/22/24)                             | [.github/workflows/build.yml](.github/workflows/build.yml), [.github/workflows/test.yml](.github/workflows/test.yml), [.github/workflows/lint.yml](.github/workflows/lint.yml), [.github/workflows/duplicates.yml](.github/workflows/duplicates.yml), [.github/workflows/knip.yml](.github/workflows/knip.yml), [.github/workflows/format.yml](.github/workflows/format.yml) |
| Library and CLI implementation                                 | [src/index.ts](src/index.ts), [src/utils.ts](src/utils.ts), [src/bin.ts](src/bin.ts)                                                                                                                                                                                                                                                                                         |
| tsdown build                                                   | [tsdown.config.ts](tsdown.config.ts)                                                                                                                                                                                                                                                                                                                                         |
| Tests and Vitest settings                                      | [test/](test/), [vitest.config.ts](vitest.config.ts)                                                                                                                                                                                                                                                                                                                         |
| npm scripts and package metadata                               | [package.json](package.json)                                                                                                                                                                                                                                                                                                                                                 |

## Project overview

**degit** downloads a snapshot of a git repository (GitHub, GitLab, Bitbucket, Sourcehut) via tarballs instead of cloning full history. Runtime targets Node 20+. This repo is built with tsdown to `dist/` and ships a `degit` bin.

## Setup commands

Use **Bun 1.3.14** and a frozen lockfile in CI; match that locally.

```bash
bun install
bun run build
```

Node 20+ is required (`engines` in `package.json`). End users may install the published package with npm; agent work in this clone should follow Bun as in [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Development workflow

```bash
bun run build          # one-off compile to dist/ via tsdown
bun run dev            # tsdown watch mode
```

Source of truth for behavior is `src/` plus tests; the published artifact is under `dist/` after build.

## Testing instructions

```bash
bun run test                  # pretest runs build, then vitest run
bun run test:coverage         # vitest with v8 coverage (thresholds in vitest.config.ts)
bun run knip:ci               # dead code detection via knip
bunx vitest run test/utils.test.ts    # single file
bunx vitest run -t "substring"       # filter by test name
```

Tests live in `test/**/*.test.ts` (see `vitest.config.ts`). Prefer updating or adding tests when changing behavior.

## Lint and format

```bash
bun run lint            # oxlint across the repo with autofixes
bun run lint:ci         # oxlint in CI mode without fixes
bun run format          # oxfmt across the repo with writes enabled
bun run format:ci       # oxfmt in CI mode without writes
```

Pre-commit uses lint-staged (Oxlint on JS/TS; Oxfmt on JS/TS, JSON, YAML, MD). Dedicated lint and format CI workflows check the same tools on pull requests. Align edits with existing style before proposing changes.

## Build and release

```bash
bun run build           # outputs to dist/; npm publish uses files in package.json
```

`prepublishOnly` runs `npm test` (which builds then tests). CI runs `bun install --frozen-lockfile`, `bun run build`, `bun run test`, `bun run lint:ci`, `bun run format:ci`, `bun run duplicates:ci`, and `bun run knip:ci` as separate parallel workflows on Node 20.x, 22.x, and 24.x.

## Pull requests and commits

Follow [CONTRIBUTING.md](CONTRIBUTING.md): focused diffs, a single commit per PR, tests when behavior changes, Conventional Commits (`type(scope): subject`). Match the checks in [.github/workflows/build.yml](.github/workflows/build.yml), [.github/workflows/test.yml](.github/workflows/test.yml), [.github/workflows/lint.yml](.github/workflows/lint.yml), and [.github/workflows/duplicates.yml](.github/workflows/duplicates.yml) before opening a PR.
