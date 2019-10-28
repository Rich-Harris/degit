import fs from 'fs';
import path from 'path';
import homeOrTmp from 'home-or-tmp';
import EventEmitter from 'events';
import gu from 'githuburl';
import chalk from 'chalk';
import { rimrafSync, copydirSync } from 'sander';
import {
	DegitError,
	exec,
	mkdirp,
	tryRequire,
	stashFiles,
	unstashFiles,
	degitConfigName,
} from './utils';

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

		this.repo = parse(src);

		this._hasStashed = false;

		this.directiveActions = {
			clone: async (dir, dest, action) => {
				if (this._hasStashed === false) {
					stashFiles(dir, dest);
					this._hasStashed = true;
				}
				const opts = Object.assign(
					{ force: true },
					{ cache: action.cache, verbose: action.verbose }
				);
				const d = degit(action.src, opts);

				d.on('info', event => {
					console.error(
						chalk.cyan(`> ${event.message.replace('options.', '--')}`)
					);
				});

				d.on('warn', event => {
					console.error(
						chalk.magenta(`! ${event.message.replace('options.', '--')}`)
					);
				});

				await d.clone(dest).catch(err => {
					console.error(chalk.red(`! ${err.message}`));
					process.exit(1);
				});
			},
			remove: this.remove.bind(this),
		};
	}

	_getDirectives(dest) {
		const directivesPath = path.resolve(dest, degitConfigName);
		const directives =
			tryRequire(directivesPath, { clearCache: true }) || false;
		if (directives) {
			fs.unlinkSync(directivesPath);
		}

		return directives;
	}

	async clone(dest) {
		this._checkDirIsEmpty(dest);

		const repo = this.repo;

		const dir = path.join(base, repo.site, repo.user, repo.name);
		const cached = tryRequire(path.join(dir, 'map.json')) || {};

		const hash =
			(this.cache
				? this._getHashFromCache(repo, cached)
				: await this._getHash(repo, cached)) || repo.ref;

		if (!hash) {
			// TODO 'did you mean...?'
			throw new DegitError(`could not find commit hash for ${repo.ref}`, {
				code: 'MISSING_REF',
				ref: repo.ref,
			});
		}

		const file = `${dir}/${hash}/`;

		try {
			if (!this.cache) {
				try {
					fs.statSync(file);
					this._verbose({
						code: 'FILE_EXISTS',
						message: `${file} already exists locally`,
					});
				} catch (err) {
					mkdirp(path.dirname(file));
					this._verbose({
						code: 'DOWNLOADING',
						message: `downloading ${repo.url} to ${file}`,
					});
					const urls = gu(repo.url);

					try {
						try {
							await exec(`git clone ${urls.https_clone_url} ${file}`);
						} catch (error) {
							await exec(`git clone ${urls.ssh_clone_url} ${file}`);
						}
					} catch (error) {
						console.log(`Could not clone repo with HTTPS or SSH: ${repo.url}`);
					}

					await exec(
						`cd ${file} && git fetch origin ${hash} && git checkout ${hash}`
					);
					rimrafSync(`${file}/.git`);
				}
			}
		} catch (err) {
			throw new DegitError(`could not download ${repo.url}`, {
				code: 'COULD_NOT_DOWNLOAD',
				repo,
				original: err,
			});
		}

		updateCache(dir, repo, hash, cached);

		this._verbose({
			code: 'EXTRACTING',
			message: `extracting ${file} to ${dest}`,
		});

		mkdirp(dest);
		copydirSync(file).to(dest);

		this._info({
			code: 'SUCCESS',
			message: `cloned ${chalk.bold(repo.user + '/' + repo.name)}#${chalk.bold(
				repo.ref
			)}${dest !== '.' ? ` to ${dest}` : ''}`,
			repo,
			dest,
		});

		const directives = this._getDirectives(dest);
		if (directives) {
			for (const d of directives) {
				// TODO, can this be a loop with an index to pass for better error messages?
				await this.directiveActions[d.action](dir, dest, d);
			}
			if (this._hasStashed === true) {
				unstashFiles(dir, dest);
			}
		}
	}

	remove(dir, dest, action) {
		let files = action.files;
		if (!Array.isArray(files)) {
			files = [files];
		}
		const removedFiles = files
			.map(file => {
				const filePath = path.resolve(dest, file);
				if (fs.existsSync(filePath)) {
					const isDir = fs.lstatSync(filePath).isDirectory();
					if (isDir) {
						rimrafSync(filePath);
						return file + '/';
					} else {
						fs.unlinkSync(filePath);
						return file;
					}
				} else {
					this._warn({
						code: 'FILE_DOES_NOT_EXIST',
						message: `action wants to remove ${chalk.bold(
							file
						)} but it does not exist`,
					});
					return null;
				}
			})
			.filter(d => d);

		if (removedFiles.length > 0) {
			this._info({
				code: 'REMOVED',
				message: `removed: ${chalk.bold(
					removedFiles.map(d => chalk.bold(d)).join(', ')
				)}`,
			});
		}
	}

	_checkDirIsEmpty(dir) {
		try {
			const files = fs.readdirSync(dir);
			if (files.length > 0) {
				if (this.force) {
					this._info({
						code: 'DEST_NOT_EMPTY',
						message: `destination directory is not empty. Using options.force, continuing`,
					});
				} else {
					throw new DegitError(
						`destination directory is not empty, aborting. Use options.force to override`,
						{
							code: 'DEST_NOT_EMPTY',
						}
					);
				}
			} else {
				this._verbose({
					code: 'DEST_IS_EMPTY',
					message: `destination directory is empty`,
				});
			}
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
	}

	_info(info) {
		this.emit('info', info);
	}

	_warn(info) {
		this.emit('warn', info);
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
				message: `using cached commit hash ${hash}`,
			});
			return hash;
		}
	}

	_selectRef(refs, selector) {
		for (const ref of refs) {
			if (ref.name === selector) {
				this._verbose({
					code: 'FOUND_MATCH',
					message: `found matching commit hash: ${ref.hash}`,
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
	const match = /^(?:https:\/\/([^/]+)\/|git@([^/]+):|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:#(.+))?/.exec(
		src
	);
	if (!match) {
		throw new DegitError(`could not parse ${src}`, {
			code: 'BAD_SRC',
		});
	}

	const site = (match[1] || match[2] || match[3] || 'github').replace(
		/\.(com|org)$/,
		''
	);
	if (!supported.has(site) && !site.includes('github')) {
		throw new DegitError(`degit supports GitHub, GitLab and BitBucket`, {
			code: 'UNSUPPORTED_HOST',
		});
	}

	const user = match[4];
	const name = match[5].replace(/\.git$/, '');
	const ref = match[6] || 'master';

	const url = `https://${site}.${
		site === 'bitbucket' ? 'org' : 'com'
	}/${user}/${name}`;

	return { site, user, name, ref, url };
}

async function fetchRefs(repo) {
	const { stdout } = await exec(`git ls-remote ${repo.url}`);

	return stdout
		.split('\n')
		.filter(Boolean)
		.map(row => {
			const [hash, ref] = row.split('\t');

			if (ref === 'HEAD') {
				return {
					type: 'HEAD',
					hash,
				};
			}

			const match = /refs\/(\w+)\/(.+)/.exec(ref);
			if (!match)
				throw new DegitError(`could not parse ${ref}`, {
					code: 'BAD_REF',
				});

			return {
				type:
					match[1] === 'heads'
						? 'branch'
						: match[1] === 'refs'
						? 'ref'
						: match[1],
				name: match[2],
				hash,
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
	fs.writeFileSync(
		path.join(dir, 'map.json'),
		JSON.stringify(cached, null, '  ')
	);
}
