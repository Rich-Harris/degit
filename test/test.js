require('source-map-support').install();

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const rimraf = require('rimraf').sync;
const assert = require('assert');
const child_process = require('child_process');

const degit = require('../index.js');
const degitPath = path.resolve('bin.js');

const timeout = 30000;

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

describe('degit', function() {
	this.timeout(timeout);

	function compare(dir, files) {
		const expected = glob.sync('**', { cwd: dir });
		assert.deepEqual(Object.keys(files).sort(), expected.sort());

		expected.forEach(file => {
			if (!fs.lstatSync(`${dir}/${file}`).isDirectory()) {
				assert.equal(files[file].trim(), read(`${dir}/${file}`).trim());
			}
		});
	}

	after(async () => await rimraf('.tmp'));

	describe('github', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'mhkeller/degit-test-repo-compose',
			'Rich-Harris/degit-test-repo',
			'github:Rich-Harris/degit-test-repo',
			'git@github.com:Rich-Harris/degit-test-repo',
			'https://github.com/Rich-Harris/degit-test-repo.git',
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from github!',
				});
			});
		});
	});

	describe('gitlab', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'gitlab:Rich-Harris/degit-test-repo',
			'git@gitlab.com:Rich-Harris/degit-test-repo',
			'https://gitlab.com/Rich-Harris/degit-test-repo.git',
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from gitlab!',
				});
			});
		});
	});

	describe('bitbucket', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'bitbucket:Rich_Harris/degit-test-repo',
			'git@bitbucket.org:Rich_Harris/degit-test-repo',
			'https://bitbucket.org/Rich_Harris/degit-test-repo.git',
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from bitbucket',
				});
			});
		});
	});

	describe('sourcehat', () => {
		beforeEach(() => rimraf('.tmp'));

		[
			'git.sr.ht/~satotake/degit-test-repo',
			'https://git.sr.ht/~satotake/degit-test-repo',
			'git@git.sr.ht:~satotake/degit-test-repo',
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from sourcehat!',
				});
			});
		});
	});

	describe('non-empty directories', () => {
		it('fails without --force', async () => {
			let succeeded;

			try {
				await exec(`echo "not empty" > .tmp/test-repo/file.txt`);
				await exec(
					`node ${degitPath} Rich-Harris/degit-test-repo .tmp/test-repo -v`
				);
				succeeded = true;
			} catch (err) {
				assert.ok(/destination directory is not empty/.test(err.message));
			}

			assert.ok(!succeeded);
		});

		it('succeeds with --force', async () => {
			await exec(
				`node ${degitPath} Rich-Harris/degit-test-repo .tmp/test-repo -fv`
			);
		});
	});

	describe('command line arguments', () => {
		it('allows flags wherever', async () => {
			await rimraf('.tmp');

			await exec(
				`node ${degitPath} -v Rich-Harris/degit-test-repo .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {
				'file.txt': 'hello from github!',
			});
		});
	});

	describe('api', () => {
		it('is usable from node scripts', async () => {
			await degit('Rich-Harris/degit-test-repo', { force: true }).clone(
				'.tmp/test-repo'
			);

			compare(`.tmp/test-repo`, {
				'file.txt': 'hello from github!',
			});
		});
	});

	describe('actions', () => {
		it('removes specified file', async () => {
			await rimraf('.tmp');

			await exec(
				`node ${degitPath} -v mhkeller/degit-test-repo-remove-only .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {});
		});

		it('clones repo and removes specified file', async () => {
			await rimraf('.tmp');

			await exec(
				`node ${degitPath} -v mhkeller/degit-test-repo-remove .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {
				'other.txt': 'hello from github!',
			});
		});

		it('removes and adds nested files', async () => {
			await rimraf('.tmp');

			await exec(
				`node ${degitPath} -v mhkeller/degit-test-repo-nested-actions .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {
				dir: '',
				folder: '',
				'folder/file.txt': 'hello from clobber file!',
				'folder/other.txt': 'hello from other file!',
			});
		});
	});
});

function read(file) {
	return fs.readFileSync(file, 'utf-8');
}
