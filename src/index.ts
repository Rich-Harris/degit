import fs from 'fs';
import path from 'path';
import tar from 'tar';
import EventEmitter from 'events';
import chalk from 'chalk';
import { rimrafSync } from 'sander';
import {
	DegitError,
	exec,
	fetch,
	mkdirp,
	tryRequire,
	stashFiles,
	unstashFiles,
	degitConfigName,
	base
} from './utils';

type DegitMode = 'tar' | 'git';

interface ExecResult {
	stdout: string;
	stderr: string;
}

interface Directive {
	action: 'clone' | 'remove';
	src?: string;
	cache?: boolean;
	verbose?: boolean;
	files?: string | string[];
}

interface DegitOptions {
	cache?: boolean;
	force?: boolean;
	verbose?: boolean;
	fetch?: (url: string, dest: string, proxy?: string) => Promise<void>;
	exec?: (command: string) => Promise<ExecResult>;
	mode?: DegitMode;
}

interface RepoRef {
	type: string;
	name?: string;
	hash: string;
}

interface Repo {
	site: string;
	user: string;
	name: string;
	ref: string;
	url: string;
	ssh: string;
	subdir?: string;
	mode: DegitMode;
}

interface DegitEvent {
	code: string;
	message: string;
	repo?: Repo;
	dest?: string;
}

const validModes = new Set<DegitMode>(['tar', 'git']);

export default function degit(src: string, opts: DegitOptions = {}): Degit {
	return new Degit(src, opts);
}

class Degit extends EventEmitter {
	src: string;
	cache: boolean;
	force: boolean;
	verbose: boolean;
	proxy?: string;
	repo: Repo;
	mode: DegitMode;
	_fetch: (url: string, dest: string, proxy?: string) => Promise<void>;
	_exec: (command: string) => Promise<ExecResult>;
	_hasStashed = false;
	directiveActions: Record<'clone' | 'remove', (dir: string, dest: string, action: Directive) => Promise<void> | void>;

