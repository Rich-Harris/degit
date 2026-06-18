import { DegitError } from '../../shared/utils.js';
import type { Ref } from '../../domain/types.js';
import type { Repo } from '../../domain/repo.js';

type GitPlan = {
	cloneRef?: string;
	checkoutRef?: string;
	singleBranch?: boolean;
};

export function getGitUrl(repo: Repo, transport: Repo['transport'] = repo.transport): string {
	return transport === 'ssh' ? repo.ssh : repo.url;
}

function isCommitHash(ref: string): boolean {
	return /^[0-9a-f]{7,40}$/i.test(ref);
}

export function normalizeGitRef(ref: string): string {
	if (ref.startsWith('refs/heads/')) {
		return ref.slice('refs/heads/'.length);
	}

	if (ref.startsWith('refs/tags/')) {
		return ref.slice('refs/tags/'.length);
	}

	return ref;
}

export function isMissingSshKeyError(error: unknown): boolean {
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

export function isMissingGitBinaryError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}

	return (error as { code?: string }).code === 'ENOENT';
}

export function createSshError(repo: Repo, error: unknown): DegitError {
	return new DegitError(
		`SSH authentication failed for ${repo.url}. Start ssh-agent and add a key, or use the HTTPS source instead.`,
		{
			code: 'SSH_NO_KEY',
			original: error,
			url: repo.url,
		},
	);
}

export function createMissingGitError(repo: Repo, error: unknown): DegitError {
	return new DegitError(`git is not installed. Install git to clone ${repo.url}.`, {
		code: 'GIT_NOT_FOUND',
		original: error,
		url: repo.url,
	});
}

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

function mapServerRef(serverRef: {
	hash?: string;
	oid?: string;
	ref?: string;
	name?: string;
}): Ref | null {
	const refName = String(serverRef.ref || serverRef.name || '');
	const refHash = String(serverRef.oid || serverRef.hash || '');

	if (!refName || !refHash) {
		return null;
	}

	return mapRemoteRef(refName, refHash);
}

function dedupeRefs(refs: Ref[]): Ref[] {
	const seen = new Set<string>();
	return refs.filter((ref) => {
		const key = ref.type === 'HEAD' ? 'HEAD' : ref.name ? `${ref.type}:${ref.name}` : ref.hash;
		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

export function parseGitLsRemoteOutput(output: string): Ref[] {
	const refs = new Map<string, Ref>();
	const symrefs = new Map<string, string>();

	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const symrefMatch = /^ref:\s+(.+)\t(.+)$/.exec(line);
		if (symrefMatch) {
			symrefs.set(symrefMatch[2], symrefMatch[1]);
			continue;
		}

		const tabIndex = line.indexOf('\t');
		if (tabIndex === -1) {
			continue;
		}

		const hash = line.slice(0, tabIndex);
		const refName = line.slice(tabIndex + 1);
		refs.set(refName, mapRemoteRef(refName, hash));
	}

	for (const [name, target] of symrefs) {
		if (name !== 'HEAD') {
			continue;
		}

		const targetRef = refs.get(target);
		if (targetRef) {
			refs.set('HEAD', {
				hash: targetRef.hash,
				type: 'HEAD',
			});
		}
	}

	return dedupeRefs(Array.from(refs.values()));
}

export function normalizeServerRefs(
	refs: Array<{ hash?: string; oid?: string; ref?: string; name?: string }>,
): Ref[] {
	return dedupeRefs(
		refs.flatMap((ref) => {
			const normalized = mapServerRef(ref);
			return normalized ? [normalized] : [];
		}),
	);
}

export function getGitClonePlan(ref: string): GitPlan {
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
