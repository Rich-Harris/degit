import fs from 'node:fs';
import glob from 'tiny-glob/sync.js';
import assert from 'node:assert';

function readFixture(file) {
	return fs.readFileSync(file, 'utf8');
}

export function compareDirToExpected(dir, files) {
	const expected = glob('**', { cwd: dir });
	assert.deepEqual(Object.keys(files).sort(), expected.sort());

	expected.forEach((file) => {
		if (!fs.lstatSync(`${dir}/${file}`).isDirectory()) {
			assert.equal(files[file].trim(), readFixture(`${dir}/${file}`).trim());
		}
	});
}

export function createMockExec(stubs = {}) {
	const calls = [];
	const fn = (command, args = []) => {
		const call = [command, ...args].join(' ');
		calls.push(call);

		if (!Object.hasOwn(stubs, call)) {
			return Promise.reject(new Error(`Unexpected command: ${call}`));
		}

		const stub = stubs[call];
		if (stub && stub.error) {
			return Promise.reject(stub.error);
		}

		const stdout = typeof stub === 'string' ? stub : stub.stdout || '';
		const stderr = stub && stub.stderr ? stub.stderr : '';

		return Promise.resolve({ stderr, stdout });
	};

	return { calls, fn };
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

	const fn = (url, file, proxy) => {
		calls.push({ file, proxy, url });
		fs.copyFileSync(sourceFile, file);

		return Promise.resolve();
	};

	return { calls, fn };
}
