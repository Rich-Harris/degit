/* eslint-disable max-lines */
/* oxlint-disable import/max-dependencies */
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import colors from 'yoctocolors';
import { resolveAlias } from '../aliases.js';
import { generateGitlabRepoCandidates, parse, type Repo } from '../domain/repo.js';
import { applyDirectives, type DirectiveContext } from '../operations/directives.js';
import {
	checkDirIsEmpty,
	copyRepoSubdir,
	getDirectives,
	keepFiles,
	removeFiles,
} from '../operations/filesystem.js';
import { cloneWithTar as cloneWithTarMode, type TarContext } from '../transports/tar/archive.js';
import {
	validModes,
	type Action,
	type ConstructorOptions,
	type Directive,
	type EventInfo,
	type FetchFn,
	type GitClient,
	type RemoveDirective,
	type ValidModes,
} from '../domain/types.js';
import { base, DegitError, fetch } from '../shared/utils.js';

function cloneSuccessMessage(user: string, name: string, ref: string, dest: string) {
	const destination = dest === '.' ? '' : ` to ${dest}`;
	return `cloned ${colors.bold(`${user}/${name}`)}#${colors.bold(ref)}${destination}`;
}

export class Degit extends EventEmitter {
	aliases: Record<string, string>;
	cache?: boolean;
	files?: string[];
	force?: boolean;
	mode: ValidModes;
	verbose?: boolean;
	proxy?: string;
	repo?: Repo;
	fetch: FetchFn;
	git?: GitClient;
	gitClientPromise?: Promise<GitClient>;
	private src?: string;

