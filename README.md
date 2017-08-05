# degit — straightforward project scaffolding

**degit** makes copies of git repositories. When you run `degit some-user/some-repo`, it will find the latest commit on https://github.com/some-user/some-repo and download the associated tar file to `~/.degit/some-user/some-repo/commithash.tar.gz` if it doesn't already exist locally. (This is much quicker than using `git clone`, because you're not downloading the entire git history.)

You can specify a specific branch, tag or commit hash...

```bash
degit some-user/some-repo#some-feature # branch
degit some-user/some-repo#v1.0.0       # tag
degit some-user/some-repo#1234abcd     # commit hash
```

...or create a new folder for the project...

```bash
degit some-user/some-repo my-new-project
```

...and that's it. As simple as possible, and no simpler.

Degit works with github , gitlab, bitbucket, or custom git servers:

```bash
degit github:some-user/some-repo   # same as degit some-user/some-repo
degit gitlab:some-user/some-repo
degit bitbucket:some-user/some-repo
degit https://some-custom-git-server.org/some-path/repo.git
```

## Installation

```bash
npm install -g degit
```


## Not supported

* Private repositories

Pull requests are very welcome!


## Wait, isn't this just `git clone --depth 1`?

A few salient differences:

* If you `git clone`, you get a `.git` folder that pertains to the project template, rather than your project. You can easily forget to re-init the repository, and end up confusing yourself
* Caching and offline support (if you already have a `.tar.gz` file for a specific commit, you don't need to fetch it again).
* Less to type (`degit user/repo` instead of `git clone --depth 1 git@github.com:user/repo`)
* Future capabilities — [interactive mode](https://github.com/Rich-Harris/degit/issues/4), [friendly onboarding and postinstall scripts](https://github.com/Rich-Harris/degit/issues/6)


## License

[MIT](LICENSE).
