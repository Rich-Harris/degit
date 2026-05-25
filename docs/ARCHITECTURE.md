# Architecture Overview

This document describes the actual architecture of degit: a single-package TypeScript CLI and library that downloads a snapshot of a remote git repository, caches tarballs locally, and optionally falls back to git mode for private repositories.

## 1. Project Structure

The repository is intentionally small. The source of truth for behavior lives in `src/`, tests live in `test/`, and build output is emitted to `dist/`.

```text
./
├── AGENTS.md         # Agent-oriented repo guidance
├── assets/
│   └── help.md       # Published CLI help text
├── src/
│   ├── index.ts      # Core Degit class, provider logic, caching, clone flow
│   ├── bin.ts        # CLI entrypoint, argument parsing, interactive mode
│   └── utils.ts      # Fetch, exec, filesystem helpers, cache paths
├── test/
│   ├── bin.test.ts   # CLI behavior and interactive flow
│   ├── index.test.ts # Core clone flow, providers, cache, directives
│   ├── live.test.ts  # Optional real-provider integration checks
│   └── helpers.ts    # Test utilities and mocks
├── dist/             # Built ESM output and type declarations
├── README.md         # User-facing usage and setup guide
├── docs/
│   ├── ARCHITECTURE.md    # Repository overview and structure
│   ├── CHANGELOG.md       # Release notes
│   ├── CODE_OF_CONDUCT.md # Community expectations
│   ├── CONTRIBUTING.md    # Contributor workflow and validation commands
│   ├── SECURITY.md        # Security policy and reporting process
├── tsdown.config.ts   # Build configuration
├── vitest.config.ts   # Test and coverage configuration
└── package.json       # Scripts, package metadata, and release config
```

## 2. High-Level System Diagram

degit is a local CLI/library wrapper around remote repository snapshots:

```text
[User/CLI] -> [src/bin.ts] -> [src/index.ts]
						   -> [src/utils.ts]
						   -> [Remote provider tarball or git remote]
						   -> [Local cache under the platform cache directory]
						   -> [Destination directory]
```

The important boundary is between local orchestration and remote provider access. `src/index.ts` resolves the repo, decides between tar and git mode, downloads or clones, extracts contents, and then applies optional post-clone directives from `degit.json`.

## 3. Core Components

### 3.1. CLI Entry Point

Name: CLI runner

Description: Parses command-line arguments, renders help text, and provides an interactive repository picker when no source is supplied. It also wires the CLI to the core clone flow and prints colored status output to stderr.

Technologies: TypeScript, `mri`, `enquirer`, `fuzzysearch`, `chalk`

Deployment: Built into the published `degit` executable and run locally via Node 20+ or Bun during development.

### 3.2. Core Degit Library

Name: Degit orchestrator

Description: Implements the main clone lifecycle as an `EventEmitter`. It parses supported source formats, resolves refs, checks and uses the local cache, downloads tarballs, performs git clones when requested, and applies `degit.json` directives after the initial clone.

Technologies: TypeScript, `tar`, `sander`, `chalk`, Node standard library

Deployment: Bundled into the published library entrypoint and reused by the CLI and tests.

### 3.3. Utility Layer

Name: Runtime helpers

Description: Contains filesystem and process helpers used by the core flow. This includes the HTTPS fetch wrapper with proxy support, `git` command execution, recursive directory creation, local cache root detection, and stash/unstash helpers for directive processing.

Technologies: Node `fs`, `path`, `os`, `https`, `child_process`, `https-proxy-agent`, `sander`

Deployment: Internal implementation detail, not exposed as a separate package.

### 3.4. Provider Handling

Name: Repository providers

Description: Encodes provider-specific rules for GitHub, GitLab, Bitbucket, and Sourcehut. Each provider maps a parsed repository to the correct archive URL and SSH URL shape.

Technologies: TypeScript data mapping and URL construction

Deployment: In-process logic within `src/index.ts`.

### 3.5. Test Suite

Name: Behavior and integration tests

Description: Validates provider parsing, tar and git modes, caching behavior, directives, CLI behavior, and optional live network clones.

Technologies: Vitest, Node test fixtures, tar archive generation, mock `fetch` and `exec` helpers

