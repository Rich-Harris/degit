# Usage

This guide covers the `degit` CLI and ESM API.

## Quick start

Download the default branch of a GitHub repo to the current directory:

```bash
degit user/repo
```

Download to a new folder:

```bash
degit user/repo my-new-project
```

Download only specific files:

```bash
degit user/repo my-project --files README.md,src/index.ts
```

Use a specific ref:

```bash
degit user/repo#v1.0.0
```

## Installation

```bash
npm install -g degit
```

`degit` requires Node.js 20 or later.

## CLI reference

### Basic syntax

```text
degit <src>[#ref] [<dest>] [options]
```

`src` is the repository to copy. `dest` is the directory to extract into; if omitted, `degit` uses the current directory.

### Supported sources

`degit` supports GitHub, GitLab, Bitbucket, and Sourcehut.

#### GitHub

```bash
degit user/repo
degit github:user/repo
degit https://github.com/user/repo
degit git@github.com:user/repo
```

#### GitLab

```bash
degit gitlab:user/repo
degit https://gitlab.com/user/repo
degit git@gitlab.com:user/repo
```

For a self-hosted GitLab instance, use the `gitlab://` protocol:

```bash
degit gitlab://git.example.com/user/repo
```

#### Bitbucket

```bash
degit bitbucket:user/repo
degit https://bitbucket.org/user/repo
degit git@bitbucket.org:user/repo
```

#### Sourcehut

```bash
degit git.sr.ht/user/repo
degit https://git.sr.ht/user/repo
degit git@git.sr.ht:user/repo
```

### Specify a tag, branch, or commit

Append `#ref` to any source:

```bash
degit user/repo#dev           # branch
degit user/repo#v1.2.3        # release tag
degit user/repo#1234abcd      # commit hash
```

If you omit the ref, `degit` resolves the repository's default branch.

### Create a new folder

If `dest` is omitted, `degit` extracts into the current directory. The directory must be empty unless you use `--force`. Use `--repo-name` or `-r` to extract into a directory named after the repository instead:

```bash
degit user/repo my-new-project
degit -r user/repo
```

### Clone a subdirectory

Add the subdirectory to the source:

```bash
degit user/repo/subdirectory
```

You can also paste a full GitHub URL:

```bash
degit https://github.com/user/repo/tree/main/subdirectory
```

For GitLab nested groups, `degit` first tries the two-segment `user/repo` interpretation, then falls back to treating the path as a nested group.

### Clone specific files

To keep only specific files or directories, use `--files` or `-F`. Separate paths with commas or repeat the flag:

```bash
degit user/repo my-project --files README.md,src/index.ts
degit user/repo my-project -F README.md -F src/index.ts
```

Missing or out-of-bounds paths are skipped with a warning; if no requested paths resolve, the whole destination is kept.

### Options

| Option            | Short        | Description                                                                                           |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `--help`          | `-h`         | Show help text.                                                                                       |
| `--version`       | `-V`         | Show the version.                                                                                     |
| `--cache`         | `-c`         | Only use the local cache; do not hit the network.                                                     |
| `--force`         | `-f`         | Allow cloning into a non-empty destination directory.                                                 |
| `--files <paths>` | `-F <paths>` | Keep only the listed files or directories.                                                            |
| `--repo-name`     | `-r`         | Clone into a directory named after the repository.                                                    |
| `--verbose`       | `-v`         | Print extra progress information.                                                                     |
| `--mode <mode>`   | `-m`         | `tar` (default) or `git`. `--mode=git` is accepted for compatibility but prints a deprecation notice. |

Run `degit --help` to see the published help text.

### Caching

`degit` caches downloaded tar snapshots in a platform-appropriate directory:

- Linux/BSD: `$XDG_CACHE_HOME/degit` or `~/.cache/degit`
- macOS: `~/Library/Caches/degit`
- Windows: `%LOCALAPPDATA%\degit` or `~/AppData/Local/degit`

By default, `degit` resolves the latest ref from the network and falls back to the cached version if the network is unreachable. Use `--cache` to skip the network request and only use a local cached copy.

### Private repositories

Private repositories are handled automatically. `degit` tries the HTTPS tarball path by default and falls back to SSH cloning when it cannot fetch or extract a snapshot. SSH/private repositories still require `git` on your `PATH`.

### HTTPS proxying

If you set the `https_proxy` environment variable, `degit` uses it when fetching tar archives.

### Aliases

Save an alias:

```bash
degit alias github:user/repo myRepo
```

Use it:

```bash
degit myRepo
```

Manage aliases:

```bash
degit unalias myRepo
degit ls                    # list saved aliases
```

