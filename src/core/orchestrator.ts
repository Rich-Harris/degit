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

function cloneSuccessMessage(user: string, name: string, ref: string, dest: string): string {
	const destination = dest === '.' ? '' : ` to ${dest}`;
	return `cloned ${colors.bold(`${user}/${name}`)}#${colors.bold(ref)}${destination}`;
}

export class Degit {
	public cache?: boolean;
	public force?: boolean;
	public mode: ValidModes;
	public verbose?: boolean;
	public proxy?: string;
	public repo: Repo;
	public platform: NodeJS.Platform;
	public fetch: FetchFn;
	public git?: GitClient;
	public gitClientPromise?: Promise<GitClient>;
	public hasStashed: boolean;
	private infoListeners: InfoListener[];
	private warnListeners: InfoListener[];

	public constructor(src: string, opts: ConstructorOptions = {}) {
		this.cache = opts.cache;
		this.force = opts.force;
		this.verbose = opts.verbose;
		this.proxy = process.env.https_proxy;
		this.repo = parse(src);
		this.mode = opts.mode ?? this.repo.mode;
		this.platform = opts.platform ?? process.platform;
		this.fetch = opts.fetch || fetch;
		this.git = opts.git;
		this.hasStashed = false;
		this.infoListeners = [];
		this.warnListeners = [];

		if (opts.mode && !validModes.has(opts.mode)) {
			throw new Error(`Valid modes are ${Array.from(validModes).join(', ')}`);
		}
	}

	public on(eventName: 'info' | 'warn', listener: InfoListener): this {
		if (eventName === 'info') {
			this.infoListeners.push(listener);
		} else {
			this.warnListeners.push(listener);
		}
		return this;
	}

	public getGitClient(): Promise<GitClient> {
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

	public getDirectives(dest: string): Directive[] | false {
		return getDirectives(dest);
	}

	public clone(dest: string): Promise<void> {
		checkDirIsEmpty(dest, this.force, this.info.bind(this), this.verboseInfo.bind(this));
		return this.cloneToDestination(dest).then(() => {
			this.info({
				code: 'SUCCESS',
				dest,
				message: cloneSuccessMessage(this.repo.user, this.repo.name, this.repo.ref, dest),
				repo: this.repo,
			});
			return this.runDirectives(dest);
		});
	}

	public remove(dest: string, action: RemoveDirective): void {
		removeFiles(dest, action, this.info.bind(this), this.warn.bind(this));
	}

	public info(info: EventInfo): void {
		this.emitEvent('info', info);
	}

	public warn(info: EventInfo): void {
		this.emitEvent('warn', info);
	}

	public verboseInfo(info: EventInfo): void {
		if (this.verbose) {
			this.info(info);
		}
	}

	public getHash(repo: Repo, cached: Record<string, string>): Promise<string | undefined> {
		return this.getGitClient()
			.then((gitClient) => gitClient.fetchRefs(repo))
			.then((refs) =>
				repo.ref === 'HEAD' ? this.selectHead(refs) : this.selectRef(refs, repo.ref),
			)
			.catch((error) => {
				this.warn(error as EventInfo);
				const original = (error as { original?: EventInfo }).original;
				if (original) {
					this.verboseInfo(original);
				}

				return this.getHashFromCache(repo, cached);
			});
	}

	public getHashFromCache(repo: Repo, cached: Record<string, string>): string | undefined {
		if (repo.ref in cached) {
			const hash = cached[repo.ref];
			this.info({
				code: 'USING_CACHE',
				message: `using cached commit hash ${hash}`,
			});
			return hash;
		}
	}

	public selectRef(
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

	public selectHead(
		refs: Array<{ hash: string; name?: string; type?: string }>,
	): string | undefined {
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

		const branch = refs.find((ref) => ref.type === 'branch' && ref.hash);
		return branch ? branch.hash : undefined;
	}

	public cloneWithTar(dest: string): Promise<void> {
		return cloneWithTarMode(this, this.getRepoDir(), dest);
	}

	public cloneWithGit(dest: string, ref = this.repo.ref): Promise<void> {
		return this.getGitClient().then((gitClient) =>
			gitClient.clone(this.repo, dest, ref, this.repo.transport),
		);
	}

	public shouldFallbackToGit(error: unknown): boolean {
		if (!error || typeof error !== 'object') {
			return false;
		}

		const code = (error as { code?: string }).code;
		return code === 'COULD_NOT_DOWNLOAD' || code === 'TAR_BAD_ARCHIVE';
	}

	private emitEvent(eventName: 'info' | 'warn', info: EventInfo): void {
		const listeners = eventName === 'info' ? this.infoListeners : this.warnListeners;
		for (const listener of listeners) {
			listener(info);
		}
	}

	private getRepoDir(): string {
		return path.join(base, this.repo.site, this.repo.user, this.repo.name);
	}

	private cloneToDestination(dest: string): Promise<void> {
		if (this.mode === 'git') {
			return this.getHash(this.repo, {}).then((hash) =>
				this.cloneWithGit(dest, hash || this.repo.ref),
			);
		}

		return this.cloneWithTar(dest).catch((error) => {
			if (!this.shouldFallbackToGit(error)) {
				throw error;
			}

			this.warn({
				message: `tar snapshot download or extraction failed; falling back to git clone`,
			});
			return this.cloneWithGit(dest);
		});
	}

	private runDirectives(dest: string): Promise<void> | undefined {
		const directives = this.getDirectives(dest);
		if (!directives) {
			return;
		}

		return applyDirectives(
			this,
			directives,
			this.getRepoDir(),
			dest,
			(src, opts) => new Degit(src, opts),
		);
	}
}
