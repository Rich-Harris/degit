import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import EventEmitter from 'node:events';
import colors from 'yoctocolors';
import {
	DegitError,
	base,
	degitConfigName,
	fetch,
	mkdirp,
	stashFiles,
	tryRequire,
	unstashFiles,
} from './utils.js';
import { getProvider, parse, type Repo } from './repo.js';
import type { GitClient } from './git-client.js';

const validModes = new Set(['tar', 'git']);

type FetchFn = (url: string, dest: string, proxy?: string) => Promise<void>;

type ConstructorOptions = {
	cache?: boolean;
	fetch?: FetchFn;
	force?: boolean;
	git?: GitClient;
	mode?: 'tar' | 'git';
	platform?: NodeJS.Platform;
	verbose?: boolean;
};

type EventInfo = {
	code?: InfoCode | DegitErrorCode;
	dest?: string;
	message: string;
	repo?: Repo;
	url?: string;
	original?: unknown;
	ref?: string;
};

type Directive =
	| {
			action: 'clone';
			cache?: boolean;
			src: string;
			verbose?: boolean;
	  }
	| {
			action: 'remove';
			files: string | string[];
	  };

type CloneDirective = Extract<Directive, { action: 'clone' }>;
type RemoveDirective = Extract<Directive, { action: 'remove' }>;

type DirectiveActions = {
	clone: (dir: string, dest: string, action: CloneDirective) => Promise<void>;
	remove: (dest: string, action: RemoveDirective) => void;
};

export type Options = ConstructorOptions;
export type ValidModes = 'tar' | 'git';
export type InfoCode =
	| 'SUCCESS'
	| 'FILE_DOES_NOT_EXIST'
	| 'FILE_OUTSIDE_DEST'
	| 'REMOVED'
	| 'DEST_NOT_EMPTY'
	| 'DEST_IS_EMPTY'
	| 'USING_CACHE'
	| 'FOUND_MATCH'
	| 'FILE_EXISTS'
	| 'PROXY'
	| 'DOWNLOADING'
	| 'EXTRACTING';
export type DegitErrorCode =
	| 'DEST_NOT_EMPTY'
	| 'MISSING_REF'
	| 'COULD_NOT_DOWNLOAD'
	| 'BAD_SRC'
	| 'UNSUPPORTED_HOST'
	| 'BAD_REF'
	| 'COULD_NOT_FETCH';
export type Info = EventInfo;
export type Action = Directive;
export type DegitAction = CloneDirective;
export type RemoveAction = RemoveDirective;

export default function degit(src: string, opts: ConstructorOptions = {}) {
	return new Degit(src, opts);
}

class Degit extends EventEmitter {
	cache?: boolean;
	force?: boolean;
	mode: 'tar' | 'git';
	verbose?: boolean;
	proxy?: string;
	repo: Repo;
	platform: NodeJS.Platform;
	_fetch: FetchFn;
	_git?: GitClient;
	_gitClientPromise?: Promise<GitClient>;
	_hasStashed: boolean;
	directiveActions: DirectiveActions;

