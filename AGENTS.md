# AGENTS.md

Instructions and entry points for coding agents working on this repository. For the open format background, see [agents.md](https://agents.md/).

## Documentation sync

Treat **AGENTS.md** as the agent-facing index for [README.md](README.md), [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md), [docs/SECURITY.md](docs/SECURITY.md), and [assets/help.md](assets/help.md). Keep it aligned with those docs when workflow, release, or navigation facts change.

## Agent index

| Topic                                      | Where to look                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keeping human docs and this file aligned   | [Documentation sync](#documentation-sync)                                                                                                                                                                                                                                                                                                                                                                              |
| User-facing behavior, CLI usage, examples  | [README.md](README.md)                                                                                                                                                                                                                                                                                                                                                                                                 |
| License text                               | [LICENSE.md](LICENSE.md)                                                                                                                                                                                                                                                                                                                                                                                               |
| Contributing flow, PR checks, commit style | [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)                                                                                                                                                                                                                                                                                                                                                                           |
| Security policy and reporting              | [docs/SECURITY.md](docs/SECURITY.md)                                                                                                                                                                                                                                                                                                                                                                                   |
| Community expectations                     | [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md)                                                                                                                                                                                                                                                                                                                                                                     |
| Published CLI help text                    | [assets/help.md](assets/help.md)                                                                                                                                                                                                                                                                                                                                                                                       |
| CI and security workflows                  | [.github/workflows/quality.yml](.github/workflows/quality.yml), [.github/workflows/verification.yml](.github/workflows/verification.yml), [.github/workflows/security.yml](.github/workflows/security.yml), [.github/workflows/integration.yml](.github/workflows/integration.yml), [.github/workflows/anti-slop.yml](.github/workflows/anti-slop.yml), [.github/workflows/publish.yml](.github/workflows/publish.yml) |
| Library and CLI implementation             | [src/index.ts](src/index.ts), [src/utils.ts](src/utils.ts), [src/bin.ts](src/bin.ts)                                                                                                                                                                                                                                                                                                                                   |
| tsdown build                               | [tsdown.config.ts](tsdown.config.ts)                                                                                                                                                                                                                                                                                                                                                                                   |
| Tests and Vitest settings                  | [test/](test/), [vitest.config.ts](vitest.config.ts)                                                                                                                                                                                                                                                                                                                                                                   |
| npm scripts and package metadata           | [package.json](package.json)                                                                                                                                                                                                                                                                                                                                                                                           |

## Project overview

See [README.md](README.md) for the user-facing overview and [package.json](package.json) for runtime/build metadata.

## Setup commands

See [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the standard setup flow; [package.json](package.json) is the source of truth for versions and scripts.

## Development workflow

See [package.json](package.json) for the build, dev, and audit scripts. Source of truth for behavior is `src/` plus tests; the published artifact is under `dist/` after build.

## Testing instructions

Tests live in `test/**/*.test.ts` (see [vitest.config.ts](vitest.config.ts)). Use `bun run test` for the suite, and prefer updating or adding tests when changing behavior. Use `bun run format:ci` after edits that touch Markdown or JSON.
Test names should follow the `it('X when Y')` pattern so behavior and trigger are both obvious.
When verifying production-only bugs in the CLI, reproduce with the published `degit` package (for example `npx degit@latest ...`) instead of running the raw repository source directly.

## Lint and format

See [package.json](package.json) for lint and format scripts, and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the contributor workflow and formatting expectations.

## Build and release

`prepublishOnly` runs `bun run test`. CI checks live in [.github/workflows/quality.yml](.github/workflows/quality.yml), [.github/workflows/verification.yml](.github/workflows/verification.yml), [.github/workflows/security.yml](.github/workflows/security.yml), and [.github/workflows/publish.yml](.github/workflows/publish.yml).

## Pull requests and commits

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for PR shape, single-commit guidance, tests on behavior changes, and Conventional Commits. Add unreleased notes only for package-facing changes such as features, fixes, or breaking changes; do not add changelog entries for repo-maintenance-only updates like CI workflow changes, dependency bumps, or documentation-only edits unless they affect the published package or user-facing behavior. Match the checks in [.github/workflows/quality.yml](.github/workflows/quality.yml), [.github/workflows/verification.yml](.github/workflows/verification.yml), and [.github/workflows/security.yml](.github/workflows/security.yml) before opening a PR.
