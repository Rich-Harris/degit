import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

const { cloneMock, checkoutMock, getRemoteInfo2Mock, listServerRefsMock } = vi.hoisted(() => ({
	cloneMock: vi.fn<(...args: any[]) => any>(),
	checkoutMock: vi.fn<(...args: any[]) => any>(),
	getRemoteInfo2Mock: vi.fn<(...args: any[]) => any>(),
	listServerRefsMock: vi.fn<(...args: any[]) => any>(),
}));

const spawnMock = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const execFileMock = vi.fn<
	(command: string, args: string[], callback: (error?: unknown) => void) => void
>((command: string, _args: string[], callback: (error?: unknown) => void) => {
	callback(
		Object.assign(new Error(`spawn ${command} ENOENT`), {
			code: 'ENOENT',
			syscall: `spawn ${command}`,
		}),
	);
});

type SpawnProcess = {
	stdout: PassThrough;
	stderr: PassThrough;
	once(event: 'close', listener: (code: number) => void): void;
	once(event: 'error', listener: (error: unknown) => void): void;
	emit(event: 'close', code: number): void;
	emit(event: 'error', error: unknown): void;
};

function createSpawnProcess() {
	const listeners: {
		close?: (code: number) => void;
		error?: (error: unknown) => void;
	} = {};

	return {
		stderr: new PassThrough(),
		stdout: new PassThrough(),
		once(event, listener) {
			listeners[event] = listener;
		},
		emit(event, value) {
			listeners[event]?.(value as never);
		},
	} satisfies SpawnProcess;
}

function writeChunkedLines(child: SpawnProcess, lines: string[]) {
	const chunkSize = 16;

	for (let index = 0; index < lines.length; index += chunkSize) {
		child.stdout.write(`${lines.slice(index, index + chunkSize).join('\n')}\n`);
	}
}

vi.mock('node:child_process', () => ({
	execFile: execFileMock,
	spawn: spawnMock,
}));

vi.mock('isomorphic-git', () => ({
	checkout: checkoutMock,
	clone: cloneMock,
	getRemoteInfo2: getRemoteInfo2Mock,
	listServerRefs: listServerRefsMock,
}));

vi.mock('isomorphic-git/http/node', () => ({
	default: {},
}));

const { createGitClient } = await import('../../src/transports/git/client.js');

/* eslint-disable max-lines-per-function */
describe('git client', () => {
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

	beforeEach(() => {
		checkoutMock.mockReset();
		cloneMock.mockReset();
		execFileMock.mockClear();
		spawnMock.mockClear();
		getRemoteInfo2Mock.mockReset();
		listServerRefsMock.mockReset();
		spawnMock.mockImplementation((command: string, args: string[]) => {
			if (command === 'git' && args[0] === 'ls-remote') {
				const child = createSpawnProcess();
				queueMicrotask(() => {
					child.emit(
						'error',
						Object.assign(new Error(`spawn ${command} ENOENT`), {
							code: 'ENOENT',
							syscall: `spawn ${command}`,
						}),
					);
				});

				return child;
			}

			throw new Error(`Unexpected spawn call: ${command} ${args.join(' ')}`);
		});
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

	it('uses the planned branch when cloning over https', async () => {
		await createGitClient().clone(httpsRepo, '.tmp/git-client-test', 'main');

		assert.equal(cloneMock.mock.calls.length, 1);
		assert.deepEqual(
			{
				depth: cloneMock.mock.calls[0][0].depth,
				dir: cloneMock.mock.calls[0][0].dir,
				ref: cloneMock.mock.calls[0][0].ref,
				singleBranch: cloneMock.mock.calls[0][0].singleBranch,
				url: cloneMock.mock.calls[0][0].url,
			},
			{
				depth: 1,
				dir: '.tmp/git-client-test',
				ref: 'main',
				singleBranch: true,
				url: httpsRepo.url,
			},
		);
		assert.equal(checkoutMock.mock.calls.length, 1);
		assert.deepEqual(
			{
				dir: checkoutMock.mock.calls[0][0].dir,
				force: checkoutMock.mock.calls[0][0].force,
				ref: checkoutMock.mock.calls[0][0].ref,
			},
			{
				dir: '.tmp/git-client-test',
				force: true,
				ref: 'main',
			},
		);
	});

	it('reads chunked ls-remote output when fetching refs over ssh', async () => {
		spawnMock.mockImplementationOnce(() => {
			const child = createSpawnProcess();
			queueMicrotask(() => {
				writeChunkedLines(child, [
					'ref: refs/heads/main\tHEAD',
					'0123456789abcdef0123456789abcdef01234567\trefs/heads/main',
					...Array.from(
						{ length: 99 },
						(_value, index) =>
							`0123456789abcdef0123456789abcdef012345${String(index).padStart(2, '0')}\trefs/heads/feature-${index}`,
					),
				]);
				child.stderr.end();
				child.emit('close', 0);
			});

			return child;
		});

		const refs = await createGitClient().fetchRefs(sshRepo);

		assert.equal(refs.length, 101);
		assert.deepEqual(refs[0], {
			hash: '0123456789abcdef0123456789abcdef01234567',
			name: 'main',
			type: 'branch',
		});
		assert.deepEqual(refs[50], {
			hash: '0123456789abcdef0123456789abcdef01234549',
			name: 'feature-49',
			type: 'branch',
		});
		assert.deepEqual(refs[100], {
			hash: '0123456789abcdef0123456789abcdef01234567',
			type: 'HEAD',
		});
	});

	it('reports a missing git binary when fetching refs over ssh', async () => {
		await assert.rejects(createGitClient().fetchRefs(sshRepo), (error: any) => {
			assert.equal(error.code, 'GIT_NOT_FOUND');
			assert.match(error.message, /git is not installed/u);
			return true;
		});
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
			(error: any) => {
				assert.equal(error.code, 'GIT_NOT_FOUND');
				assert.match(error.message, /git is not installed/u);
				return true;
			},
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
/* eslint-enable max-lines-per-function */
