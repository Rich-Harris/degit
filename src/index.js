import fs from 'fs';
import path from 'path';
import homeOrTmp from 'home-or-tmp';
import tar from 'tar';
import EventEmitter from 'events';
import { DegitError, exec, fetch, mkdirp, tryRequire } from './utils';

const base = path.join(homeOrTmp, '.degit');

export default function degit(src, opts) {
	return new Degit(src, opts);
}

class Degit extends EventEmitter {
	constructor(src, opts = {}) {
		super();

		this.src = src;
		this.cache = opts.cache;
		this.force = opts.force;
		this.verbose = opts.verbose;
		// Consider allowing proxy override via an argument?
		this.proxy = process.env.https_proxy;

		this.repo = parse(src);
	}

	async clone(dest) {
		this._checkDirIsEmpty(dest);

		const repo = this.repo;

		const dir = path.join(base, repo.site, repo.user, repo.name);
		const cached = tryRequire(path.join(dir, 'map.json')) || {};

		const hash = this.cache ?
			this._getHashFromCache(repo, cached) :
			await this._getHash(repo, cached);

		if (!hash) {
			// TODO 'did you mean...?'
			throw new DegitError(`could not find commit hash for ${repo.ref}`, {
				code: 'MISSING_REF',
				ref: repo.ref
			});
		}

		const file = `${dir}/${hash}.tar.gz`;
		const url = (
			repo.site === 'gitlab' ? `${repo.url}/repository/archive.tar.gz?ref=${hash}` :
			repo.site === 'bitbucket' ? `${repo.url}/get/${hash}.tar.gz` :
			`${repo.url}/archive/${hash}.tar.gz`
		);

		try {
			if (!this.cache) {
				try {
					fs.statSync(file);
					this._verbose({
						code: 'FILE_EXISTS',
						message: `${file} already exists locally`
					});
				} catch (err) {
					mkdirp(path.dirname(file));

					if (this.proxy) {
						this._verbose({
							code: 'PROXY',
							message: `using proxy ${this.proxy}`
						});
					}

					this._verbose({
						code: 'DOWNLOADING',
						message: `downloading ${url} to ${file}`
					});

					await fetch(url, file, this.proxy);
				}
			}
		} catch (err) {
			throw new DegitError(`could not download ${url}`, {
				code: 'COULD_NOT_DOWNLOAD',
				url,
				original: err
			});
		}

		updateCache(dir, repo, hash, cached);

		this._verbose({
			code: 'EXTRACTING',
			message: `extracting ${file} to ${dest}`
		});

		mkdirp(dest);
		await untar(file, dest);

		this._info({
			code: 'SUCCESS',
			message: `cloned ${repo.user}/${repo.name}#${repo.ref}${dest !== '.' ? ` to ${dest}` : ''}`,
			repo,
			dest
		});
	}

	_checkDirIsEmpty(dir) {
		try {
			const files = fs.readdirSync(dir);
			if (files.length > 0) {
				if (this.force) {
					this._info({
						code: 'DEST_NOT_EMPTY',
						message: `destination directory is not empty. Using options.force, continuing`
					});
				} else {
					throw new DegitError(`destination directory is not empty, aborting. Use options.force to override`, {
						code: 'DEST_NOT_EMPTY'
					});
				}
			} else {
				this._verbose({
					code: 'DEST_IS_EMPTY',
					message: `destination directory is empty`
				});
			}
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
	}

	_info(info) {
		this.emit('info', info);
	}

	_verbose(info) {
		if (this.verbose) this._info(info);
	}

	async _getHash(repo, cached) {
		try {
			const refs = await fetchRefs(repo);
			return this._selectRef(refs, repo.ref);
		} catch (err) {
			return this._getHashFromCache(repo, cached);
		}
	}

	_getHashFromCache(repo, cached) {
		if (repo.ref in cached) {
			const hash = cached[repo.ref];
			this._info({
				code: 'USING_CACHE',
				message: `using cached commit hash ${hash}`
			});
			return hash;
		}
	}

	_selectRef(refs, selector) {
		for (const ref of refs) {
			if (ref.name === selector) {
				this._verbose({
					code: 'FOUND_MATCH',
					message: `found matching commit hash: ${ref.hash}`
				});
				return ref.hash;
			}
		}

		if (selector.length < 8) return null;

		for (const ref of refs) {
			if (ref.hash.startsWith(selector)) return ref.hash;
		}
	}
}

const supported = new Set(['github', 'gitlab', 'bitbucket']);

function parse(src) {
	const match = /^(?:https:\/\/([^/]+)\/|git@([^/]+):|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:#(.+))?/.exec(src);
	if (!match) {
		throw new DegitError(`could not parse ${src}`, {
			code: 'BAD_SRC'
		});
	}

	const site = (match[1] || match[2] || match[3] || 'github').replace(/\.(com|org)$/, '');
	if (!supported.has(site)) {
		throw new DegitError(`degit supports GitHub, GitLab and BitBucket`, {
			code: 'UNSUPPORTED_HOST'
		});
	}

	const user = match[4];
	const name = match[5].replace(/\.git$/, '');
	const ref = match[6] || 'master';

	const url = `https://${site}.${site === 'bitbucket' ? 'org' : 'com'}/${user}/${name}`;

	return { site, user, name, ref, url };
}

async function untar(file, dest) {
	return tar.extract({
		file,
		strip: 1,
		C: dest
	});
}

async function fetchRefs(repo) {
	const { stdout } = await exec(`git ls-remote ${repo.url}`);

	return stdout.split('\n').filter(Boolean).map(row => {
		const [hash, ref] = row.split('\t');

		if (ref === 'HEAD') {
			return {
				type: 'HEAD',
				hash
			};
		}

		const match = /refs\/(\w+)\/(.+)/.exec(ref);
		if (!match) throw new DegitError(`could not parse ${ref}`, { code: 'BAD_REF' });

		return {
			type: (
				match[1] === 'heads' ? 'branch' :
				match[1] === 'refs' ? 'ref' :
				match[1]
			),
			name: match[2],
			hash
		};
	});
}

function updateCache(dir, repo, hash, cached) {
	if (cached[repo.ref] === hash) return;

	const oldHash = cached[repo.ref];
	if (oldHash) {
		let used = false;
		for (const key in cached) {
			if (cached[key] === hash) {
				used = true;
				break;
			}
		}

		if (!used) {
			// we no longer need this tar file
			try {
				fs.unlinkSync(path.join(dir, `${oldHash}.tar.gz`));
			} catch (err) {
				// ignore
			}
		}
	}

	cached[repo.ref] = hash;
	fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(cached, null, '  '));
}