# degit changelog

## 3.4.6

- Block `remove` path traversal outside the destination.

## 3.4.5

- Stream `git ls-remote` for SSH ref discovery.

## 3.4.4

- Remove the `sander` dependency in favor of native Node `fs` helpers.

## 3.4.3

- Swap terminal colors to yoctocolors.

## 3.4.2

- Fix git-lfs pointer files falling through the tarball path.

## 3.4.1

- Fix first-clone hangs during archive downloads.

## 3.4.0

- Tarball downloads are now the default, with SSH fallback on failure.
- Public remotes now prefer HTTPS; explicit SSH sources still use SSH.
- The JavaScript git backend is bundled for HTTPS ref discovery; SSH/private repos still need system `git`.
- The published package no longer includes sourcemaps, so the tarball is smaller.

## 3.3.2

- Retry corrupt tarball downloads ([#313](https://github.com/Rich-Harris/degit/issues/313)).

## 3.3.1

- Harden git-mode command execution and remote validation.

## 3.3.0

- Add platform-aware cache resolution so degit uses the standard user cache location on each supported OS ([#45](https://github.com/Rich-Harris/degit/issues/45)).

## 3.2.0

- Split CLI output by severity so info messages go to stdout while warnings and errors stay on stderr ([#382](https://github.com/Rich-Harris/degit/issues/382)).

## 3.1.2

- Fix interactive repo selection on Windows.

## 3.1.1

- Sync `assets/help.md` to say branches default to the repository's default branch.

## 3.1.0

- Add new type definitions for the published package surface.

## 3.0.0

- Major release for the Node 20+ line; v2 remains the legacy Node 8-compatible branch.
- Upgrade `tar` to a patched release to address the security issue that affected the previous dependency.

## 2.8.6

- Harden git-mode command execution and remote validation.

## 2.8.5

- Final v2 security patch; keep Node 8 compatibility on the legacy line.
- Node 20 starts with v3.

## 2.8.4

- Whoops

## 2.8.3

- Reinstate `#!/usr/bin/env node` ([#273](https://github.com/Rich-Harris/degit/issues/273))

## 2.8.2

- Fix `bin`/`main` locations ([#273](https://github.com/Rich-Harris/degit/issues/273))
- Update dependencies

## 2.8.1

- Use `HEAD` instead of `master` ([#243](https://github.com/Rich-Harris/degit/pull/243)])

## 2.8.0

- Sort by recency in interactive mode

## 2.7.0

- Bundle for a faster install

## 2.6.0

- Add an interactive mode ([#4](https://github.com/Rich-Harris/degit/issues/4))

## 2.5.0

- Add `--mode=git` for cloning private repos ([#29](https://github.com/Rich-Harris/degit/pull/29))

## 2.4.0

- Clone subdirectories from repos (`user/repo/subdir`)

## 2.3.0

- Support HTTPS proxying where `https_proxy` env var is supplied ([#26](https://github.com/Rich-Harris/degit/issues/26))

## 2.2.2

- Improve CLI error logging ([#49](https://github.com/Rich-Harris/degit/pull/49))

## 2.2.1

- Update `help.md` for Sourcehut support

## 2.2.0

- Sourcehut support ([#85](https://github.com/Rich-Harris/degit/pull/85))

## 2.1.4

- Fix actions ([#65](https://github.com/Rich-Harris/degit/pull/65))
- Improve CLI error logging ([#46](https://github.com/Rich-Harris/degit/pull/46))

## 2.1.3

- Install `sander` ([#34](https://github.com/Rich-Harris/degit/issues/34))

## 2.1.2

- Remove `console.log`

## 2.1.1

- Oops, managed to publish 2.1.0 without building

## 2.1.0

- Add actions ([#28](https://github.com/Rich-Harris/degit/pull/28))

## 2.0.2

- Allow flags like `-v` before argument ([#25](https://github.com/Rich-Harris/degit/issues/25))

## 2.0.1

- Update node-tar for Node 9 compatibility

## 2.0.0

- Expose API for use in Node scripts ([#23](https://github.com/Rich-Harris/degit/issues/23))

## 1.2.2

- Fix `files` in package.json

## 1.2.1

- Add `engines` field ([#17](https://github.com/Rich-Harris/degit/issues/17))

## 1.2.0

- Windows support ([#1](https://github.com/Rich-Harris/degit/issues/1))
- Offline support and `--cache` flag ([#8](https://github.com/Rich-Harris/degit/issues/8))
- `degit --help` ([#5](https://github.com/Rich-Harris/degit/issues/5))
- `--verbose` flag

## 1.1.0

- Use HTTPS, not SSH ([#11](https://github.com/Rich-Harris/degit/issues/11))

## 1.0.0

- First release
