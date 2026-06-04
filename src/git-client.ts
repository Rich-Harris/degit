import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { DegitError } from './utils.js';
import type { Repo } from './repo.js';

type Ref = {
	hash: string;
	name?: string;
	type?: string;
};

type IsomorphicGitHttp = typeof import('isomorphic-git/http/node');

type GitPlan = {
	cloneRef?: string;
	checkoutRef?: string;
	singleBranch?: boolean;
};

const execFile = promisify(execFileCallback);

const isomorphicGitHttp = http as IsomorphicGitHttp['default'];

function getGitUrl(repo: Repo, transport: Repo['transport'] = repo.transport) {
	return transport === 'ssh' ? repo.ssh : repo.url;
}

function isCommitHash(ref: string) {
	return /^[0-9a-f]{7,40}$/i.test(ref);
}

function normalizeGitRef(ref: string) {
	if (ref.startsWith('refs/heads/')) {
		return ref.slice('refs/heads/'.length);
	}

	if (ref.startsWith('refs/tags/')) {
		return ref.slice('refs/tags/'.length);
	}

	return ref;
}

function isMissingSshKeyError(error: unknown) {
	if (!error || typeof error !== 'object') {
		return false;
	}

	const code = (error as { code?: string }).code || '';
	const message = (error as { message?: string }).message || '';
	const normalized = `${code} ${message}`.toLowerCase();

	return (
		normalized.includes('ssh') &&
		(normalized.includes('agent') ||
			normalized.includes('key') ||
			normalized.includes('identity') ||
			normalized.includes('publickey') ||
			normalized.includes('authentication'))
	);
}

function isMissingGitBinaryError(error: unknown) {
	if (!error || typeof error !== 'object') {
		return false;
	}

	return (error as { code?: string }).code === 'ENOENT';
}

function createSshError(repo: Repo, error: unknown) {
	return new DegitError(
		`SSH authentication failed for ${repo.url}. Start ssh-agent and add a key, or use the HTTPS source instead.`,
		{
			code: 'SSH_NO_KEY',
			original: error,
			url: repo.url,
		},
	);
}

function createMissingGitError(repo: Repo, error: unknown) {
	return new DegitError(`git is not installed. Install git to clone ${repo.url}.`, {
		code: 'GIT_NOT_FOUND',
		original: error,
		url: repo.url,
	});
}
export type GitClient = {
	fetchRefs(repo: Repo): Promise<Ref[]>;
	clone(repo: Repo, dest: string, ref?: string, transport?: Repo['transport']): Promise<void>;
};

function mapRemoteRef(refName: string, refHash: string): Ref {
	if (refName === 'HEAD') {
		return {
			hash: refHash,
			type: 'HEAD',
		};
	}

	const match = /refs\/([^/]+)\/(.+)/.exec(refName);
	if (!match) {
		throw new DegitError(`could not parse ${refName}`, {
			code: 'BAD_REF',
		});
	}

	return {
		hash: refHash,
		name: match[2],
		type: match[1] === 'heads' ? 'branch' : match[1] === 'refs' ? 'ref' : match[1],
	};
}

function mapServerRef(serverRef: any): Ref | undefined {
	const refName = String(serverRef.ref || serverRef.name || '');
	const refHash = String(serverRef.oid || serverRef.hash || '');

	if (!refName || !refHash) {
		return undefined;
	}

	return mapRemoteRef(refName, refHash);
}

