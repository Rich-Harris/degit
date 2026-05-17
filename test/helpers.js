import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import glob from 'tiny-glob/sync.js';
import assert from 'assert';

export const degitPath = path.resolve('dist/bin.js');

export function readFixture(file) {
	return fs.readFileSync(file, 'utf-8');
}

export function compareDirToExpected(dir, files) {
	const expected = glob('**', { cwd: dir });
	assert.deepEqual(Object.keys(files).sort(), expected.sort());

	expected.forEach(file => {
		if (!fs.lstatSync(`${dir}/${file}`).isDirectory()) {
			assert.equal(
				files[file].trim(),
				readFixture(`${dir}/${file}`).trim()
			);
		}
	});
}

export function createMockExec(stubs = {}) {
	const calls = [];
	const fn = command => {
		calls.push(command);

		if (!Object.prototype.hasOwnProperty.call(stubs, command)) {
			return Promise.reject(new Error(`Unexpected command: ${command}`));
		}

		const stub = stubs[command];
		if (stub && stub.error) return Promise.reject(stub.error);

		const stdout = typeof stub === 'string' ? stub : stub.stdout || '';
		const stderr = stub && stub.stderr ? stub.stderr : '';

		return Promise.resolve({ stdout, stderr });
	};

	return { fn, calls };
}

export function createMockFetch(steps) {
	const calls = [];
	let step = 0;

	const fn = (url, file, proxy) => {
		calls.push({ url, file, proxy });

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
					message: response.message || 'mock fetch error'
				}
			);
		}

		return Promise.resolve();
	};

	return { fn, calls };
}

export function execShell(cmd) {
	return new Promise((fulfil, reject) => {
		child_process.exec(cmd, (err, stdout, stderr) => {
			if (err) return reject(err);
			console.log(stdout);
			console.error(stderr);
			fulfil();
		});
	});
}
