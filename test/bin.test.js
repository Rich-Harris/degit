import sourceMapSupport from 'source-map-support';
import assert from 'assert';
import { sync as rimraf } from 'rimraf';

sourceMapSupport.install();

vi.mock('../src/index.js', () => ({
	default: vi.fn()
}));

import { main, run } from '../src/bin.js';
import degit from '../src/index.js';

const mockDegit = vi.mocked(degit);

async function waitForCondition(fn, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fn()) return;
		await new Promise(r => setTimeout(r, 5));
	}
	assert.fail('timeout waiting for condition');
}

describe('degit bin', () => {
	const binTmp = '.tmp/bin-suite';

	beforeEach(async () => {
		await rimraf(binTmp);
		vi.clearAllMocks();
		mockDegit.mockReturnValue({
			on: vi.fn().mockReturnThis(),
			clone: vi.fn().mockResolvedValue(undefined)
		});
	});
	afterEach(async () => await rimraf(binTmp));

	it("writes help to stdout when argv includes --help", async () => {
		const chunks = [];
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = (chunk, enc, cb) => {
			chunks.push(String(chunk));
			if (typeof cb === 'function') cb();
			return true;
		};
		try {
			await main(['node', 'bin', '--help']);
		} finally {
			process.stdout.write = orig;
		}
		const out = chunks.join('');
		assert.ok(out.includes('Usage'));
		assert.ok(out.includes('degit'));
	});

	it("invokes degit clone with options when argv supplies src and destination", async () => {
		await main(['node', 'bin', 'user/repo', 'out', '-f']);
		assert.equal(mockDegit.mock.calls.length, 1);
		assert.equal(mockDegit.mock.calls[0][0], 'user/repo');
		assert.equal(mockDegit.mock.calls[0][1].force, true);
		const instance = mockDegit.mock.results[0].value;
		assert.equal(instance.clone.mock.calls[0][0], 'out');
	});

	it("exits with status 1 when the clone promise rejects", async () => {
		const err = new Error('clone failed');
		mockDegit.mockReturnValue({
			on: vi.fn().mockReturnThis(),
			clone: vi.fn().mockReturnValue(Promise.reject(err))
		});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			run('a/b', 'dest', { force: true });
			await waitForCondition(() => exitSpy.mock.calls.length > 0);
			assert.equal(exitSpy.mock.calls[0][0], 1);
		} finally {
			exitSpy.mockRestore();
			errSpy.mockRestore();
		}
	});

	it("prints a verbose hint to stderr when an info event fires", async () => {
		const handlers = {};
		mockDegit.mockReturnValue({
			on: vi.fn(function on(ev, fn) {
				handlers[ev] = fn;
				return this;
			}),
			clone: vi.fn().mockImplementation(() => {
				handlers.info({ message: 'options.verbose enabled' });
				return Promise.resolve();
			})
		});
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			run('a/b', 'dest', { verbose: true });
			await waitForCondition(() =>
				errSpy.mock.calls.some(c => String(c[0]).includes('--verbose'))
			);
		} finally {
			errSpy.mockRestore();
		}
	});

	it("prints a force hint to stderr when a warn event fires", async () => {
		const handlers = {};
		mockDegit.mockReturnValue({
			on: vi.fn(function on(ev, fn) {
				handlers[ev] = fn;
				return this;
			}),
			clone: vi.fn().mockImplementation(() => {
				handlers.warn({ message: 'options.force suggested' });
				return Promise.resolve();
			})
		});
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			run('a/b', 'dest', {});
			await waitForCondition(() =>
				errSpy.mock.calls.some(c => String(c[0]).includes('--force'))
			);
		} finally {
			errSpy.mockRestore();
		}
	});
});
