# de-git — straightforward project scaffolding

>de-git is a fork of [degit](https://github.com/Rich-Harris/degit) by [Rich Harris](https://twitter.com/Rich_Harris) with support for self-hosted GitLab


**de-git** makes copies of git repositories. When you run `de-git some-user/some-repo`, it will find the latest commit on https://github.com/some-user/some-repo and download the associated tar file to `~/.de-git/some-user/some-repo/commithash.tar.gz` if it doesn't already exist locally. (This is much quicker than using `git clone`, because you're not downloading the entire git history.)

_Requires Node 8 or above, because `async` and `await` are the cat's pyjamas_

## Installation

```bash
npm install -g de-git
```

## Without Installation

If you don't want to install de-git globally, you can use `npx`:

```bash
npx de-git user/repo
```

## Usage

### Basics

The simplest use of de-git is to download the master branch of a repo from GitHub to the current working directory:

```bash
de-git user/repo

# these commands are equivalent
de-git github:user/repo
de-git git@github.com:user/repo
de-git https://github.com/user/repo
```

Or you can download from GitLab and BitBucket:

```bash
# download from GitLab
de-git gitlab:user/repo
de-git git@gitlab.com:user/repo
de-git https://gitlab.com/user/repo

# download from self-hosted GitLab
de-git git@your.gitlab.com:user/repo
de-git https://your.gitlab.com/user/repo

# download from BitBucket
de-git bitbucket:user/repo
de-git git@bitbucket.org:user/repo
de-git https://bitbucket.org/user/repo

# download from Sourcehut
de-git git.sr.ht/user/repo
de-git git@git.sr.ht:user/repo
de-git https://git.sr.ht/user/repo
```

### Specify a tag, branch or commit

The default branch is `master`.

```bash
de-git user/repo#dev       # branch
de-git user/repo#v1.2.3    # release tag
de-git user/repo#1234abcd  # commit hash
````

### Create a new folder for the project

If the second argument is omitted, the repo will be cloned to the current directory.

```bash
de-git user/repo my-new-project
```

### Specify a subdirectory

To clone a specific subdirectory instead of the entire repo, just add it to the argument:

```bash
de-git user/repo/subdirectory
```

### HTTPS proxying

If you have an `https_proxy` environment variable, de-git will use it.

### Private repositories

Private repos can be cloned by specifying `--mode=git` (the default is `tar`). In this mode, de-git will use `git` under the hood. It's much slower than fetching a tarball, which is why it's not the default.

Note: this clones over SSH, not HTTPS.

### See all options

```bash
de-git --help
```

## Not supported

- Private repositories

Pull requests are very welcome!

## Wait, isn't this just `git clone --depth 1`?

A few salient differences:

- If you `git clone`, you get a `.git` folder that pertains to the project template, rather than your project. You can easily forget to re-init the repository, and end up confusing yourself
- Caching and offline support (if you already have a `.tar.gz` file for a specific commit, you don't need to fetch it again).
- Less to type (`de-git user/repo` instead of `git clone --depth 1 git@github.com:user/repo`)
- Composability via [actions](#actions)
- Future capabilities — [interactive mode](https://github.com/Rich-Harris/de-git/issues/4), [friendly onboarding and postinstall scripts](https://github.com/Rich-Harris/de-git/issues/6)

## JavaScript API

You can also use de-git inside a Node script:

```js
const de-git = require('de-git');

const emitter = de-git('user/repo', {
	cache: true,
	force: true,
	verbose: true,
});

emitter.on('info', info => {
	console.log(info.message);
});

emitter.clone('path/to/dest').then(() => {
	console.log('done');
});
```

## Actions

You can manipulate repositories after they have been cloned with _actions_, specified in a `de-git.json` file that lives at the top level of the working directory. Currently, there are two actions — `clone` and `remove`. Additional actions may be added in future.

### clone

```json
// de-git.json
[
	{
		"action": "clone",
		"src": "user/another-repo"
	}
]
```

This will clone `user/another-repo`, preserving the contents of the existing working directory. This allows you to, say, add a new README.md or starter file to a repo that you do not control. The cloned repo can contain its own `de-git.json` actions.

### remove

```json
// de-git.json
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

## License

[MIT](LICENSE.md).