	constructor(src?: string, opts: ConstructorOptions = {}) {
		super();

		if (opts.mode && !validModes.has(opts.mode)) {
			throw new Error(`Valid modes are ${[...validModes].join(', ')}`);
		}

		this.aliases = opts.aliases ?? {};
		this.cache = opts.cache;
		this.files = opts.files;
		this.force = opts.force;
		this.verbose = opts.verbose;
		this.proxy = process.env.https_proxy;

		if (src === undefined) {
			this.mode = opts.mode ?? 'tar';
		} else {
			const resolved = resolveAlias(this.aliases, src) ?? src;
			if (typeof resolved !== 'string' || resolved === '') {
				throw new DegitError('source must not be empty', { code: 'BAD_SRC' });
			}
			this.src = resolved;
			this.repo = parse(resolved);
			this.mode = opts.mode ?? this.repo.mode;
			this.repo = { ...this.repo, mode: this.mode };
		}

		this.fetch = opts.fetch || fetch;
		this.git = opts.git;
		this.info = this.info.bind(this);
		this.warn = this.warn.bind(this);
		this.verboseInfo = this.verboseInfo.bind(this);
	}
	getGitClient(): Promise<GitClient> {
		if (this.git) {
			return Promise.resolve(this.git);
		}
		if (!this.gitClientPromise) {
			this.gitClientPromise = import('../transports/git/client.js').then(
				({ defaultGitClient }) => {
					this.git = defaultGitClient;
					return defaultGitClient;
				},
			);
		}
		return this.gitClientPromise;
	}
	getDirectives(dest: string): Directive[] | false {
		return getDirectives(dest);
	}
	async clone(dest: string): Promise<void> {
		if (!this.repo) {
			throw new DegitError('clone() requires a source', { code: 'MISSING_SRC' });
		}

		checkDirIsEmpty(dest, this.force, this.info, this.verboseInfo);
		await this.cloneToDestination(dest);
		keepFiles(dest, this.files, this.warn);
		this.info({
			code: 'SUCCESS',
			dest,
			message: cloneSuccessMessage(this.repo.user, this.repo.name, this.repo.ref, dest),
			repo: this.repo,
		});
		await this.runDirectives(dest);
	}
	remove(dest: string, action: RemoveDirective) {
		removeFiles(dest, action, this.info, this.warn);
	}
	info(info: EventInfo) {
		this.emit('info', info);
	}
	warn(info: EventInfo) {
		this.emit('warn', info);
	}
	verboseInfo(info: EventInfo) {
		if (this.verbose) {
			this.info(info);
		}
	}
	async getHash(repo: Repo, cached: Record<string, string>): Promise<string | undefined> {
		try {
			const refs = await (await this.getGitClient()).fetchRefs(repo);
			return repo.ref === 'HEAD' ? this.selectHead(refs) : this.selectRef(refs, repo.ref);
		} catch (error) {
			this.warn(error as EventInfo);
			const original = (error as { original?: EventInfo }).original;
			if (original) {
				this.verboseInfo(original);
			}
			return this.getHashFromCache(repo, cached);
		}
	}
	getHashFromCache(repo: Repo, cached: Record<string, string>): string | undefined {
		if (repo.ref in cached) {
			const hash = cached[repo.ref];
			this.info({
				code: 'USING_CACHE',
				message: `using cached commit hash ${hash}`,
			});
			return hash;
		}
	}
	selectRef(
		refs: Array<{ hash: string; name?: string; type?: string }>,
		selector: string,
	): string | null | undefined {
		for (const ref of refs) {
			if (ref.name === selector) {
				this.verboseInfo({
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
	selectHead(refs: Array<{ hash: string; name?: string; type?: string }>) {
		const head = refs.find((ref) => ref.type === 'HEAD');
		if (head) {
			return head.hash;
		}
		for (const branchName of ['main', 'master']) {
			const branch = refs.find((ref) => {
				if (ref.type === 'HEAD' || !ref.name) {
					return false;
				}
				return ref.name === branchName || ref.name.endsWith(`/${branchName}`);
			});
			if (branch) {
				return branch.hash;
			}
		}
		return refs.find((ref) => ref.type === 'branch' && ref.hash)?.hash;
	}
	private getRepo(): Repo {
		if (!this.repo) {
			throw new DegitError('operation requires a source', { code: 'MISSING_SRC' });
		}
		return this.repo;
	}
	async cloneWithTar(dest: string): Promise<void> {
		const repo = this.getRepo();
		const context: TarContext = {
			cache: this.cache,
			cloneWithGit: (d, ref) => this.cloneWithGit(d, ref),
			fetch: this.fetch,
			getHash: (childRepo, cached) => this.getHash(childRepo, cached),
			getHashFromCache: (childRepo, cached) => this.getHashFromCache(childRepo, cached),
			proxy: this.proxy,
			repo,
			verboseInfo: this.verboseInfo,
			warn: this.warn,
		};
		await cloneWithTarMode(context, this.getRepoDir(), dest);
	}
	async cloneWithGit(dest: string, ref?: string): Promise<void> {
		const repo = this.getRepo();
		await (await this.getGitClient()).clone(repo, dest, ref ?? repo.ref, repo.transport);
	}
	async cloneGitToDestination(dest: string, ref?: string): Promise<void> {
		const repo = this.getRepo();
		if (repo.subdir) {
			const tmp = await mkdtemp('degit-git-');
			try {
				await this.cloneWithGit(tmp, ref);
				copyRepoSubdir(tmp, dest, repo.subdir);
			} finally {
				await rm(tmp, { force: true, recursive: true });
			}
			return;
		}
		await this.cloneWithGit(dest, ref);
	}
	shouldFallbackToGit(error: unknown): boolean {
		if (!error || typeof error !== 'object') {
			return false;
		}
		const code = (error as { code?: string }).code;
		return code === 'COULD_NOT_DOWNLOAD' && !this.cache;
	}
	private getRepoDir() {
		const repo = this.getRepo();
		return path.join(base, repo.site, repo.user, repo.name);
	}
	private async doCloneToDestination(dest: string) {
		const repo = this.getRepo();
		if (this.mode === 'git') {
			const hash = await this.getHash(repo, {});
			await this.cloneGitToDestination(dest, hash || repo.ref);
			return;
		}
		try {
			await this.cloneWithTar(dest);
		} catch (error) {
			if (!this.shouldFallbackToGit(error)) {
				throw error;
			}
			this.warn({
				message: `tar snapshot download or extraction failed; falling back to git clone`,
			});
			await this.cloneGitToDestination(dest);
		}
	}
	private async cloneToDestination(dest: string) {
		const repo = this.getRepo();
		if (repo.site === 'gitlab') {
			await this.tryGitlabProject(generateGitlabRepoCandidates(this.src!, repo), dest, repo);
		} else {
			await this.doCloneToDestination(dest);
		}
	}
	private async tryGitlabProject(
		candidates: Repo[],
		dest: string,
		originalRepo: Repo,
		firstError?: Error,
	): Promise<void> {
		const [repo, ...rest] = candidates;
		if (repo) {
			this.repo = repo;
			this.verboseInfo({ message: `trying GitLab project path ${repo.url}` });
			try {
				await this.doCloneToDestination(dest);
			} catch (error) {
				this.repo = originalRepo;
				const code = (error as { code?: string }).code;
				const retryable =
					error instanceof DegitError &&
					(code === 'MISSING_REF' || code === 'COULD_NOT_FETCH');
				if (retryable) {
					this.warn({
						message: `GitLab project path ${repo.url} not found; trying next`,
					});
					await this.tryGitlabProject(
						rest,
						dest,
						originalRepo,
						firstError ?? (error as Error),
					);
				} else {
					throw error;
				}
			}
		} else {
			throw (
				firstError ??
				new DegitError('could not find a valid GitLab project path', {
					code: 'COULD_NOT_FETCH',
				})
			);
		}
	}
	private async runDirectives(dest: string) {
		const directives = this.getDirectives(dest);
		if (directives) {
			await this.doActions(directives, dest);
		}
	}
	private async getActionsStagingDir(): Promise<string> {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		await mkdir(base, { recursive: true });
		return mkdtemp(path.join(base, 'actions-'));
	}

	async doActions(directives: Action[], dest: string): Promise<void> {
		if (!Array.isArray(directives)) {
			throw new DegitError('directives must be an array', { code: 'BAD_DIRECTIVES' });
		}
		const context: DirectiveContext = {
			aliases: this.aliases,
			cache: this.cache,
			fetch: this.fetch,
			getGitClient: () => this.getGitClient(),
			getStagingDir: async () => (context.stagingDir ??= await this.getActionsStagingDir()),
			hasStashed: false,
			info: this.info,
			verbose: this.verbose,
			warn: this.warn,
		};
		try {
			await applyDirectives(context, directives, dest, (src, opts) => new Degit(src, opts));
		} finally {
			if (context.stagingDir) {
				if (context.hasStashed) {
					this.warn({
						message: `actions staging left for recovery: ${context.stagingDir}`,
						recoveryPath: context.stagingDir,
					});
				} else {
					await rm(context.stagingDir, { force: true, recursive: true }).catch((error) =>
						this.warn({
							message: `could not remove actions staging: ${context.stagingDir}`,
							original: error,
						}),
					);
				}
			}
		}
	}
}

export interface Degit {
	on(eventName: 'info' | 'warn', listener: (info: EventInfo) => void): this;
}
