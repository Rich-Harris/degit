import fs from 'node:fs';
import assert from 'node:assert';
import child_process from 'node:child_process';
import path from 'node:path';
import { sync as rimraf } from 'rimraf';

vi.mock('../../src/index.js', () => ({
	default: vi.fn(),
}));

vi.mock('../../src/shared/utils.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/shared/utils.js')>(
		'../../src/shared/utils.js',
	);

	return {
		...actual,
		base: path.join(process.cwd(), '.tmp', 'bin-suite-cache'),
	};
});

vi.mock('tiny-glob/sync.js', () => ({
	default: vi.fn((pattern: string) => {
		if (pattern === '**/access.json') {
			return ['github/user-a/repo-a/access.json', 'github/user-b/repo-b/access.json'];
		}

		if (pattern === '**/map.json') {
			return ['github/user-a/repo-a/map.json', 'github/user-b/repo-b/map.json'];
		}

		return [];
	}),
}));

vi.mock('enquirer', () => ({
	default: {
		prompt: vi.fn(),
	},
}));

import { main, run } from '../../src/bin.js';
import degit from '../../src/index.js';
import { base } from '../../src/shared/utils.js';
import enquirer from 'enquirer';

const mockDegit = vi.mocked(degit);
const mockPrompt = vi.mocked(enquirer.prompt);
async function waitForCondition(fn, timeoutMs = 3000, startedAt = Date.now()) {
	if (fn()) {
		return;
	}

	if (Date.now() >= startedAt + timeoutMs) {
		assert.fail('timeout waiting for condition');
	}

	await new Promise((resolve) => {
		setTimeout(resolve, 5);
	});
	return waitForCondition(fn, timeoutMs, startedAt);
}

function mockEventClone(eventName, message) {
	const handlers = {};
	mockDegit.mockReturnValue({
		clone: vi.fn().mockImplementation(() => {
			handlers[eventName]({ message });
			return Promise.resolve();
		}),
		on: vi.fn(function on(ev, fn) {
			handlers[ev] = fn;
			return this;
		}),
	} as never);
	return handlers;
}

async function withCloneFailure(
	args: Parameters<typeof run>[2],
	error: Error,
	assertions: (stderrSpy: ReturnType<typeof vi.spyOn>) => void,
) {
	mockDegit.mockReturnValue({
		clone: vi.fn().mockReturnValue(Promise.reject(error)),
		on: vi.fn().mockReturnThis(),
	} as never);

	const previousExitCode = process.exitCode;
	process.exitCode = 0;
	const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

	try {
		run('a/b', 'dest', args);
		await waitForCondition(() => process.exitCode === 1);
		assertions(stderrSpy);
	} finally {
		stderrSpy.mockRestore();
		process.exitCode = previousExitCode ?? 0;
	}
}

const binTmp = '.tmp/bin-suite';
const repoRoot = process.cwd();
const rootBin = path.join(repoRoot, 'degit');
const interactiveBase = path.join(process.cwd(), '.tmp', 'bin-suite-cache', 'github');

function clearInteractiveFixtures() {
	fs.rmSync(interactiveBase, { force: true, recursive: true });
}
beforeEach(async () => {
	await rimraf(binTmp);
	clearInteractiveFixtures();
	vi.clearAllMocks();
	mockDegit.mockReturnValue({
		clone: vi.fn().mockResolvedValue(),
		on: vi.fn().mockReturnThis(),
	} as never);
});

afterEach(async () => {
	await rimraf(binTmp);
	clearInteractiveFixtures();
});

describe('degit bin help', () => {
	it('runs the built root bin when --help is executed', () => {
		const result = child_process.spawnSync('node', [rootBin, '--help'], {
			env: {
				...process.env,
				VITEST: '',
			},
			encoding: 'utf8',
		});
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
		assert.ok(output.length > 0);
		assert.ok(output.includes('degit'));
	});

	it('writes help to stdout when argv includes --help', async () => {
		const chunks: string[] = [];
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk, enc, cb) => {
			chunks.push(String(chunk));
			if (typeof cb === 'function') {
				cb();
			}
			return true;
		}) as typeof process.stdout.write;
		try {
			await main(['node', 'bin', '--help']);
		} finally {
			process.stdout.write = orig;
		}
		const out = chunks.join('');
		assert.ok(out.length > 0);
		assert.ok(out.includes('degit'));
	});
});

describe('degit bin main clone args', () => {
	it('invokes degit clone with options when argv supplies src and destination', async () => {
		await main(['node', 'bin', 'user/repo', 'out', '-f']);
		assert.equal(mockDegit.mock.calls.length, 1);
		assert.equal(mockDegit.mock.calls[0][0], 'user/repo');
		assert.equal((mockDegit.mock.calls[0][1] as any).force, true);
		const instance = mockDegit.mock.results[0].value;
		assert.equal(instance.clone.mock.calls[0][0], 'out');
	});
});

