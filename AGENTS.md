# AGENTS.md

Instructions and entry points for coding agents working on this repository. For the open format background, see [agents.md](https://agents.md/).

## Documentation sync

Treat **AGENTS.md** as part of the same documentation set as [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [help.md](help.md). When anything in that set changes how people or agents install, build, test, lint, release, or navigate the repo, update every affected file in the **same pull request** so instructions and the agent index stay consistent.

Human-facing narrative belongs primarily in README and CONTRIBUTING; AGENTS.md should reflect the same facts (versions, commands, CI steps, paths). If you notice a mismatch, fix all involved files before merging.

## Agent index

| Topic | Where to look |
| --- | --- |
| Keeping human docs and this file aligned | [Documentation sync](#documentation-sync) |
| User-facing behavior, CLI usage, examples | [README.md](README.md) |
| Contributing flow, PR checks, commit style, security reporting | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Community expectations | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| Published CLI help text | [help.md](help.md) |
| CI matrix and steps (Bun + Node 18/20/22) | [.github/workflows/nodejs.yml](.github/workflows/nodejs.yml) |
| Library and CLI implementation | [src/index.js](src/index.js), [src/utils.js](src/utils.js), [src/bin.js](src/bin.js) |
| Rollup build | [rollup.config.js](rollup.config.js) |
| Tests and Vitest settings | [test/](test/), [vitest.config.js](vitest.config.js) |
| npm scripts and package metadata | [package.json](package.json) |

## Project overview

**degit** downloads a snapshot of a git repository (GitHub, GitLab, Bitbucket, Sourcehut) via tarballs instead of cloning full history. Runtime targets Node 18+. This repo is built with Rollup to `dist/` and ships a `degit` bin.

## Setup commands

Use **Bun 1.3.14** and a frozen lockfile in CI; match that locally.

```bash
bun install
bun run build
```

Node 18+ is required (`engines` in `package.json`). End users may install the published package with npm; agent work in this clone should follow Bun as in [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Development workflow

```bash
bun run build          # one-off compile to dist/
bun run dev            # rollup watch (npm script: build -- --watch)
```

Source of truth for behavior is `src/` plus tests; the published artifact is under `dist/` after build.

## Testing instructions

```bash
bun run test                  # pretest runs build, then vitest run
bun run test:coverage         # vitest with v8 coverage (thresholds in vitest.config.js)
bunx vitest run test/utils.test.js   # single file
bunx vitest run -t "substring"       # filter by test name
```

Tests live in `test/**/*.test.js` (see `vitest.config.js`). Prefer updating or adding tests when changing behavior.

## Lint and format

```bash
bun run lint            # eslint across the repo (respects .gitignore)
```

Pre-commit uses lint-staged (ESLint on JS; Prettier on JS, JSON, YAML, MD). Align edits with existing style before proposing changes.

## Build and release

```bash
bun run build           # outputs to dist/; npm publish uses files in package.json
```

`prepublishOnly` runs `npm test` (which builds then tests). CI runs `bun install --frozen-lockfile`, `bun run build`, `bun run test`, and `bun run lint` on Node 18.x, 20.x, and 22.x.

## Pull requests and commits

Follow [CONTRIBUTING.md](CONTRIBUTING.md): focused diffs, tests when behavior changes, Conventional Commits (`type(scope): subject`). Match the checks in `.github/workflows/nodejs.yml` before opening a PR.