	constructor(src: string, opts: ConstructorOptions = {}) {
		super();

		this.cache = opts.cache;
		this.force = opts.force;
		this.verbose = opts.verbose;
		this.proxy = process.env.https_proxy; // TODO allow setting via --proxy

		this.repo = parse(src);
		this.mode = opts.mode ?? this.repo.mode;
		this.platform = opts.platform ?? process.platform;
		this._fetch = opts.fetch || fetch;
		this._git = opts.git;

		if (opts.mode && !validModes.has(opts.mode)) {
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
					fetch: this._fetch,
					git: await this._getGitClient(),
				};
				const d = degit(action.src, opts);

				d.on('info', (event) => {
					console.log(colors.cyan(`> ${event.message.replace('options.', '--')}`));
				});

				d.on('warn', (event) => {
					console.warn(colors.magenta(`! ${event.message.replace('options.', '--')}`));
				});

				await d.clone(dest).catch((error) => {
					console.error(colors.red(`! ${error.message}`));
					process.exit(1);
				});
			},
			remove: (dest, action) => this.remove(dest, action),
		};
	}

	async _getGitClient(): Promise<GitClient> {
		if (this._git) {
			return this._git;
		}

		if (!this._gitClientPromise) {
			this._gitClientPromise = import('./git-client.js').then(({ defaultGitClient }) => {
				this._git = defaultGitClient;
				return defaultGitClient;
			});
		}

		return this._gitClientPromise;
	}

	_getDirectives(dest: string): Directive[] | false {
		const directivesPath = path.resolve(dest, degitConfigName);
		const directives = tryRequire(directivesPath, { clearCache: true }) || false;
		if (directives) {
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.unlinkSync(directivesPath);
		}

		return directives;
	}

	async clone(dest: string): Promise<void> {
		this._checkDirIsEmpty(dest);

		const { repo } = this;

		if (this.mode === 'git') {
			const hash = await this._getHash(repo, {});
			await this._cloneWithGit(dest, hash || repo.ref);
			this._info({
				code: 'SUCCESS',
				dest,
				message: `cloned ${colors.bold(repo.user + '/' + repo.name)}#${colors.bold(repo.ref)}${dest !== '.' ? ` to ${dest}` : ''}`,
				repo,
			});
			return;
		}

		const dir = path.join(base, repo.site, repo.user, repo.name);

		try {
			await this._cloneWithTar(dir, dest);
		} catch (error) {
			if (this._shouldFallbackToGit(error)) {
				this._warn({
					message: `tar snapshot download or extraction failed; falling back to git clone`,
				});
				await this._cloneWithGit(dest);
			} else {
				throw error;
			}
		}

		this._info({
			code: 'SUCCESS',
			dest,
			message: `cloned ${colors.bold(repo.user + '/' + repo.name)}#${colors.bold(repo.ref)}${dest !== '.' ? ` to ${dest}` : ''}`,
			repo,
		});

		const directives = this._getDirectives(dest);
		if (directives) {
			await directives.reduce(async (previous, directive) => {
				await previous;

				// TODO, can this be a loop with an index to pass for better error messages?
				if (directive.action === 'clone') {
					await this.directiveActions.clone(dir, dest, directive);
				} else {
					await this.directiveActions.remove(dest, directive);
				}
			}, Promise.resolve());
			if (this._hasStashed === true) {
				unstashFiles(dir, dest);
			}
		}
	}

	/* eslint-disable security/detect-non-literal-fs-filename */
	remove(dest: string, action: RemoveDirective) {
		let { files } = action;
		if (!Array.isArray(files)) {
			files = [files];
		}
		const root = path.resolve(dest);
		const removedFiles = files
			.map((file) => {
				const filePath = path.resolve(root, file);
				const relativePath = path.relative(root, filePath);
				if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
					this._warn({
						code: 'FILE_OUTSIDE_DEST',
						message: `action wants to remove ${colors.bold(file)} but it is outside the destination, skipping`,
					});
					return null;
				}
				if (fs.existsSync(filePath)) {
					const isDir = fs.lstatSync(filePath).isDirectory();
					if (isDir) {
						fs.rmSync(filePath, { force: true, recursive: true });
						return `${file}/`;
					}
					fs.unlinkSync(filePath);
					return file;
				}
				this._warn({
					code: 'FILE_DOES_NOT_EXIST',
					message: `action wants to remove ${colors.bold(file)} but it does not exist`,
				});
				return null;
			})
			.filter((d) => d);

		if (removedFiles.length > 0) {
			this._info({
				code: 'REMOVED',
				message: `removed: ${colors.bold(removedFiles.map((d) => colors.bold(d)).join(', '))}`,
			});
		}
	}

	_checkDirIsEmpty(dir: string) {
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
	_info(info: EventInfo) {
		this.emit('info', info);
	}

	_warn(info: EventInfo) {
		this.emit('warn', info);
	}

	_verbose(info: EventInfo) {
		if (this.verbose) {
			this._info(info);
		}
	}

	async _getHash(repo: Repo, cached: Record<string, string>): Promise<string | undefined> {
		try {
			const refs = await (await this._getGitClient()).fetchRefs(repo);
			return repo.ref === 'HEAD' ? this._selectHead(refs) : this._selectRef(refs, repo.ref);
		} catch (error) {
			this._warn(error);
			this._verbose(error.original);

			return this._getHashFromCache(repo, cached);
		}
	}

	_getHashFromCache(repo: Repo, cached: Record<string, string>): string | undefined {
		if (repo.ref in cached) {
			const hash = cached[repo.ref];
			this._info({
				code: 'USING_CACHE',
				message: `using cached commit hash ${hash}`,
			});
			return hash;
		}
	}

	_selectRef(
		refs: Array<{ hash: string; name?: string; type?: string }>,
		selector: string,
	): string | null | undefined {
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

	_selectHead(refs: Array<{ hash: string; name?: string; type?: string }>) {
		const head = refs.find((ref) => ref.type === 'HEAD');
		if (head) {
			return head.hash;
		}

		for (const branchName of ['main', 'master']) {
			const branch = refs.find((ref) => {
				if (ref.type === 'HEAD') return false;
				if (!ref.name) return false;
				return ref.name === branchName || ref.name.endsWith(`/${branchName}`);
			});
			if (branch) {
				return branch.hash;
			}
		}

		return refs.find((ref) => ref.type === 'branch' && ref.hash)?.hash;
	}

	async _cloneWithTar(dir: string, dest: string): Promise<void> {
		const { repo } = this;

		const cached = (tryRequire(path.join(dir, 'map.json')) || {}) as Record<string, string>;

		const hash = this.cache
			? this._getHashFromCache(repo, cached)
			: await this._getHash(repo, cached);

		const subdir = repo.subdir ? `${repo.name}-${hash}${repo.subdir}` : null;

		if (!hash) {
			if (repo.transport === 'ssh') {
				this._warn({
					message: `tar lookup failed; falling back to git clone`,
				});
				await this._cloneWithGit(dest);
				return;
			}

			// TODO 'did you mean...?'
			throw new DegitError(`could not find commit hash for ${repo.ref}`, {
				code: 'MISSING_REF',
				ref: repo.ref,
			});
		}

		const file = `${dir}/${hash}.tar.gz`;
		const url = getProvider(repo.site).archiveUrl(repo, hash);
		mkdirp(dir);
		const extractedDir = fs.mkdtempSync(path.join(dir, 'extract-'));
		let shouldFallbackToGit = false;

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

			this._verbose({
				code: 'EXTRACTING',
				message: `extracting ${subdir ? `${repo.subdir} from ` : ''}${file} to ${extractedDir}`,
			});

			await this._untarWithRetry(file, extractedDir, subdir, url);
			shouldFallbackToGit = this._hasGitLfsPointers(extractedDir);

			if (!shouldFallbackToGit) {
				mkdirp(dest);
				this._copyExtractedFiles(extractedDir, dest);
			}
		} catch (error) {
			throw new DegitError(`could not download ${url}`, {
				code: 'COULD_NOT_DOWNLOAD',
				url,
				original: error,
			});
		} finally {
			fs.rmSync(extractedDir, { force: true, recursive: true });
		}

		if (shouldFallbackToGit) {
			this._warn({
				message: `git lfs pointer detected in tar snapshot; falling back to git clone`,
			});
			await this._cloneWithGit(dest);
		}

		updateCache(dir, repo, hash, cached);
	}

	async _cloneWithGit(dest: string, ref = this.repo.ref): Promise<void> {
		await (await this._getGitClient()).clone(this.repo, dest, ref, this.repo.transport);
	}

	_shouldFallbackToGit(error: unknown): boolean {
		if (!error || typeof error !== 'object') {
			return false;
		}

		const code = (error as { code?: string }).code;
		return code === 'COULD_NOT_DOWNLOAD' || code === 'TAR_BAD_ARCHIVE';
	}

	async _untarWithRetry(file: string, dest: string, subdir: string | null, url: string) {
		try {
			await untar(file, dest, subdir);
		} catch (error) {
			if (error.code !== 'TAR_BAD_ARCHIVE') {
				throw error;
			}

			try {
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				fs.unlinkSync(file);
			} catch {
				// Ignore cleanup failures and let the refetch retry decide the outcome.
			}

			await this._fetch(url, file, this.proxy);
			await untar(file, dest, subdir);
		}
	}

	_hasGitLfsPointers(dir: string): boolean {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (this._hasGitLfsPointers(entryPath)) {
					return true;
				}
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			// eslint-disable-next-line security/detect-non-literal-fs-filename
			const contents = fs.readFileSync(entryPath, 'utf8');
			if (
				/^version https:\/\/git-lfs\.github\.com\/spec\/v1$/m.test(contents) &&
				/^oid sha256:[0-9a-f]{64}$/m.test(contents) &&
				/^size \d+$/m.test(contents)
			) {
				return true;
			}
		}

		return false;
	}

	_copyExtractedFiles(sourceDir: string, destDir: string) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

		for (const entry of entries) {
			const sourcePath = path.join(sourceDir, entry.name);
			const destinationPath = path.join(destDir, entry.name);
			fs.cpSync(sourcePath, destinationPath, { recursive: true });
		}
	}
}

async function untar(file: string, dest: string, subdir: string | null = null): Promise<void> {
	return tar.extract(
		{
			C: dest,
			file,
			strip: subdir ? subdir.split('/').length : 1,
		},
		subdir ? [subdir] : [],
	);
}
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-possible-timing-attacks, security/detect-object-injection */
function updateCache(dir: string, repo: Repo, hash: string, cached: Record<string, string>) {
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