describe('degit bin main interactive selection', () => {
	it('ranks interactive repo choices by most recent access when argv omits src', async () => {
		const recentRepo = path.join(base, 'github', 'user-b', 'repo-b');
		const olderRepo = path.join(base, 'github', 'user-a', 'repo-a');

		fs.mkdirSync(recentRepo, { recursive: true });
		fs.mkdirSync(olderRepo, { recursive: true });
		fs.writeFileSync(path.join(olderRepo, 'map.json'), JSON.stringify({ main: 'hash-a' }));
		fs.writeFileSync(path.join(recentRepo, 'map.json'), JSON.stringify({ main: 'hash-b' }));
		fs.writeFileSync(
			path.join(olderRepo, 'access.json'),
			JSON.stringify({ main: '2024-01-01T00:00:00.000Z' }),
		);
		fs.writeFileSync(
			path.join(recentRepo, 'access.json'),
			JSON.stringify({ main: '2026-01-01T00:00:00.000Z' }),
		);

		mockPrompt.mockImplementation((questions) => {
			const srcQuestion = (
				questions as Array<{ name?: string; choices?: Array<{ value: string }> }>
			).find((question) => question.name === 'src');
			if (srcQuestion) {
				assert.deepEqual(
					srcQuestion.choices.map((choice) => choice.value),
					['github:user-b/repo-b#main', 'github:user-a/repo-a#main'],
				);
				return {
					cache: false,
					dest: '.tmp/bin-suite/from-interactive',
					src: 'github:user-b/repo-b#main',
				};
			}

			return {};
		});

		await main(['node', 'bin']);

		assert.equal(mockDegit.mock.calls.length, 1);
		assert.equal(mockDegit.mock.calls[0][0], 'github:user-b/repo-b#main');
		assert.equal(mockDegit.mock.calls[0][1].force, true);
		assert.equal(mockDegit.mock.calls[0][1].cache, false);
		assert.equal(
			mockDegit.mock.results[0].value.clone.mock.calls[0][0],
			'.tmp/bin-suite/from-interactive',
		);
	});
});

describe('degit bin main mode forwarding', () => {
	it('forwards explicit git mode when argv passes --mode=git', async () => {
		mockDegit.mockReturnValue({
			clone: vi.fn().mockResolvedValue(),
			on: vi.fn().mockReturnThis(),
		} as never);
		const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		try {
			await main(['node', 'bin', 'a/b', 'dest', '--mode=git']);
			await waitForCondition(() =>
				mockDegit.mock.calls.some((call) => call[1]?.mode === 'git'),
			);
			assert.equal(warnSpy.mock.calls.length, 0);
		} finally {
			warnSpy.mockRestore();
		}
	});
});
describe('degit bin run clone failures', () => {
	it('exits with status 1 when the clone promise rejects', async () => {
		const err = Object.assign(new Error('clone failed'), { original: 'nested failure' });

		await withCloneFailure({ force: true }, err, (stderrSpy) => {
			assert.equal(stderrSpy.mock.calls.length, 1);
			assert.ok(String(stderrSpy.mock.calls[0][0]).includes('clone failed'));
			assert.ok(!String(stderrSpy.mock.calls[0][0]).includes('nested failure'));
		});
	});

	it('prints nested clone failure details when verbose mode is enabled', async () => {
		const err = Object.assign(new Error('clone failed'), { original: 'nested failure' });

		await withCloneFailure({ force: true, verbose: true }, err, (stderrSpy) => {
			assert.equal(stderrSpy.mock.calls.length, 2);
			assert.ok(String(stderrSpy.mock.calls[0][0]).includes('clone failed'));
			assert.ok(String(stderrSpy.mock.calls[1][0]).includes('nested failure'));
		});
	});

	it('keeps verbose clone failures stable when nested details are missing', async () => {
		await withCloneFailure(
			{ force: true, verbose: true },
			new Error('clone failed'),
			(stderrSpy) => {
				assert.equal(stderrSpy.mock.calls.length, 1);
				assert.ok(String(stderrSpy.mock.calls[0][0]).includes('clone failed'));
			},
		);
	});
});
describe('degit bin run info events', () => {
	it('prints a verbose hint to stdout when an info event fires', async () => {
		mockEventClone('info', 'options.verbose enabled');
		const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		try {
			run('a/b', 'dest', { verbose: true });
			await waitForCondition(() =>
				outSpy.mock.calls.some((c) => String(c[0]).includes('--verbose')),
			);
		} finally {
			outSpy.mockRestore();
		}
	});
});

describe('degit bin run warn events', () => {
	it('prints a force hint to stderr when a warn event fires', async () => {
		mockEventClone('warn', 'options.force suggested');
		const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		try {
			run('a/b', 'dest', {});
			await waitForCondition(() =>
				warnSpy.mock.calls.some((c) => String(c[0]).includes('--force')),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});
});
