# degit — straightforward project scaffolding

[![Known Vulnerabilities](https://snyk.io/test/npm/degit/badge.svg)](https://snyk.io/test/npm/degit)
[![install size](https://packagephobia.com/badge?p=degit)](https://packagephobia.com/result?p=degit)
[![npm package version](https://badgen.net/npm/v/degit)](https://npm.im/degit)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-v3.0%20adopted-ff69b4.svg)](docs/CODE_OF_CONDUCT.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

**degit** makes copies of git repositories. When you run `degit some-user/some-repo`, it finds the latest commit on https://github.com/some-user/some-repo and downloads the associated tar file to the platform-appropriate cache directory if it doesn't already exist locally. (This is much quicker than using `git clone`, because you're not downloading the entire git history.)

`degit` resolves refs through an internal git backend, downloads tar snapshots by default, and falls back to SSH cloning when tarball fetches or extraction fail. Public HTTPS sources do not need a local `git` binary on your `PATH`, but SSH/private repositories still do.

## Requirements

- Node.js **20** or later (see `engines` in `package.json`)

## Installation

```bash
npm install -g degit
```

## Quick start

Download the default branch of a GitHub repo to the current directory:

```bash
degit user/repo
```

Download to a new folder:

```bash
degit user/repo my-new-project
degit -r user/repo
```

Download only specific files:

```bash
degit user/repo my-project --files README.md,src/index.ts
```

Use a specific tag, branch, or commit:

```bash
degit user/repo#v1.0.0
```

For the full CLI reference, ESM API, and `degit.json` actions, see [docs/USAGE.md](docs/USAGE.md).

## Why not just `git clone --depth 1`?

- No leftover `.git` folder from the template.
- Caches tar archives for offline reuse.
- Less to type (`degit user/repo` versus `git clone --depth 1 ...`).
- Composable post-clone actions via `degit.json`.
- Built-in support for subdirectories, file filtering, and aliases.

## Agent skill

Install the reusable `degit` skill for agents that support `SKILL.md` files:

```bash
# project-level install
npx skills add Rich-Harris/degit --skill degit

# global install
npx skills add Rich-Harris/degit --skill degit -g
```

Then ask the agent to download a repository or template. The skill helps it choose a source, ref, and destination; handle private repositories and aliases; and avoid overwriting a non-empty destination without confirmation.

See [skills/degit/SKILL.md](skills/degit/SKILL.md) for the full skill instructions.

## Documentation

- [docs/USAGE.md](docs/USAGE.md) — full CLI reference, ESM API, and `degit.json` actions
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — contributing, development setup, and CI checks
- [docs/SECURITY.md](docs/SECURITY.md) — security policy and reporting process
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — repository architecture and data flow
- [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md) — community expectations
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — release notes

## See also

- [zel](https://github.com/vutran/zel) by [Vu Tran](https://twitter.com/tranvu)
- [gittar](https://github.com/lukeed/gittar) by [Luke Edwards](https://twitter.com/lukeed05)
- [gitpick](https://github.com/nrjdalal/gitpick) - by [Neeraj Dalal](https://twitter.com/nrjdalal_com)

## License

[MIT](LICENSE.md)
