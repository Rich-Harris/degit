import assert from 'node:assert';
import { vi } from 'vitest';

const { getRemoteInfo2Mock, listServerRefsMock } = vi.hoisted(() => ({
	getRemoteInfo2Mock: vi.fn(),
	listServerRefsMock: vi.fn(),
}));

const execFileMock = vi.fn(
	(command: string, _args: string[], callback: (error?: unknown) => void) => {
		callback(
			Object.assign(new Error(`spawn ${command} ENOENT`), {
				code: 'ENOENT',
				syscall: `spawn ${command}`,
			}),
		);
	},
);

vi.mock('node:child_process', () => ({
	execFile: execFileMock,
}));

vi.mock('isomorphic-git', () => ({
	getRemoteInfo2: getRemoteInfo2Mock,
	listServerRefs: listServerRefsMock,
}));

vi.mock('isomorphic-git/http/node', () => ({
	default: {},
}));

const { createGitClient } = await import('../../src/git-client.js');

const sshRepo = {
	mode: 'tar',
	name: 'degit-test-repo',
	ref: 'HEAD',
	site: 'github',
	ssh: 'ssh://git@github.com/Rich-Harris/degit-test-repo',
	transport: 'ssh',
	url: 'https://github.com/Rich-Harris/degit-test-repo',
	user: 'Rich-Harris',
} as const;

const httpsRepo = {
	mode: 'tar',
	name: 'gitlab-test-repo',
	ref: 'HEAD',
	site: 'gitlab',
	ssh: 'ssh://git@gitlab.com/gitlab-org/gitlab-test-repo',
	transport: 'https',
	url: 'https://gitlab.com/gitlab-org/gitlab-test-repo',
	user: 'gitlab-org',
} as const;

describe('git client', () => {
	beforeEach(() => {
		execFileMock.mockClear();
		getRemoteInfo2Mock.mockReset();
		listServerRefsMock.mockReset();
		execFileMock.mockImplementation(
			(command: string, args: string[], callback: (error?: unknown) => void) => {
				if (command === 'git' && args[0] === 'clone') {
					callback();
					return;
				}

				callback(
					Object.assign(new Error(`spawn ${command} ENOENT`), {
						code: 'ENOENT',
						syscall: `spawn ${command}`,
					}),
				);
			},
		);
	});

	it('falls back to protocol v1 discovery when protocol v2 ref listing fails for https repos', async () => {
		listServerRefsMock.mockRejectedValueOnce(
			Object.assign(new Error('HTTP Error: 422 Unprocessable Entity'), {
				code: 'HttpError',
			}),
		);
		getRemoteInfo2Mock.mockResolvedValueOnce({
			capabilities: {},
			protocolVersion: 1,
			refs: [{ oid: '0123456789abcdef0123456789abcdef01234567', ref: 'refs/heads/main' }],
		});

		const refs = await createGitClient().fetchRefs(httpsRepo);

		assert.deepEqual(refs, [
			{
				hash: '0123456789abcdef0123456789abcdef01234567',
				name: 'main',
				type: 'branch',
			},
		]);
		assert.equal(listServerRefsMock.mock.calls.length, 1);
		assert.equal(getRemoteInfo2Mock.mock.calls.length, 1);
		assert.equal(getRemoteInfo2Mock.mock.calls[0][0].protocolVersion, 1);
	});

	it('reports a missing git binary when fetching refs over ssh', async () => {
		await assert.rejects(
			createGitClient().fetchRefs(sshRepo),
			(error: any) =>
				error.code === 'GIT_NOT_FOUND' && /git is not installed/.test(error.message),
		);
	});

	it('reports a missing git binary when cloning over ssh', async () => {
		execFileMock.mockImplementationOnce(
			(command: string, _args: string[], callback: (error?: unknown) => void) => {
				callback(
					Object.assign(new Error(`spawn ${command} ENOENT`), {
						code: 'ENOENT',
						syscall: `spawn ${command}`,
					}),
				);
			},
		);

		await assert.rejects(
			createGitClient().clone(sshRepo, '.tmp/git-client-test'),
			(error: any) =>
				error.code === 'GIT_NOT_FOUND' && /git is not installed/.test(error.message),
		);
	});

	it('uses a shallow clone when cloning over ssh', async () => {
		await createGitClient().clone(sshRepo, '.tmp/git-client-test');

		assert.equal(execFileMock.mock.calls[0][0], 'git');
		assert.deepEqual(execFileMock.mock.calls[0][1], [
			'clone',
			'--depth',
			'1',
			sshRepo.ssh,
			'.tmp/git-client-test',
		]);
	});
});
