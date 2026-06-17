import { execFile as execFileCallback, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { DegitError } from '../../shared/utils.js';
import type { Repo } from '../../domain/repo.js';
import {
	createMissingGitError,
	createSshError,
	getGitClonePlan,
	getGitUrl,
	isMissingGitBinaryError,
	isMissingSshKeyError,
	normalizeGitRef,
	normalizeServerRefs,
	parseGitLsRemoteOutput,
	type Ref,
} from './client-utils.js';
import type { GitClient } from '../../domain/types.js';

type IsomorphicGitHttp = typeof import('isomorphic-git/http/node');

const execFile = promisify(execFileCallback);

const isomorphicGitHttp = http as IsomorphicGitHttp['default'];
function fetchRefsWithGitCli(repo: Repo) {
	return new Promise<Ref[]>((resolve, reject) => {
		const child = spawn('git', ['ls-remote', '--symref', getGitUrl(repo)], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const stdout = child.stdout;
		const stderr = child.stderr;

		if (!stdout || !stderr) {
			reject(new Error('could not start git ls-remote'));
			return;
		}

		let stdoutBuffer = '';
		let stderrBuffer = '';

		stdout.setEncoding('utf8');
		stderr.setEncoding('utf8');
		stdout.on('data', (chunk) => {
			stdoutBuffer += chunk;
		});
		stderr.on('data', (chunk) => {
			stderrBuffer += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) => {
			if (code !== 0) {
				const error = new Error(
					stderrBuffer.trim() || `git ls-remote exited with code ${code}`,
				);
				(error as { code?: number | string }).code = code ?? 'GIT_LS_REMOTE_FAILED';
				reject(error);
				return;
			}

			resolve(parseGitLsRemoteOutput(stdoutBuffer));
		});
	});
}

async function fetchRefsWithIsomorphicGit(repo: Repo) {
	const url = getGitUrl(repo);

	try {
		const refs = await git.listServerRefs({
			http: isomorphicGitHttp,
			peelTags: true,
			symrefs: true,
			url,
		});
		const normalizedRefs = normalizeServerRefs(refs);

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

		const normalizedRefs = normalizeServerRefs(remote.refs || []);
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