	constructor(src: string, opts: DegitOptions = {}) {
		super();

		this.src = src;
		this.cache = opts.cache || false;
		this.force = opts.force || false;
		this.verbose = opts.verbose || false;
		this.proxy = process.env.https_proxy;

		this.repo = parse(src);
		this.mode = (opts.mode || this.repo.mode) as DegitMode;
		this._fetch = opts.fetch || fetch;
		this._exec = opts.exec || exec;

		if (!validModes.has(this.mode)) {
			throw new Error(`Valid modes are ${Array.from(validModes).join(', ')}`);
		}

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
				const d = degit(action.src || '', opts);

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
			remove: this.remove.bind(this)
		};
	}

	_getDirectives(dest: string): Directive[] | false {
		const directivesPath = path.resolve(dest, degitConfigName);
		const directives = (tryRequire(directivesPath, { clearCache: true }) || false) as
			| Directive[]
			| false;

		if (directives) {
			fs.unlinkSync(directivesPath);
		}

		return directives;
	}

	async clone(dest: string): Promise<void> {
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
			message: `cloned ${chalk.bold(repo.user + '/' + repo.name)}#${chalk.bold(
				repo.ref
			)}${dest !== '.' ? ` to ${dest}` : ''}`,
			repo,
			dest
		});

		const directives = this._getDirectives(dest);
		if (directives) {
			for (const d of directives) {
				await this.directiveActions[d.action](dir, dest, d);
			}
			if (this._hasStashed === true) {
				unstashFiles(dir, dest);
			}
		}
	}

	remove(dir: string, dest: string, action: Directive): void {
		let files = action.files;
		if (!Array.isArray(files)) {
			files = [files as string | undefined];
		}
		const removedFiles = (files as Array<string>)
			.filter(file => file)
			.map(file => {
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
					message: `action wants to remove ${chalk.bold(
						file
					)} but it does not exist`
				});
				return null;
			})
			.filter((entry): entry is string => !!entry);

		if (removedFiles.length > 0) {
			this._info({
				code: 'REMOVED',
				message: `removed: ${chalk.bold(
					removedFiles.map(d => chalk.bold(d)).join(', ')
				)}`
			});
		}
	}

	_checkDirIsEmpty(dir: string): void {
		try {
			const files = fs.readdirSync(dir);
			if (files.length > 0) {
				if (this.force) {
					this._info({
						code: 'DEST_NOT_EMPTY',
						message: `destination directory is not empty. Using options.force, continuing`
					});
				} else {
					throw new DegitError(
						`destination directory is not empty, aborting. Use options.force to override`,
						{
							code: 'DEST_NOT_EMPTY'
						}
					);
				}
			} else {
				this._verbose({
					code: 'DEST_IS_EMPTY',
					message: `destination directory is empty`
				});
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	_info(info: DegitEvent): void {
		this.emit('info', info);
	}

	_warn(info: DegitEvent): void {
		this.emit('warn', info);
	}

	_verbose(info: DegitEvent): void {
		if (this.verbose) this._info(info);
	}

	async _getHash(repo: Repo, cached: RepoCacheMap): Promise<string | undefined> {
		try {
			const refs = await this._fetchRefs(repo);
			if (repo.ref === 'HEAD') {
				return refs.find(ref => ref.type === 'HEAD')?.hash;
			}
			return this._selectRef(refs, repo.ref);
		} catch (err) {
			this._warn(err as DegitEvent);
			this._verbose((err as DegitEvent).original);

			return this._getHashFromCache(repo, cached);
		}
	}

	_getHashFromCache(repo: Repo, cached: RepoCacheMap): string | undefined {
		if (repo.ref in cached) {
			const hash = cached[repo.ref];
			this._info({
				code: 'USING_CACHE',
				message: `using cached commit hash ${hash}`
			});
			return hash;
		}
	}

	_selectRef(refs: RepoRef[], selector: string): string | undefined {
		for (const ref of refs) {
			if (ref.name === selector) {
				this._verbose({
					code: 'FOUND_MATCH',
					message: `found matching commit hash: ${ref.hash}`
				});
				return ref.hash;
			}
		}

		if (selector.length < 8) return undefined;

		for (const ref of refs) {
			if (ref.hash.startsWith(selector)) return ref.hash;
		}
	}

	async _cloneWithTar(dir: string, dest: string): Promise<void> {
		const { repo } = this;

		const cached = (tryRequire(path.join(dir, 'map.json')) || {}) as RepoCacheMap;

		const hash = this.cache
			? this._getHashFromCache(repo, cached)
			: await this._getHash(repo, cached);

		const subdir = repo.subdir ? `${repo.name}-${hash}${repo.subdir}` : null;

		if (!hash) {
			throw new DegitError(`could not find commit hash for ${repo.ref}`, {
				code: 'MISSING_REF',
				ref: repo.ref
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

					await this._fetch(url, file, this.proxy);
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
			message: `extracting ${
				subdir ? repo.subdir + ' from ' : ''
			}${file} to ${dest}`
		});

		mkdirp(dest);
		await untar(file, dest, subdir);
	}

	async _cloneWithGit(dir: string, dest: string): Promise<void> {
		await this._exec(`git clone ${this.repo.ssh} ${dest}`);
		await this._exec(`rm -rf ${path.resolve(dest, '.git')}`);
	}

	_fetchRefs(repo: Repo): Promise<RepoRef[]> {
		return fetchRefs(repo, this._exec);
	}
}

const supported = new Set(['github', 'gitlab', 'bitbucket', 'git.sr.ht']);

type RepoCacheMap = Record<string, string>;

function parse(src: string): Repo {
	const match = /^(?:(?:https:\/\/)?([^:/]+\.[^:/]+)\/|git@([^:/]+)[:/]|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:((?:\/[^/\s#]+)+))?(?:\/)?(?:#(.+))?/.exec(
		src
	);
	if (!match) {
		throw new DegitError(`could not parse ${src}`, {
			code: 'BAD_SRC'
		});
	}

	const site = (match[1] || match[2] || match[3] || 'github').replace(
		/\.(com|org)$/,
		''
	);
	if (!supported.has(site)) {
		throw new DegitError(
			`degit supports GitHub, GitLab, Sourcehut and BitBucket`,
			{
				code: 'UNSUPPORTED_HOST'
			}
		);
	}

	const user = match[4];
	const name = match[5].replace(/\.git$/, '');
	const subdir = match[6];
	const ref = match[7] || 'HEAD';

	const domain = `${site}.${
		site === 'bitbucket' ? 'org' : site === 'git.sr.ht' ? '' : 'com'
	}`;
	const url = `https://${domain}/${user}/${name}`;
	const ssh = `git@${domain}:${user}/${name}`;

	const mode = supported.has(site) ? 'tar' : 'git';

	return {
		site,
		user,
		name,
		ref,
		url,
		ssh,
		subdir,
		mode
	};
}

async function untar(file: string, dest: string, subdir: string | null = null): Promise<void> {
	return tar.extract(
		{
			file,
			strip: subdir ? subdir.split('/').length : 1,
			C: dest
		},
		subdir ? [subdir] : []
	);
}

async function fetchRefs(repo: Repo, runExec: (command: string) => Promise<ExecResult>): Promise<RepoRef[]> {
	try {
		const { stdout } = await runExec(`git ls-remote ${repo.url}`);

		return stdout
			.split('\n')
			.filter(Boolean)
			.map(row => {
				const [hash, ref = ''] = row.split('\t');

				if (ref === 'HEAD') {
					return {
						type: 'HEAD',
						hash
					};
				}

				const match = /refs\/(\w+)\/(.+)/.exec(ref);
				if (!match)
					throw new DegitError(`could not parse ${ref}`, {
						code: 'BAD_REF'
					});

				return {
					type:
						match[1] === 'heads'
							? 'branch'
							: match[1] === 'refs'
							? 'ref'
							: match[1],
					name: match[2],
					hash
				};
			});
	} catch (error) {
		throw new DegitError(`could not fetch remote ${repo.url}`, {
			code: 'COULD_NOT_FETCH',
			url: repo.url,
			original: error
		});
	}
}

function updateCache(dir: string, repo: Repo, hash: string, cached: RepoCacheMap): void {
	const logs = tryRequire(path.join(dir, 'access.json')) || {};
	(logs as Record<string, string>)[repo.ref] = new Date().toISOString();
	fs.writeFileSync(
		path.join(dir, 'access.json'),
		JSON.stringify(logs, null, '  ')
	);

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
			try {
				fs.unlinkSync(path.join(dir, `${oldHash}.tar.gz`));
			} catch (err) {
			}
		}
	}

	cached[repo.ref] = hash;
	fs.writeFileSync(
		path.join(dir, 'map.json'),
		JSON.stringify(cached, null, '  ')
	);
}
