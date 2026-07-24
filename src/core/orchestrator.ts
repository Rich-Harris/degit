import path from 'node:path';
import colors from 'yoctocolors';
import { parse, type Repo } from '../domain/repo.js';
import { applyDirectives } from '../operations/directives.js';
import { checkDirIsEmpty, getDirectives, removeFiles } from '../operations/filesystem.js';
import { cloneWithTar as cloneWithTarMode } from '../transports/tar/archive.js';
import {
	validModes,
	type ConstructorOptions,
	type Directive,
	type EventInfo,
	type FetchFn,
	type RemoveDirective,
	type ValidModes,
} from '../domain/types.js';
import type { GitClient } from '../domain/types.js';
import { base, fetch } from '../shared/utils.js';

type InfoListener = (info: EventInfo) => void;

function cloneSuccessMessage(user: string, name: string, ref: string, dest: string) {
	const destination = dest === '.' ? '' : ` to ${dest}`;
	return `cloned ${colors.bold(`${user}/${name}`)}#${colors.bold(ref)}${destination}`;
}

export class Degit {
	cache?: boolean;
	force?: boolean;
	mode: ValidModes;
	verbose?: boolean;
	proxy?: string;
	repo: Repo;
	fetch: FetchFn;
	git?: GitClient;
	gitClientPromise?: Promise<GitClient>;
	hasStashed: boolean;
	private infoListeners: InfoListener[];
	private warnListeners: InfoListener[];

	constructor(src: string, opts: ConstructorOptions = {}) {
		this.cache = opts.cache;
		this.force = opts.force;
		this.verbose = opts.verbose;
		this.proxy = process.env.https_proxy;
		this.repo = parse(src);
		this.mode = opts.mode ?? this.repo.mode;
		this.fetch = opts.fetch || fetch;
		this.git = opts.git;
		this.hasStashed = false;
		this.infoListeners = [];
		this.warnListeners = [];

		if (opts.mode && !validModes.has(opts.mode)) {
			throw new Error(`Valid modes are ${[...validModes].join(', ')}`);
		}
	}

	on(eventName: 'info' | 'warn', listener: InfoListener) {
		if (eventName === 'info') {
			this.infoListeners.push(listener);
		} else {
			this.warnListeners.push(listener);
		}
		return this;
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
		checkDirIsEmpty(dest, this.force, this.info.bind(this), this.verboseInfo.bind(this));
		await this.cloneToDestination(dest);
		this.info({
			code: 'SUCCESS',
			dest,
			message: cloneSuccessMessage(this.repo.user, this.repo.name, this.repo.ref, dest),
			repo: this.repo,
		});
		await this.runDirectives(dest);
	}

	remove(dest: string, action: RemoveDirective) {
		removeFiles(dest, action, this.info.bind(this), this.warn.bind(this));
	}

	info(info: EventInfo) {
		this.emitEvent('info', info);
	}

	warn(info: EventInfo) {
		this.emitEvent('warn', info);
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

	async cloneWithTar(dest: string): Promise<void> {
		await cloneWithTarMode(this, this.getRepoDir(), dest);
	}

	async cloneWithGit(dest: string, ref = this.repo.ref): Promise<void> {
		await (await this.getGitClient()).clone(this.repo, dest, ref, this.repo.transport);
	}

	shouldFallbackToGit(error: unknown): boolean {
		if (!error || typeof error !== 'object') {
			return false;
		}

		const code = (error as { code?: string }).code;
		return code === 'COULD_NOT_DOWNLOAD' || code === 'TAR_BAD_ARCHIVE';
	}

	private emitEvent(eventName: 'info' | 'warn', info: EventInfo) {
		const listeners = eventName === 'info' ? this.infoListeners : this.warnListeners;
		for (const listener of listeners) {
			listener(info);
		}
	}

	private getRepoDir() {
		return path.join(base, this.repo.site, this.repo.user, this.repo.name);
	}

	private async cloneToDestination(dest: string) {
		if (this.mode === 'git') {
			const hash = await this.getHash(this.repo, {});
			await this.cloneWithGit(dest, hash || this.repo.ref);
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
			await this.cloneWithGit(dest);
		}
	}

	private async runDirectives(dest: string) {
		const directives = this.getDirectives(dest);
		if (!directives) {
			return;
		}

		await applyDirectives(
			this,
			directives,
			this.getRepoDir(),
			dest,
			(src, opts) => new Degit(src, opts),
		);
	}
}
