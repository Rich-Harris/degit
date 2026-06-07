# degit — straightforward project scaffolding

[![Known Vulnerabilities](https://snyk.io/test/npm/degit/badge.svg)](https://snyk.io/test/npm/degit)
[![install size](https://badgen.net/packagephobia/install/degit)](https://packagephobia.now.sh/result?p=degit)
[![npm package version](https://badgen.net/npm/v/degit)](https://npm.im/degit)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-v3.0%20adopted-ff69b4.svg)](docs/CODE_OF_CONDUCT.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

**degit** makes copies of git repositories. When you run `degit some-user/some-repo`, it will find the latest commit on https://github.com/some-user/some-repo and download the associated tar file to the platform-appropriate cache directory if it doesn't already exist locally. On Linux/BSD this follows `XDG_CACHE_HOME` when set and otherwise uses `~/.cache/degit`; on macOS it uses `~/Library/Caches/degit`; on Windows it uses `%LOCALAPPDATA%\degit`. (This is much quicker than using `git clone`, because you're not downloading the entire git history.)
degit resolves refs through an internal git backend, downloads tar snapshots by default, and falls back to SSH cloning when tarball fetches or extraction fail. Public HTTPS sources do not need a local `git` binary on your `PATH`, but SSH/private repositories still do.

## Requirements

- Node.js **20** or later (see `engines` in `package.json`)
- [Bun](https://bun.sh) **1.3.14** when developing this repository (see `packageManager` in `package.json`)

End users can still install the published package with npm (`npm install -g degit`). For a dev clone of this repo, use Bun so the lockfile and `bunfig.toml` apply; `minimumReleaseAge` is set to 14 days so installs skip very fresh publishes.

```bash
git clone https://github.com/Rich-Harris/degit.git
cd degit
bun install
bun run build
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for how to contribute. [docs/SECURITY.md](docs/SECURITY.md) explains how to report vulnerabilities. [AGENTS.md](AGENTS.md) summarizes setup and commands for tooling and coding agents. When verifying production CLI bugs, reproduce with the published package (for example `npx degit@latest ...`) rather than running the raw repository source directly. When you change development workflow, CI, or contributor-facing instructions, update **README.md**, **docs/CONTRIBUTING.md**, and **AGENTS.md** together so they stay consistent.

`bun run test` runs the unit tests in `test/unit/**/*.test.ts` and the public integration tests in `test/integration/public.test.ts`, excluding `test/integration/private.test.ts`. Use `bun run test:integration` for the integration suite.

`bun run perf:ci` runs the fixture-backed performance gate that CI uses to catch clone regressions.

A small proof-of-concept docs-sync workflow also runs on PRs that change `src/**/*.ts` or `assets/help.md`, using OpenRouter through Claude Code Action. It expects `OPENROUTER_API_KEY` and `OPENROUTER_ANTHROPIC_BASE_URL` repository secrets.

## Installation

```bash
npm install -g degit
```

## Usage

### Basics

The simplest use of degit is to download the default branch of a repo from GitHub to the current working directory:

```bash
degit user/repo

# these commands are equivalent
degit github:user/repo
degit git@github.com:user/repo
degit https://github.com/user/repo
```

Or you can download from GitLab and BitBucket:

```bash
# download from GitLab
degit gitlab:user/repo
degit git@gitlab.com:user/repo
degit https://gitlab.com/user/repo

# download from BitBucket
degit bitbucket:user/repo
degit git@bitbucket.org:user/repo
degit https://bitbucket.org/user/repo

# download from Sourcehut
degit git.sr.ht/user/repo
degit git@git.sr.ht:user/repo
degit https://git.sr.ht/user/repo
```

### Specify a tag, branch or commit

When you omit a ref, degit uses the repository's default branch.

```bash
degit user/repo#dev       # branch
degit user/repo#v1.2.3    # release tag
degit user/repo#1234abcd  # commit hash
```

### Create a new folder for the project

If the second argument is omitted, the repo will be cloned to the current directory.

```bash
degit user/repo my-new-project
```

### Specify a subdirectory

To clone a specific subdirectory instead of the entire repo, just add it to the argument:

```bash
degit user/repo/subdirectory
```

### HTTPS proxying

If you have an `https_proxy` environment variable, Degit will use it.

### Private repositories

Private repositories are handled automatically. degit uses the tarball path by default for HTTPS sources and falls back to SSH cloning when it cannot fetch or extract a snapshot.

SSH/private repositories still require `git` on your `PATH`.

If you still pass `--mode=git`, degit keeps working and prints a notice that the flag is no longer needed. `--mode=tar` is the default path.

### See all options

```bash
degit --help
```

Pull requests are very welcome!

## Wait, isn't this just `git clone --depth 1`?

A few salient differences:

- If you `git clone`, you get a `.git` folder that pertains to the project template, rather than your project. You can easily forget to re-init the repository, and end up confusing yourself
- Caching and offline support (if you already have a `.tar.gz` file for a specific commit, you don't need to fetch it again).
- Less to type (`degit user/repo` instead of `git clone --depth 1 ssh://git@github.com/user/repo`)
- Composability via [actions](#actions)
- Future capabilities — [interactive mode](https://github.com/Rich-Harris/degit/issues/4), [friendly onboarding and postinstall scripts](https://github.com/Rich-Harris/degit/issues/6)

## ESM API

You can also use degit inside a Node script:

```js
import degit from 'degit';

const emitter = degit('user/repo', {
	cache: true,
	force: true,
	verbose: true,
});

emitter.on('info', (info) => {
	console.log(info.message);
});

emitter.clone('path/to/dest').then(() => {
	console.log('done');
});
```

## Actions

You can manipulate repositories after they have been cloned with _actions_, specified in a `degit.json` file that lives at the top level of the working directory. Currently, there are two actions — `clone` and `remove`. Additional actions may be added in future.

### clone

```json
// degit.json
[
	{
		"action": "clone",
		"src": "user/another-repo"
	}
]
```

This will clone `user/another-repo`, preserving the contents of the existing working directory. This allows you to, say, add a new README.md or starter file to a repo that you do not control. The cloned repo can contain its own `degit.json` actions.

### remove

```json
// degit.json
[
	{
		"action": "remove",
		"files": ["LICENSE"]
	}
]
```

Remove a file at the specified path.

## See also

- [zel](https://github.com/vutran/zel) by [Vu Tran](https://twitter.com/tranvu)
- [gittar](https://github.com/lukeed/gittar) by [Luke Edwards](https://twitter.com/lukeed05)
- [gitpick](https://github.com/nrjdalal/gitpick) - by [Neeraj Dalal](https://twitter.com/nrjdalal_com)

## License

[MIT](LICENSE.md)
