import fs from 'node:fs';
import https from 'node:https';
import assert from 'node:assert';
import path from 'node:path';
import { describe, it, vi } from 'vitest';
import {
	copyToStash,
	fetch,
	removeStashedFromDest,
	resolveBase,
	safeResolve,
	unstashFiles,
	validateDestination,
} from '../../src/shared/utils.js';

/* eslint-disable max-lines-per-function */
describe('shared utils', () => {
	it('uses XDG_CACHE_HOME on linux when it is set', () => {
		assert.equal(
			resolveBase({
				env: { XDG_CACHE_HOME: '/tmp/cache' },
				homedir: '/home/user',
				platform: 'linux',
			}),
			path.join('/tmp/cache', 'degit'),
		);
	});

	it('falls back to the home cache directory on linux when XDG_CACHE_HOME is missing', () => {
		assert.equal(
			resolveBase({
				env: {},
				homedir: '/home/user',
				platform: 'linux',
			}),
			path.join('/home/user', '.cache', 'degit'),
		);
	});

	it('uses the macOS cache directory when the platform is darwin', () => {
		assert.equal(
			resolveBase({
				env: { XDG_CACHE_HOME: '/tmp/cache' },
				homedir: '/Users/user',
				platform: 'darwin',
			}),
			path.join('/Users/user', 'Library', 'Caches', 'degit'),
		);
	});

	it('uses LOCALAPPDATA when the platform is windows', () => {
		assert.equal(
			resolveBase({
				env: { LOCALAPPDATA: 'C:/Users/user/AppData/Local' },
				homedir: '/Users/user',
				platform: 'win32',
			}),
			path.join('C:/Users/user/AppData/Local', 'degit'),
		);
	});

	it('stashes and unstashes nested directories when a clone-produced degit.json is overwritten by the original', () => {
		const root = fs.mkdtempSync(path.join(process.cwd(), 'stash-'));
		const cacheDir = path.join(root, 'cache');
		const dest = path.join(root, 'dest');

		try {
			fs.mkdirSync(path.join(dest, 'nested'), { recursive: true });
			fs.writeFileSync(path.join(dest, 'nested', 'file.txt'), 'nested\n');
			fs.writeFileSync(path.join(dest, 'top.txt'), 'top\n');
			fs.writeFileSync(path.join(dest, 'degit.json'), 'outer directives\n');

			removeStashedFromDest(copyToStash(cacheDir, dest));

			assert.deepEqual(fs.readdirSync(dest), []);

			fs.mkdirSync(path.join(dest, 'nested'), { recursive: true });
			fs.writeFileSync(path.join(dest, 'nested', 'file.txt'), 'clone\n');
			fs.writeFileSync(path.join(dest, 'top.txt'), 'clone top\n');
			fs.writeFileSync(path.join(dest, 'degit.json'), 'clone directives\n');

			unstashFiles(cacheDir, dest);

			assert.equal(
				fs.readFileSync(path.join(dest, 'nested', 'file.txt'), 'utf8'),
				'nested\n',
			);
			assert.equal(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), 'top\n');
			assert.equal(
				fs.readFileSync(path.join(dest, 'degit.json'), 'utf8'),
				'outer directives\n',
			);
			assert.equal(fs.existsSync(path.join(cacheDir, 'tmp')), false);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('restores the stashed degit.json when the clone removed it before unstash', () => {
		const root = fs.mkdtempSync(path.join(process.cwd(), 'stash-degit-json-removed-'));
		const cacheDir = path.join(root, 'cache');
		const dest = path.join(root, 'dest');

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(path.join(dest, 'degit.json'), 'original\n');
			fs.writeFileSync(path.join(dest, 'other.txt'), 'other\n');

			removeStashedFromDest(copyToStash(cacheDir, dest));

			fs.writeFileSync(path.join(dest, 'degit.json'), 'clone\n');
			fs.unlinkSync(path.join(dest, 'degit.json'));

			unstashFiles(cacheDir, dest);

			assert.equal(fs.readFileSync(path.join(dest, 'degit.json'), 'utf8'), 'original\n');
			assert.equal(fs.readFileSync(path.join(dest, 'other.txt'), 'utf8'), 'other\n');
			assert.equal(fs.existsSync(path.join(cacheDir, 'tmp')), false);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('resumes redirect responses when following a redirected archive fetch', async () => {
		const createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream').mockReturnValue({
			on(event: string, handler: () => void) {
				queueMicrotask(handler);

				return this;
			},
		} as never);

		const response1 = {
			headers: { location: 'https://example.com/archive.tar.gz' },
			pipe: vi.fn<(...args: any[]) => any>(),
			resume: vi.fn<(...args: any[]) => any>(),
			statusCode: 302,
			statusMessage: 'Found',
		};
		const response2 = {
			headers: {},
			pipe: vi.fn<(...args: any[]) => any>((stream) => stream),
			resume: vi.fn<(...args: any[]) => any>(),
			statusCode: 200,
			statusMessage: 'OK',
		};

		const request = () => ({
			on() {
				return this;
			},
		});
		const getSpy = vi
			.spyOn(https, 'get')
			.mockImplementationOnce(((options, callback) => {
				callback(response1 as never);
				return request();
			}) as never)
			.mockImplementation(((options, callback) => {
				callback(response2 as never);
				return request();
			}) as never);

		try {
			await fetch('https://example.com/archive.tar.gz', '/tmp/degit-fetch-test.tar.gz');
			assert.equal(response1.resume.mock.calls.length, 1);
			assert.equal(response2.resume.mock.calls.length, 0);
			assert.equal(getSpy.mock.calls.length, 2);
		} finally {
			createWriteStreamSpy.mockRestore();
			getSpy.mockRestore();
		}
	});

	it('rejects paths that resolve to the destination root when a root-like path is given', () => {
		const root = path.resolve('/tmp/degit-safe-test');
		assert.equal(safeResolve(root, '.'), undefined);
		assert.equal(safeResolve(root, ''), undefined);
		assert.equal(safeResolve(root, 'foo/..'), undefined);
		assert.equal(safeResolve(root, 'foo'), path.join(root, 'foo'));
	});

	it('rejects absolute paths and multi-level dot-dot escapes when resolving inside the root', () => {
		const root = path.resolve('/tmp/degit-safe-test');
		assert.equal(safeResolve(root, path.join(root, '..', 'outside')), undefined);
		assert.equal(safeResolve(root, 'foo/../../outside'), undefined);
		assert.equal(safeResolve(root, 'foo'), path.join(root, 'foo'));
	});

	it('reports missing, existing, non-directory and broken-symlink destinations when validating a destination', () => {
		const root = fs.mkdtempSync(path.join(process.cwd(), 'validate-dest-'));
		const missing = path.join(root, 'missing');
		const dir = path.join(root, 'dir');
		const file = path.join(root, 'file');
		const brokenLink = path.join(root, 'broken-link');

		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(file, 'not a directory');
			fs.symlinkSync('missing-target', brokenLink);
			const dirLink = path.join(root, 'dir-link');
			fs.symlinkSync(dir, dirLink);

			assert.equal(validateDestination(dir, false), true);
			assert.equal(validateDestination(missing, true), false);

			assert.throws(
				() => validateDestination(file, true),
				(err: any) => err?.code === 'ENOTDIR',
			);
			assert.throws(
				() => validateDestination(missing, false),
				(err: any) => err?.code === 'MISSING_DEST',
			);
			assert.throws(
				() => validateDestination(brokenLink, true),
				(err: any) => err?.code === 'ENOTDIR',
			);
			assert.throws(
				() => validateDestination(brokenLink, false),
				(err: any) => err?.code === 'ENOTDIR',
			);
			assert.throws(
				() => validateDestination(dirLink, true),
				(err: any) => err?.code === 'ENOTDIR',
			);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('stashes and restores a directory symlink when the destination contains symlinks', () => {
		const root = fs.mkdtempSync(path.join(process.cwd(), 'stash-symlink-'));
		const cacheDir = path.join(root, 'cache');
		const dest = path.join(root, 'dest');
		const linkTarget = path.join(root, 'link-target');

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.mkdirSync(linkTarget, { recursive: true });
			fs.writeFileSync(path.join(linkTarget, 'file.txt'), 'inside symlink target\n');
			fs.symlinkSync(path.relative(dest, linkTarget), path.join(dest, 'linked-dir'), 'dir');

			removeStashedFromDest(copyToStash(cacheDir, dest));

			assert.equal(fs.existsSync(path.join(dest, 'linked-dir')), false);
			assert.equal(
				fs.lstatSync(path.join(cacheDir, 'tmp', 'linked-dir')).isSymbolicLink(),
				true,
			);

			unstashFiles(cacheDir, dest);

			assert.equal(fs.lstatSync(path.join(dest, 'linked-dir')).isSymbolicLink(), true);
			assert.equal(
				fs.readFileSync(path.join(dest, 'linked-dir', 'file.txt'), 'utf8'),
				'inside symlink target\n',
			);
			assert.equal(fs.existsSync(path.join(cacheDir, 'tmp')), false);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('restores the stashed degit.json when keepCloneOutput is false', () => {
		const root = fs.mkdtempSync(path.join(process.cwd(), 'stash-degit-json-false-'));
		const cacheDir = path.join(root, 'cache');
		const dest = path.join(root, 'dest');

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(path.join(dest, 'degit.json'), 'original\n');
			fs.writeFileSync(path.join(dest, 'other.txt'), 'other\n');

			removeStashedFromDest(copyToStash(cacheDir, dest));

			fs.writeFileSync(path.join(dest, 'degit.json'), 'clone\n');

			unstashFiles(cacheDir, dest, false);

			assert.equal(fs.readFileSync(path.join(dest, 'degit.json'), 'utf8'), 'original\n');
			assert.equal(fs.readFileSync(path.join(dest, 'other.txt'), 'utf8'), 'other\n');
			assert.equal(fs.existsSync(path.join(cacheDir, 'tmp')), false);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});
});
/* eslint-enable max-lines-per-function */
