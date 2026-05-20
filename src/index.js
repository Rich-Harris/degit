import fs from 'node:fs';
import path from 'node:path';
import tar from 'tar';
import EventEmitter from 'node:events';
import chalk from 'chalk';
import { rimrafSync } from 'sander';
import {
	DegitError,
	base,
	degitConfigName,
	exec,
	fetch,
	mkdirp,
	stashFiles,
	tryRequire,
	unstashFiles,
} from './utils.js';

const validModes = new Set(['tar', 'git']);

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
		this.proxy = process.env.https_proxy; // TODO allow setting via --proxy

		this.repo = parse(src);
		this.mode = opts.mode || this.repo.mode;
		this._fetch = opts.fetch || fetch;
		this._exec = opts.exec || exec;

		if (!validModes.has(this.mode)) {
			throw new Error(`Valid modes are ${[...validModes].join(', ')}`);
		}

		this._hasStashed = false;

		this.directiveActions = {
			clone: async (dir, dest, action) => {
				if (this._hasStashed === false) {
					stashFiles(dir, dest);
					this._hasStashed = true;
				}
				const opts = {
					force: true,
					cache: action.cache,
					verbose: action.verbose,
				};
				const d = degit(action.src, opts);

				d.on('info', (event) => {
					console.error(chalk.cyan(`> ${event.message.replace('options.', '--')}`));
				});

				d.on('warn', (event) => {
					console.error(chalk.magenta(`! ${event.message.replace('options.', '--')}`));
				});

				await d.clone(dest).catch((error) => {
					console.error(chalk.red(`! ${error.message}`));
					process.exit(1);
				});
			},
			remove: this.remove.bind(this),
		};
	}

	_getDirectives(dest) {
		const directivesPath = path.resolve(dest, degitConfigName);
		const directives = tryRequire(directivesPath, { clearCache: true }) || false;
		if (directives) {
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.unlinkSync(directivesPath);
		}

		return directives;
	}

	async clone(dest) {
		this._checkDirIsEmpty(dest);

		const { repo } = this;

		const dir = path.join(base, repo.site, repo.user, repo.name);

		if (this.mode === 'tar') {
			await this._cloneWithTar(dir, dest);
		} else {
			await this._cloneWithGit(dir, dest);
		}

		this._info({
			code: 'SUCCESS',
			dest,
			message: `cloned ${chalk.bold(repo.user + '/' + repo.name)}#${chalk.bold(
				repo.ref,
			)}${dest !== '.' ? ` to ${dest}` : ''}`,
			repo,
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

	/* eslint-disable security/detect-non-literal-fs-filename */
	remove(dir, dest, action) {
		let { files } = action;
		if (!Array.isArray(files)) {
			files = [files];
		}
		const removedFiles = files
			.map((file) => {
				const filePath = path.resolve(dest, file);
				if (fs.existsSync(filePath)) {
					const isDir = fs.lstatSync(filePath).isDirectory();
					if (isDir) {
						rimrafSync(filePath);
						return `${file}/`;
					}
					fs.unlinkSync(filePath);
					return file;
				}
				this._warn({
					code: 'FILE_DOES_NOT_EXIST',
					message: `action wants to remove ${chalk.bold(file)} but it does not exist`,
				});
				return null;
			})
			.filter((d) => d);

		if (removedFiles.length > 0) {
			this._info({
				code: 'REMOVED',
				message: `removed: ${chalk.bold(removedFiles.map((d) => chalk.bold(d)).join(', '))}`,
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
						},
					);
				}
			} else {
				this._verbose({
					code: 'DEST_IS_EMPTY',
					message: `destination directory is empty`,
				});
			}
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	/* eslint-enable security/detect-non-literal-fs-filename */
	_info(info) {
		this.emit('info', info);
	}

	_warn(info) {
		this.emit('warn', info);
	}

	_verbose(info) {
		if (this.verbose) {
			this._info(info);
		}
	}

	async _getHash(repo, cached) {
		try {
			const refs = await this._fetchRefs(repo);
			if (repo.ref === 'HEAD') {
				return refs.find((ref) => ref.type === 'HEAD').hash;
			}
			return this._selectRef(refs, repo.ref);
		} catch (error) {
			this._warn(error);
			this._verbose(error.original);

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

		if (selector.length < 8) {
			return null;
		}

		for (const ref of refs) {
			if (ref.hash.startsWith(selector)) {
				return ref.hash;
			}
		}
	}

	async _cloneWithTar(dir, dest) {
		const { repo } = this;

		const cached = tryRequire(path.join(dir, 'map.json')) || {};

		const hash = this.cache
			? this._getHashFromCache(repo, cached)
			: await this._getHash(repo, cached);

		const subdir = repo.subdir ? `${repo.name}-${hash}${repo.subdir}` : null;

		if (!hash) {
			// TODO 'did you mean...?'
			throw new DegitError(`could not find commit hash for ${repo.ref}`, {
				code: 'MISSING_REF',
				ref: repo.ref,
			});
		}

		const file = `${dir}/${hash}.tar.gz`;
		const url =
			repo.site === 'gitlab'
				? `${repo.url}/repository/archive.tar.gz?ref=${hash}`
				: repo.site === 'bitbucket'
					? `${repo.url}/get/${hash}.tar.gz`
					: `${repo.url}/archive/${hash}.tar.gz`;

		try {
			if (!this.cache) {
				try {
					// eslint-disable-next-line security/detect-non-literal-fs-filename
					fs.statSync(file);
					this._verbose({
						code: 'FILE_EXISTS',
						message: `${file} already exists locally`,
					});
				} catch {
					mkdirp(path.dirname(file));

					if (this.proxy) {
						this._verbose({
							code: 'PROXY',
							message: `using proxy ${this.proxy}`,
						});
					}

					this._verbose({
						code: 'DOWNLOADING',
						message: `downloading ${url} to ${file}`,
					});

					await this._fetch(url, file, this.proxy);
				}
			}
		} catch (error) {
			throw new DegitError(`could not download ${url}`, {
				code: 'COULD_NOT_DOWNLOAD',
				url,
				original: error,
			});
		}

		updateCache(dir, repo, hash, cached);

		this._verbose({
			code: 'EXTRACTING',
			message: `extracting ${subdir ? `${repo.subdir} from ` : ''}${file} to ${dest}`,
		});

		mkdirp(dest);
		await untar(file, dest, subdir);
	}

	async _cloneWithGit(dir, dest) {
		await this._exec('git', ['clone', this.repo.ssh, dest]);
		await this._exec('rm', ['-rf', path.resolve(dest, '.git')]);
	}

	_fetchRefs(repo) {
		return fetchRefs(repo, this._exec);
	}
}

const supported = new Set(['github', 'gitlab', 'bitbucket', 'git.sr.ht']);

function parse(src) {
	const [source, refValue = 'HEAD'] = src.split('#', 2);
	let site = 'github';
	let remainder = source;

	if (source.startsWith('https://') || source.startsWith('http://')) {
		const parsed = new URL(source);
		site = parsed.hostname.replace(/\.(com|org)$/, '');
		remainder = parsed.pathname.replace(/^\//, '');
	} else if (source.startsWith('git@')) {
		const match = /^git@([^:/]+)[:/](.+)$/.exec(source);
		if (!match) {
			throw new DegitError(`could not parse ${src}`, {
				code: 'BAD_SRC',
			});
		}

		site = match[1].replace(/\.(com|org)$/, '');
		remainder = match[2];
	} else if (source.startsWith('git.sr.ht/')) {
		site = 'git.sr.ht';
		remainder = source.slice('git.sr.ht/'.length);
	} else {
		const colonIndex = source.indexOf(':');
		const slashIndex = source.indexOf('/');
		if (colonIndex !== -1 && (slashIndex === -1 || colonIndex < slashIndex)) {
			site = source.slice(0, colonIndex);
			remainder = source.slice(colonIndex + 1);
		}
	}

	if (!supported.has(site)) {
		throw new DegitError(`degit supports GitHub, GitLab, Sourcehut and BitBucket`, {
			code: 'UNSUPPORTED_HOST',
		});
	}

	const [user, rawName, ...subdirParts] = remainder.split('/').filter(Boolean);
	if (!user || !rawName) {
		throw new DegitError(`could not parse ${src}`, {
			code: 'BAD_SRC',
		});
	}

	const name = rawName.replace(/\.git$/, '');
	const subdir = subdirParts.length > 0 ? `/${subdirParts.join('/')}` : undefined;
	const ref = refValue;

	const domain =
		site === 'git.sr.ht' ? 'git.sr.ht' : site === 'bitbucket' ? `${site}.org` : `${site}.com`;
	const url = `https://${domain}/${user}/${name}`;
	const ssh = `git@${domain}:${user}/${name}`;

	const mode = supported.has(site) ? 'tar' : 'git';

	return { mode, name, ref, site, ssh, subdir, url, user };
}

async function untar(file, dest, subdir = null) {
	return tar.extract(
		{
			C: dest,
			file,
			strip: subdir ? subdir.split('/').length : 1,
		},
		subdir ? [subdir] : [],
	);
}

async function fetchRefs(repo, runExec = exec) {
	try {
		const { stdout } = await runExec('git', ['ls-remote', repo.url]);

		return stdout
			.split('\n')
			.filter(Boolean)
			.map((row) => {
				const [hash, ref] = row.split('\t');

				if (ref === 'HEAD') {
					return {
						hash,
						type: 'HEAD',
					};
				}

				const match = /refs\/(\w+)\/(.+)/.exec(ref);
				if (!match) {
					throw new DegitError(`could not parse ${ref}`, {
						code: 'BAD_REF',
					});
				}

				return {
					hash,
					name: match[2],
					type: match[1] === 'heads' ? 'branch' : match[1] === 'refs' ? 'ref' : match[1],
				};
			});
	} catch (error) {
		throw new DegitError(`could not fetch remote ${repo.url}`, {
			code: 'COULD_NOT_FETCH',
			original: error,
			url: repo.url,
		});
	}
}

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-possible-timing-attacks, security/detect-object-injection */
function updateCache(dir, repo, hash, cached) {
	// Update access logs
	const logs = tryRequire(path.join(dir, 'access.json')) || {};
	logs[repo.ref] = new Date().toISOString();
	fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify(logs, null, '  '));

	if (cached[repo.ref] === hash) {
		return;
	}

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
			// We no longer need this tar file
			try {
				fs.unlinkSync(path.join(dir, `${oldHash}.tar.gz`));
			} catch {
				// Ignore
			}
		}
	}

	cached[repo.ref] = hash;
	fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(cached, null, '  '));
}

/* eslint-enable security/detect-non-literal-fs-filename, security/detect-possible-timing-attacks, security/detect-object-injection */
