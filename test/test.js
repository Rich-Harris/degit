const fs = require('fs');
const path = require('path');
const glob = require('glob');
const rimraf = require('rimraf').sync;
const assert = require('assert');
const child_process = require('child_process');

const degit = path.resolve('bin/index.js');

function exec(cmd) {
	return new Promise((fulfil, reject) => {
		console.log({ cmd });
		child_process.exec(cmd, (err, stdout, stderr) => {
			if (err) return reject(err);
			console.log({stdout});
			console.error({stderr});
			fulfil();
		});
	});
}

describe('degit', () => {
	function compare(dir, files) {
		console.log('files: ', fs.readdirSync(dir));
		const expected = glob.sync('**', { cwd: dir });
		assert.deepEqual(Object.keys(files).sort(), expected.sort());

		expected.forEach(file => {
			assert.equal(files[file].trim(), read(`${dir}/${file}`).trim());
		});
	}

	describe('github', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'Rich-Harris/degit-test-repo',
			'github:Rich-Harris/degit-test-repo',
			'git@github.com:Rich-Harris/degit-test-repo',
			'https://github.com/Rich-Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degit} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from github!'
				});
			});
		});
	});

	describe('gitlab', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'gitlab:Rich-Harris/degit-test-repo',
			'git@gitlab.com:Rich-Harris/degit-test-repo',
			'https://gitlab.com/Rich-Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degit} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from gitlab!'
				});
			});
		});
	});

	describe('bitbucket', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'bitbucket:Rich_Harris/degit-test-repo',
			'git@bitbucket.org:Rich_Harris/degit-test-repo',
			'https://bitbucket.org/Rich_Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degit} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from bitbucket'
				});
			});
		});
	});

	describe('non-empty directories', () => {
		it('fails without --force', async () => {
			let succeeded;

			try {
				await exec(`node ${degit} Rich-Harris/degit-test-repo .tmp/test-repo -v`);
				succeeded = true;
			} catch (err) {
				assert.equal(err.message.trim(), `Command failed: node ${degit} Rich-Harris/degit-test-repo .tmp/test-repo -v\n[!] destination directory is not empty, aborting. Use --force to override`.trim());
			}

			assert.ok(!succeeded);
		});

		it('succeeds with --force', async () => {
			await exec(`node ${degit} Rich-Harris/degit-test-repo .tmp/test-repo -fv`);
		});
	});
});

function read(file) {
	return fs.readFileSync(file, 'utf-8');
}