import fs from 'node:fs';
import https from 'node:https';
import assert from 'node:assert';
import path from 'node:path';
import { describe, it, vi } from 'vitest';
import { fetch, resolveBase } from '../../src/utils.js';

describe('resolveBase', () => {
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

	it('uses the macOS cache directory on darwin', () => {
		assert.equal(
			resolveBase({
				env: { XDG_CACHE_HOME: '/tmp/cache' },
				homedir: '/Users/user',
				platform: 'darwin',
			}),
			path.join('/Users/user', 'Library', 'Caches', 'degit'),
		);
	});

	it('uses LOCALAPPDATA on windows', () => {
		assert.equal(
			resolveBase({
				env: { LOCALAPPDATA: 'C:/Users/user/AppData/Local' },
				homedir: '/Users/user',
				platform: 'win32',
			}),
			path.join('C:/Users/user/AppData/Local', 'degit'),
		);
	});

	it('resumes redirect responses when following a redirected archive fetch', async () => {
		const createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream').mockReturnValue({
			on(event: string, handler: () => void) {
				if (event === 'finish') {
					queueMicrotask(handler);
				}

				return this;
			},
		} as never);

		const response1 = {
			headers: { location: 'https://example.com/archive.tar.gz' },
			pipe: vi.fn(),
			resume: vi.fn(),
			statusCode: 302,
			statusMessage: 'Found',
		};
		const response2 = {
			headers: {},
			pipe: vi.fn((stream) => stream),
			resume: vi.fn(),
			statusCode: 200,
			statusMessage: 'OK',
		};

		const getSpy = vi.spyOn(https, 'get').mockImplementation(((options, callback) => {
			callback((getSpy.mock.calls.length === 1 ? response1 : response2) as never);
			return {
				on() {
					return this;
				},
			};
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
});
