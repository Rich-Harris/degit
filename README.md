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


## Installation

```bash
npm install -g degit
```


## Not supported

* Windows
* Private repositories
* Anything that isn't GitHub

Pull requests are very welcome!


## License

[MIT](LICENSE).