Aliases are stored in `aliases.json` inside the `degit` cache directory.

### Interactive mode

Running `degit` with no arguments starts an interactive picker. It prompts for a source, destination, and whether to use the cache. If the destination is not empty, it asks whether to overwrite.

## ESM API

`degit` can also be used inside a Node script.

### Basic example

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

emitter.on('warn', (info) => {
	console.warn(info.message);
});

await emitter.clone('path/to/dest');
console.log('done');
```

### Constructor options

| Option    | Type                     | Description                                                      |
| --------- | ------------------------ | ---------------------------------------------------------------- |
| `aliases` | `Record<string, string>` | Alias map used when resolving `src`.                             |
| `cache`   | `boolean`                | Only use local cache; do not hit the network.                    |
| `fetch`   | `FetchFn`                | Custom `(url, dest, proxy?) => Promise<void>` download function. |
| `files`   | `string[]`               | Keep only the listed files or directories.                       |
| `force`   | `boolean`                | Allow cloning into a non-empty destination.                      |
| `git`     | `GitClient`              | Custom git client for ref resolution and fallback cloning.       |
| `mode`    | `'tar' \| 'git'`         | Clone mode. `tar` is the default.                                |
| `verbose` | `boolean`                | Print extra progress information.                                |

### Events

The returned emitter exposes two event channels:

- `info` — progress and success messages.
- `warn` — non-fatal issues, such as skipped paths or fallback notices.

Event objects include at least `message`. They may also include `code`, `dest`, `repo`, `url`, `ref`, and `subdir`.

### Running actions programmatically

You can run `degit.json`-style actions without first cloning a repository. Just omit the source and call `doActions`:

```js
import degit from 'degit';

const emitter = degit();

await emitter.doActions(
	[
		{ action: 'clone', src: 'user/another-repo' },
		{ action: 'remove', files: ['LICENSE'] },
	],
	'path/to/dest',
);
```

Rules:

- A `clone` action can create the destination. `remove` and `search_replace` need an existing directory.
- The destination must not be a symlink, even to a directory; symlinks are rejected with `ENOTDIR`.
- Child `clone` directives use their own source's natural mode, not the parent instance's `mode`.
- When a clone overwrites an existing destination, the original files are stashed, the clone runs, and then the original files are merged back. Clone output keeps the original `degit.json` if one existed.
- `clone()` on a source-less instance rejects with `MISSING_SRC`.

## degit.json actions

After the initial clone, `degit` looks for a `degit.json` file at the top level of the destination and runs the actions it defines. A JSON Schema is available at [schemas/degit.schema.json](../schemas/degit.schema.json) for editor autocompletion and validation.

### clone

Clone another repository into the destination, preserving existing files:

```json
[
	{
		"action": "clone",
		"src": "user/another-repo"
	},
	{
		"action": "clone",
		"src": "user/another-repo",
		"files": ["README.md", "src/index.ts"]
	}
]
```

The cloned repo can define its own `degit.json` actions.

### search_replace

Replace every match of a regular expression in the listed files. The `replacement` field is the **name** of an environment variable; its value is used as the replacement string.

```json
[
	{
		"action": "search_replace",
		"files": ["package.json", "README.md"],
		"pattern": "\\{\\{project_name\\}\\}",
		"replacement": "PROJECT_NAME"
	}
]
```

`files` can be a single path or an array of paths. Paths are resolved relative to the destination; paths outside the destination are skipped.

### remove

Remove one or more files:

```json
[
	{
		"action": "remove",
		"files": ["LICENSE"]
	}
]
```

`files` entries support glob patterns, so you can remove a whole class of files without listing each one. Because glob patterns can match more files than intended, they are only processed when `allowGlobs` is set to `true`. Matches outside the destination are skipped.

```json
[
	{
		"action": "remove",
		"files": [".github/**/*.md"],
		"allowGlobs": true
	}
]
```

## Why not just `git clone --depth 1`?

A few salient differences:

- `git clone` leaves a `.git` folder that belongs to the template, not your new project. You can easily forget to re-init the repository.
- `degit` caches archives and can work offline after the first download.
- Less to type (`degit user/repo` versus `git clone --depth 1 ssh://git@github.com/user/repo`).
- Composable post-clone actions through `degit.json`.
- Built-in support for subdirectories, file filtering, and aliases.

## See also

- [README.md](../README.md) — project overview and quick start
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — repository architecture
- [docs/CONTRIBUTING.md](CONTRIBUTING.md) — contributing and development workflow
- [assets/help.md](../assets/help.md) — published CLI help text
