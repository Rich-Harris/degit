---
name: degit
description: Download a repository snapshot or template with degit
argument-hint: '<source> [destination]'
---

Help the user scaffold a project with `degit`. Use `npx degit@latest` unless they have installed `degit` globally.

Start with the smallest command that matches their request:

```sh
npx degit@latest user/repo
npx degit@latest user/repo my-project
npx degit@latest user/repo#branch my-project
```

Sources can be GitHub (`user/repo`, `github:user/repo`, or a GitHub URL), GitLab (`gitlab:user/repo`, a GitLab URL, or `gitlab://host/user/repo`), Bitbucket (`bitbucket:user/repo` or URL), or Sourcehut (`git.sr.ht/user/repo`, SSH form, or URL). A `#ref` can name a branch, tag, or commit. A source may include a subdirectory path.

- The destination defaults to the current directory and must be empty. Do not suggest `--force` unless the user explicitly wants to overwrite its contents.
- Use `--cache` to require a cached copy (no network). Without `--cache`, degit tries the network first and falls back to the cached copy if the network is unreachable. Use `--verbose` to diagnose failures. `--mode=git` still works but is unnecessary; tar snapshots are the default.
- Use `--files <paths>` or `-F <paths>` to clone only specific files or directories; separate multiple paths with commas or repeat the flag.
- Private repositories are handled automatically, with SSH fallback when needed. SSH/private use requires `git` on `PATH` and working repository credentials.
- For reusable shortcuts, use `degit alias <repo> <name>`, then `degit <name>`; use `degit ls` and `degit unalias <name>` to manage aliases.
- If a template needs post-download changes, explain that its top-level `degit.json` can use `clone`, `search_replace`, and `remove` actions. `search_replace` uses a named environment variable for its replacement value.

If source, ref, destination, or whether the destination is empty is unknown, ask before giving a potentially destructive command.
