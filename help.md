# _degit_

Usage:

  `degit <src>[#ref] [<dest>] [options]`

Fetches the `src` repo, and extracts it to `dest` (or the current directory).

The `src` argument can be any of the following:

  ## GitHub repos
  user/repo
  github:user/repo
  https://github.com/user/repo

  ## GitLab repos
  gitlab:user/repo
  https://gitlab.com/user/repo

  ## BitBucket repos
  bitbucket:user/repo
  https://bitbucket.com/user/repo

You can a #ref to any of the above:

  ## Branches (defaults to master)
  user/repo#dev

  ## Tags
  user/repo#v1.2.3

  ## Commit hashes
  user/repo#abcd1234

The `dest` directory (or the current directory, if unspecified) must be empty
unless the `--force` option is used.

Options:

  `--help`, `-h`     Show this message
  `--force`, `-f`    Allow non-empty destination directory

See https://github.com/Rich-Harris/degit for more information