function dedupeRefs(refs: Ref[]): Ref[] {
	const seen = new Set<string>();
	return refs.filter((ref) => {
		const key = ref.type === 'HEAD' ? 'HEAD' : ref.name ? `${ref.type}:${ref.name}` : ref.hash;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function parseGitLsRemoteOutput(output: string): Ref[] {
	const refs = new Map<string, Ref>();
	const symrefs = new Map<string, string>();

	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const symrefMatch = /^ref:\s+(.+)\t(.+)$/.exec(line);
		if (symrefMatch) {
			symrefs.set(symrefMatch[2], symrefMatch[1]);
			continue;
		}

		const tabIndex = line.indexOf('\t');
		if (tabIndex === -1) continue;

		const hash = line.slice(0, tabIndex);
		const refName = line.slice(tabIndex + 1);
		refs.set(refName, mapRemoteRef(refName, hash));
	}

	for (const [name, target] of symrefs) {
		if (name !== 'HEAD') continue;

		const targetRef = refs.get(target);
		if (targetRef) {
			refs.set('HEAD', {
				hash: targetRef.hash,
				type: 'HEAD',
			});
		}
	}

	return dedupeRefs([...refs.values()]);
}

function getGitClonePlan(ref: string): GitPlan {
	const normalizedRef = normalizeGitRef(ref);
	if (normalizedRef === 'HEAD') {
		return {};
	}

	if (isCommitHash(normalizedRef)) {
		return {
			checkoutRef: normalizedRef,
		};
	}

	if (normalizedRef.startsWith('refs/heads/')) {
		return {
			cloneRef: normalizedRef.slice('refs/heads/'.length),
			singleBranch: true,
		};
	}

	if (normalizedRef.startsWith('refs/tags/')) {
		return {
			cloneRef: normalizedRef.slice('refs/tags/'.length),
			singleBranch: true,
		};
	}

	if (normalizedRef.startsWith('refs/')) {
		return {
			checkoutRef: normalizedRef,
		};
	}

	return {
		cloneRef: normalizedRef,
		checkoutRef: normalizedRef,
		singleBranch: true,
	};
}

async function fetchRefsWithGitCli(repo: Repo) {
	const { stdout } = await execFile('git', ['ls-remote', '--symref', getGitUrl(repo)]);
	return parseGitLsRemoteOutput(stdout);
}

async function fetchRefsWithIsomorphicGit(repo: Repo) {
	const url = getGitUrl(repo);
	const normalizeRefs = (
		refs: Array<{ hash?: string; oid?: string; ref?: string; name?: string }>,
	) => dedupeRefs(refs.map(mapServerRef).filter((ref): ref is Ref => Boolean(ref)));

	try {
		const refs = await git.listServerRefs({
			http: isomorphicGitHttp,
			peelTags: true,
			symrefs: true,
			url,
		});
		const normalizedRefs = normalizeRefs(refs);

		if (normalizedRefs.length > 0) {
			return normalizedRefs;
		}
	} catch {
		// Fall through to the protocol v1 capability path for hosts that reject
		// protocol v2 discovery or omit refs from the v2 response.
	}

	try {
		const remote = await git.getRemoteInfo2({
			http: isomorphicGitHttp,
			protocolVersion: 1,
			url,
		});

		const normalizedRefs = normalizeRefs(remote.refs || []);
		if (normalizedRefs.length > 0) {
			return normalizedRefs;
		}
	} catch {
		// Fall back to the git CLI for providers that reject protocol v1 discovery
		// or present an HTTPS trust chain that is not usable through isomorphic-git.
	}

	return fetchRefsWithGitCli(repo);
}

async function cloneWithGitCli(
	repo: Repo,
	dest: string,
	ref: string | undefined,
	transport: Repo['transport'] = repo.transport,
) {
	const plan = getGitClonePlan(ref || repo.ref);
	const cloneArgs = ['clone', '--depth', '1'];

	if (plan.cloneRef) {
		cloneArgs.push('--branch', plan.cloneRef);
		if (plan.singleBranch) {
			cloneArgs.push('--single-branch');
		}
	}

	cloneArgs.push(getGitUrl(repo, transport), dest);
	await execFile('git', cloneArgs);

	if (plan.checkoutRef) {
		await execFile('git', ['-C', dest, 'checkout', '--force', plan.checkoutRef]);
	}

	fs.rmSync(path.join(dest, '.git'), { force: true, recursive: true });
}

async function cloneWithIsomorphicGit(
	repo: Repo,
	dest: string,
	ref: string | undefined,
	transport: Repo['transport'] = repo.transport,
) {
	const url = getGitUrl(repo, transport);
	const plan = getGitClonePlan(ref || repo.ref);
	const cloneRef = plan.cloneRef && !isCommitHash(plan.cloneRef) ? plan.cloneRef : undefined;
	const checkoutRef =
		plan.checkoutRef || (cloneRef ? undefined : normalizeGitRef(ref || repo.ref));

	try {
		await git.clone({
			fs,
			http: isomorphicGitHttp,
			dir: dest,
			depth: 1,
			ref: cloneRef,
			singleBranch: Boolean(cloneRef),
			url,
		});
	} catch (error) {
		if (transport !== 'https') {
			throw error;
		}

		await cloneWithGitCli(repo, dest, ref, transport);
		return;
	}

	if (checkoutRef && checkoutRef !== 'HEAD') {
		await git.checkout({
			force: true,
			fs,
			dir: dest,
			ref: checkoutRef,
		});
	}

	fs.rmSync(path.join(dest, '.git'), { force: true, recursive: true });
}

export function createGitClient(): GitClient {
	return {
		async fetchRefs(repo) {
			try {
				return repo.transport === 'ssh'
					? await fetchRefsWithGitCli(repo)
					: await fetchRefsWithIsomorphicGit(repo);
			} catch (error) {
				if (repo.transport === 'ssh' && isMissingGitBinaryError(error)) {
					throw createMissingGitError(repo, error);
				}

				if (repo.transport === 'ssh' && isMissingSshKeyError(error)) {
					throw createSshError(repo, error);
				}

				throw new DegitError(`could not fetch remote ${repo.url}`, {
					code: 'COULD_NOT_FETCH',
					original: error,
					url: repo.url,
				});
			}
		},

		async clone(repo, dest, ref, transport = repo.transport) {
			try {
				if (transport === 'ssh') {
					await cloneWithGitCli(repo, dest, ref, transport);
				} else {
					await cloneWithIsomorphicGit(repo, dest, ref, transport);
				}
			} catch (error) {
				if (transport === 'ssh' && isMissingGitBinaryError(error)) {
					throw createMissingGitError(repo, error);
				}

				if (transport === 'ssh' && isMissingSshKeyError(error)) {
					throw createSshError(repo, error);
				}

				throw new DegitError(`could not clone ${repo.url}`, {
					code: 'COULD_NOT_FETCH',
					original: error,
					url: repo.url,
				});
			}
		},
	};
}

export const defaultGitClient = createGitClient();
