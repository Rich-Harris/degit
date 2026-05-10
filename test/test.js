require('source-map-support').install();

const fs = require('fs');
const path = require('path');
const glob = require('tiny-glob/sync');
const rimraf = require('rimraf').sync;
const assert = require('assert');
const child_process = require('child_process');

const degit = require('../dist/index.js');
const degitPath = path.resolve('dist/bin.js');

const timeout = 30000;
const runIntegration = process.env.INTEGRATION_TESTS === '1';
const liveDescribe = runIntegration ? describe : describe.skip;

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

function createMockExec(stubs = {}) {
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

function createMockFetch(steps) {
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

describe('degit', function() {
	this.timeout(timeout);

	function compare(dir, files) {
		const expected = glob('**', { cwd: dir });
		assert.deepEqual(Object.keys(files).sort(), expected.sort());

		expected.forEach(file => {
			if (!fs.lstatSync(`${dir}/${file}`).isDirectory()) {
				assert.equal(files[file].trim(), read(`${dir}/${file}`).trim());
			}
		});
	}

	beforeEach(async () => await rimraf('.tmp'));
	afterEach(async () => await rimraf('.tmp'));

	describe('parser', () => {
		[
			{
				src: 'Rich-Harris/degit-test-repo',
				site: 'github',
				user: 'Rich-Harris',
				name: 'degit-test-repo',
				url: 'https://github.com/Rich-Harris/degit-test-repo',
				ssh: 'git@github.com:Rich-Harris/degit-test-repo'
			},
			{
				src: 'gitlab:Rich-Harris/degit-test-repo',
				site: 'gitlab',
				user: 'Rich-Harris',
				name: 'degit-test-repo',
				url: 'https://gitlab.com/Rich-Harris/degit-test-repo',
				ssh: 'git@gitlab.com:Rich-Harris/degit-test-repo'
			},
			{
				src: 'bitbucket:Rich_Harris/degit-test-repo',
				site: 'bitbucket',
				user: 'Rich_Harris',
				name: 'degit-test-repo',
				url: 'https://bitbucket.org/Rich_Harris/degit-test-repo',
				ssh: 'git@bitbucket.org:Rich_Harris/degit-test-repo'
			},
			{
				src: 'git.sr.ht/~satotake/degit-test-repo',
				site: 'git.sr.ht',
				user: '~satotake',
				name: 'degit-test-repo',
				url: 'https://git.sr.ht/~satotake/degit-test-repo',
				ssh: 'git@git.sr.ht:~satotake/degit-test-repo'
			}
		].forEach(test => {
			it(`parses ${test.site} sources`, () => {
				const repo = degit(test.src).repo;
				assert.equal(repo.site, test.site);
				assert.equal(repo.user, test.user);
				assert.equal(repo.name, test.name);
				assert.equal(repo.url, test.url);
				assert.equal(repo.ssh, test.ssh);
			});
		});

		it('rejects unsupported hosts', () => {
			const error = assert.throws(() => {
				degit('codeberg:Rich-Harris/degit-test-repo');
			});
			assert.equal(error.code, 'UNSUPPORTED_HOST');
		});
	});

	describe('tar mode fetch failures', () => {
		const refsHash = '0123456789abcdef0123456789abcdef0123456789';

		it('maps gitlab redirect + 403 to COULD_NOT_DOWNLOAD', async () => {
			const fetch = createMockFetch([
				{ status: 302, location: 'https://gitlab.com/forbidden' },
				{ status: 403, message: 'Forbidden' }
			]);
			const execMock = createMockExec({
				'git ls-remote https://gitlab.com/Rich-Harris/degit-test-repo': `${refsHash}\tHEAD\n`
			});

			try {
				await degit('gitlab:Rich-Harris/degit-test-repo', {
					fetch: fetch.fn,
					exec: execMock.fn
				}).clone('.tmp/test-repo');
				assert.fail('expected to throw');
			} catch (error) {
				assert.equal(error.code, 'COULD_NOT_DOWNLOAD');
				assert.equal(
					error.url,
					`https://gitlab.com/Rich-Harris/degit-test-repo/repository/archive.tar.gz?ref=${refsHash}`
				);
			}

			assert.equal(fetch.calls.length, 2);
			assert.equal(
				fetch.calls[0].url,
				`https://gitlab.com/Rich-Harris/degit-test-repo/repository/archive.tar.gz?ref=${refsHash}`
			);
			assert.equal(fetch.calls[1].url, 'https://gitlab.com/forbidden');
		});

		it('maps sourcehut redirect + 403 to COULD_NOT_DOWNLOAD', async () => {
			const fetch = createMockFetch([
				{ status: 302, location: 'https://git.sr.ht/forbidden' },
				{ status: 403, code: 403, message: 'Forbidden' }
			]);
			const execMock = createMockExec({
				'git ls-remote https://git.sr.ht/~satotake/degit-test-repo': `${refsHash}\tHEAD\n`
			});

			try {
				await degit('git.sr.ht/~satotake/degit-test-repo', {
					fetch: fetch.fn,
					exec: execMock.fn
				}).clone('.tmp/test-repo');
				assert.fail('expected to throw');
			} catch (error) {
				assert.equal(error.code, 'COULD_NOT_DOWNLOAD');
				assert.equal(
					error.url,
					`https://git.sr.ht/~satotake/degit-test-repo/archive/${refsHash}.tar.gz`
				);
			}

			assert.equal(fetch.calls.length, 2);
			assert.equal(
				fetch.calls[0].url,
				`https://git.sr.ht/~satotake/degit-test-repo/archive/${refsHash}.tar.gz`
			);
			assert.equal(fetch.calls[1].url, 'https://git.sr.ht/forbidden');
		});
	});

	liveDescribe('github', () => {
		[
			'mhkeller/degit-test-repo-compose',
			'Rich-Harris/degit-test-repo',
			'github:Rich-Harris/degit-test-repo',
			'git@github.com:Rich-Harris/degit-test-repo',
			'https://github.com/Rich-Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from github!',
					subdir: null,
					'subdir/file.txt': 'hello from a subdirectory!'
				});
			});
		});
	});

	liveDescribe('gitlab', () => {
		[
			'gitlab:Rich-Harris/degit-test-repo',
			'git@gitlab.com:Rich-Harris/degit-test-repo',
			'https://gitlab.com/Rich-Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from gitlab!'
				});
			});
		});
	});

	liveDescribe('bitbucket', () => {
		[
			'bitbucket:Rich_Harris/degit-test-repo',
			'git@bitbucket.org:Rich_Harris/degit-test-repo',
			'https://bitbucket.org/Rich_Harris/degit-test-repo.git'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from bitbucket'
				});
			});
		});
	});

	liveDescribe('Sourcehut', () => {
		[
			'git.sr.ht/~satotake/degit-test-repo',
			'https://git.sr.ht/~satotake/degit-test-repo',
			'git@git.sr.ht:~satotake/degit-test-repo'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from sourcehut!'
				});
			});
		});
	});

	liveDescribe('Subdirectories', () => {
		[
			'Rich-Harris/degit-test-repo/subdir',
			'github:Rich-Harris/degit-test-repo/subdir',
			'git@github.com:Rich-Harris/degit-test-repo/subdir',
			'https://github.com/Rich-Harris/degit-test-repo.git/subdir'
		].forEach(src => {
			it(src, async () => {
				await exec(`node ${degitPath} ${src} .tmp/test-repo -v`);
				compare(`.tmp/test-repo`, {
					'file.txt': 'hello from a subdirectory!'
				});
			});
		});
	});

	liveDescribe('non-empty directories', () => {
		it('fails without --force', async () => {
			let succeeded;

			try {
				await exec(`mkdir -p .tmp/test-repo`);
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

	liveDescribe('command line arguments', () => {
		it('allows flags wherever', async () => {
			await exec(
				`node ${degitPath} -v Rich-Harris/degit-test-repo .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {
				'file.txt': 'hello from github!',
				subdir: null,
				'subdir/file.txt': 'hello from a subdirectory!'
			});
		});
	});

	liveDescribe('api', () => {
		it('is usable from node scripts', async () => {
			await degit('Rich-Harris/degit-test-repo', { force: true }).clone(
				'.tmp/test-repo'
			);

			compare(`.tmp/test-repo`, {
				'file.txt': 'hello from github!',
				subdir: null,
				'subdir/file.txt': 'hello from a subdirectory!'
			});
		});
	});

	liveDescribe('actions', () => {
		it('removes specified file', async () => {
			await exec(
				`node ${degitPath} -v mhkeller/degit-test-repo-remove-only .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {});
		});

		it('clones repo and removes specified file', async () => {
			await exec(
				`node ${degitPath} -v mhkeller/degit-test-repo-remove .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {
				'other.txt': 'hello from github!',
				subdir: null,
				'subdir/file.txt': 'hello from a subdirectory!'
			});
		});

		it('removes and adds nested files', async () => {
			await rimraf('.tmp');

			await exec(
				`node ${degitPath} -v mhkeller/degit-test-repo-nested-actions .tmp/test-repo`
			);
			compare(`.tmp/test-repo`, {
				dir: null,
				folder: null,
				subdir: null,
				'folder/file.txt': 'hello from clobber file!',
				'folder/other.txt': 'hello from other file!',
				'subdir/file.txt': 'hello from a subdirectory!'
			});
		});
	});

	describe('git mode', () => {
		it('uses injected exec for command invocation', async () => {
			const execMock = createMockExec({
				'git clone git@github.com:Rich-Harris/degit-test-repo-private .tmp/test-repo': '',
				[`rm -rf ${path.resolve('.tmp/test-repo', '.git')}`]: ''
			});

			await degit('https://github.com/Rich-Harris/degit-test-repo-private.git', {
				mode: 'git',
				exec: execMock.fn
			}).clone('.tmp/test-repo');

			assert.deepEqual(execMock.calls, [
				'git clone git@github.com:Rich-Harris/degit-test-repo-private .tmp/test-repo',
				`rm -rf ${path.resolve('.tmp/test-repo', '.git')}`
			]);
		});

		(runIntegration ? it : it.skip)(
			'is able to clone correctly using git mode',
			async () => {
				await rimraf('.tmp');

				await exec(
					`node ${degitPath} --mode=git https://github.com/Rich-Harris/degit-test-repo-private.git .tmp/test-repo`
				);
				compare('.tmp/test-repo', {
					'file.txt': 'hello from a private repo!'
				});
			}
		);
	});
});

function read(file) {
	return fs.readFileSync(file, 'utf-8');
}
