const fs = require('fs');
const path = require('path');
const glob = require('glob');
const assert = require('assert');
const child_process = require('child_process');

const cmd = path.resolve('bin/index.js');

function exec(cmd) {
	return new Promise((fulfil, reject) => {
		child_process.exec(cmd, (err, stdout, stderr) => {
			if (err) return reject(err);
			console.log(stdout);
			console.error(stderr);
			fulfil();
		});
	});
}

describe('degit', () => {
	function compare(dir, files) {
		const expected = glob.sync('**', { cwd: dir });
		assert.deepEqual(Object.keys(files).sort(), expected.sort());

		expected.forEach(file => {
			assert.equal(files[file].trim(), read(`${dir}/${file}`).trim());
		});
	}

	describe('github', () => {
		beforeEach(() => exec('rm -rf .tmp'));

		[
			'Rich-Harris/degit-test-repo',
			'github:Rich-Harris/degit-test-repo',
			'git@github.com:Rich-Harris/degit-test-repo',
			'https://github.com/Rich-Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`${cmd} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from github!'
				});
			});
		});
	});

	describe('gitlab', () => {
		beforeEach(() => exec('rm -rf .tmp'));

		[
			'gitlab:Rich-Harris/degit-test-repo',
			'git@gitlab.com:Rich-Harris/degit-test-repo',
			'https://gitlab.com/Rich-Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`${cmd} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from gitlab!'
				});
			});
		});
	});

	describe('bitbucket', () => {
		beforeEach(() => exec('rm -rf .tmp'));

		[
			'bitbucket:Rich_Harris/degit-test-repo',
			'git@bitbucket.org:Rich_Harris/degit-test-repo',
			'https://bitbucket.org/Rich_Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`${cmd} ${src} .tmp/test-repo -v`);
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
				await exec(`${cmd} Rich-Harris/degit-test-repo .tmp/test-repo -v`);
				succeeded = true;
			} catch (err) {
				assert.equal(err.message.trim(), `Command failed: ${cmd} Rich-Harris/degit-test-repo .tmp/test-repo -v\n[!] destination directory is not empty, aborting. Use --force to override`.trim());
			}

			assert.ok(!succeeded);
		});

		it('succeeds with --force', async () => {
			await exec(`${cmd} Rich-Harris/degit-test-repo .tmp/test-repo -fv`);
		});
	});
});

function read(file) {
	return fs.readFileSync(file, 'utf-8');
}