Deployment: Run locally and in CI; `test/live.test.ts` is opt-in through `LIVE_TESTS=1`.

## 4. Data Stores

The project does not use an application database or queue. Its persistent state is local and file-based.

### 4.1. Local Cache

Name: degit cache

Type: Filesystem cache under the platform-appropriate user cache directory

Purpose: Stores downloaded tarballs and provider metadata so repeated clones can avoid refetching the same commit archive.

Key Schemas/Collections: Per-provider directories such as `github/<user>/<repo>/`, plus cache files like `<hash>.tar.gz`, `map.json`, and `access.json`.

### 4.2. Temporary Stash

Name: Directive stash directory

Type: Temporary filesystem directory under the cache root

Purpose: Preserves existing destination files while `degit.json` directives run, then restores them after nested clones or removals complete.

## 5. External Integrations / APIs

The tool talks to a small set of external systems:

GitHub, GitLab, Bitbucket, and Sourcehut: Used to resolve repository refs and download archive tarballs over HTTPS, or to clone over SSH in git mode.

Git: Invoked through `git ls-remote` and `git clone` for ref resolution and private repository cloning.

HTTPS proxy support: `https_proxy` is honored through `https-proxy-agent` when fetching tarballs.

npm registry: Used for distribution of the published package, not by the runtime clone flow.

## 6. Deployment & Infrastructure

Cloud Provider: None for application runtime. The project is a locally executed CLI/library.

Key Services Used: GitHub Actions for CI, npm for package publishing, and the local filesystem for cache and build artifacts.

CI/CD Pipeline: GitHub Actions. `quality.yml` runs lint, format, duplication, and dead-code checks; `verification.yml` runs build and tests; `security.yml` runs `bun audit` and CodeQL; `publish.yml` builds, tests, and publishes tagged releases.

Monitoring & Logging: No dedicated observability stack. Errors and status messages are surfaced directly through the CLI and test output.

Build and release use tsdown to emit `dist/` ESM output and type declarations. Development and CI both use Bun 1.3.14, while the published package targets Node 20+.

## 7. Security Considerations

Authentication: No application login flow. Repository access relies on public HTTPS archives or SSH-based git cloning for private repositories.

Authorization: Delegated to the remote git provider and the user’s network credentials.

Data Encryption: Fetches use HTTPS, and private repository cloning uses SSH. There is no application-managed at-rest encryption because the only persisted state is the local cache.

Key Security Tools/Practices: Dependency audit in CI, CodeQL analysis, supported-version policy in `docs/SECURITY.md`, and a private vulnerability reporting channel via email.

The clone flow also relies on path-safe extraction via the tar library and does not expose a general-purpose file import surface beyond the documented repo snapshot behavior.

## 8. Development & Testing Environment

Local Setup Instructions: See `../README.md` and `CONTRIBUTING.md`. The expected workflow is `bun install`, `bun run build`, and then the relevant tests or checks.

Testing Frameworks: Vitest for unit and integration tests. `test/live.test.ts` is gated behind `LIVE_TESTS=1` and is not part of the normal default run.

Code Quality Tools: Oxlint, Oxfmt, Knip, and jscpd. The repository also uses Husky and lint-staged for pre-commit checks.

## 9. Future Considerations / Roadmap

The codebase contains a few visible TODO-level improvements rather than a formal roadmap:

- Add a CLI `--proxy` flag instead of relying only on `https_proxy`.
- Improve directive error messages by including directive indices.
- Add friendlier ref suggestions when a requested ref is invalid.

## 10. Project Identification

Project Name: degit

Repository URL: https://github.com/Rich-Harris/degit

Primary Contact/Team: Rich Harris / degit maintainers

Date of Last Update: 2026-05-23

## 11. Glossary / Acronyms

Tar mode: The default clone mode. Degit downloads a provider archive and extracts it locally.

Git mode: The fallback mode that uses `git clone` over SSH, mainly for private repositories.

Directive: An entry in `degit.json` that runs after the initial clone. Current directives are `clone` and `remove`.

Cache root: The local storage location resolved from the platform cache directory used for downloaded archives and metadata.

Provider: A supported hosting service whose repository URL format degit understands: GitHub, GitLab, Bitbucket, or Sourcehut.
