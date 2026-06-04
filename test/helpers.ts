import fs from 'node:fs';
import glob from 'tiny-glob/sync.js';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';

function readFixture(file) {
	return fs.readFileSync(file, 'utf8');
}

export function compareDirToExpected(dir, files) {
	const expected = glob('**', { cwd: dir }).map((file) => file.replaceAll('\\', '/'));
	assert.deepEqual(Object.keys(files).sort(), expected.sort());

	expected.forEach((file) => {
		if (!fs.lstatSync(`${dir}/${file}`).isDirectory()) {
			assert.equal(files[file].trim(), readFixture(`${dir}/${file}`).trim());
		}
	});
}

export function createMockGit(stubs = {}) {
	const calls = [];
	const getGitUrl = (repo, transport = repo.transport) =>
		transport === 'ssh' ? repo.ssh : repo.url;
	const resolveStub = async (call, ...args) => {
		if (!Object.hasOwn(stubs, call)) {
			return Promise.reject(new Error(`Unexpected git call: ${call}`));
		}

		const stub = stubs[call];
		if (typeof stub === 'function') {
			return stub(...args);
		}

		return Promise.resolve(stub);
	};

	const fetchRefs = async (repo) => {
		const call = `fetchRefs ${getGitUrl(repo)}`;
		calls.push(call);
		return resolveStub(call, repo);
	};

	const clone = async (repo, dest, ref, transport) => {
		const call = `clone ${getGitUrl(repo, transport)} ${dest}${ref ? ` ${ref}` : ''}`;
		calls.push(call);
		return resolveStub(call, repo, dest, ref, transport);
	};

	return { calls, fn: { clone, fetchRefs } };
}

export function createMockFetch(steps) {
	const calls = [];
	let step = 0;

	const fn = (url, file, proxy) => {
		calls.push({ file, proxy, url });

		const response = steps[step++];
		if (!response) {
			return Promise.reject(new Error('No mock fetch step configured'));
		}

		if (response.status >= 300 && response.status < 400) {
			return fn(response.location, file, proxy);
		}

		if (response.status >= 400) {
			return Promise.reject(
				response.error || {
					code: response.code || response.status,
					message: response.message || 'mock fetch error',
				},
			);
		}

		return Promise.resolve();
	};

	return { calls, fn };
}

export function createCopyFetch(sourceFile) {
	const calls = [];
	const maxAttempts = 6;

	const copyWithRetry = (destination, attempt = 1) => {
		try {
			fs.copyFileSync(sourceFile, destination);
			return Promise.resolve();
		} catch (error) {
			const isRetryable = error?.code === 'EPERM' || error?.code === 'EBUSY';
			if (!isRetryable || attempt === maxAttempts) {
				return Promise.reject(error);
			}

			return delay(25 * attempt).then(() => copyWithRetry(destination, attempt + 1));
		}
	};

	const fn = async (url, file, proxy) => {
		calls.push({ file, proxy, url });
		await copyWithRetry(file);

		return Promise.resolve();
	};

	return { calls, fn };
}
