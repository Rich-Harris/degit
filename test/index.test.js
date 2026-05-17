import sourceMapSupport from 'source-map-support';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sync as rimraf } from 'rimraf';
import degit from '../src/index.js';
import { createMockExec, createMockFetch } from './helpers.js';

sourceMapSupport.install();

describe('degit index', () => {
	const indexTmp = '.tmp/index-suite';

	beforeEach(async () => await rimraf(indexTmp));
	afterEach(async () => await rimraf(indexTmp));

	describe('parser', () => {
		[
			{
				name: 'degit-test-repo',
				site: 'github',
				src: 'Rich-Harris/degit-test-repo',
				ssh: 'git@github.com:Rich-Harris/degit-test-repo',
				url: 'https://github.com/Rich-Harris/degit-test-repo',
				user: 'Rich-Harris',
			},
			{
				name: 'degit-test-repo',
				site: 'gitlab',
				src: 'gitlab:Rich-Harris/degit-test-repo',
				ssh: 'git@gitlab.com:Rich-Harris/degit-test-repo',
				url: 'https://gitlab.com/Rich-Harris/degit-test-repo',
				user: 'Rich-Harris',
			},
			{
				name: 'degit-test-repo',
				site: 'bitbucket',
				src: 'bitbucket:Rich_Harris/degit-test-repo',
				ssh: 'git@bitbucket.org:Rich_Harris/degit-test-repo',
				url: 'https://bitbucket.org/Rich_Harris/degit-test-repo',
				user: 'Rich_Harris',
			},
			{
				name: 'degit-test-repo',
				site: 'git.sr.ht',
				src: 'git.sr.ht/~satotake/degit-test-repo',
				ssh: 'git@git.sr.ht:~satotake/degit-test-repo',
				url: 'https://git.sr.ht/~satotake/degit-test-repo',
				user: '~satotake',
			},
		].forEach((test) => {
			it(`parsed repo fields match expected URLs when src targets ${test.site}`, () => {
				const { repo } = degit(test.src);
				assert.equal(repo.site, test.site);
				assert.equal(repo.user, test.user);
				assert.equal(repo.name, test.name);
				assert.equal(repo.url, test.url);
				assert.equal(repo.ssh, test.ssh);
			});
		});

		it('throws UNSUPPORTED_HOST when the host prefix is not supported', () => {
			assert.throws(
				() => {
					degit('codeberg:Rich-Harris/degit-test-repo');
				},
				(err) => err && err.code === 'UNSUPPORTED_HOST',
			);
		});
	});

	describe('tar mode fetch failures', () => {
		const refsHash = '0123456789abcdef0123456789abcdef0123456789';

		it('maps GitLab tar download failure to COULD_NOT_DOWNLOAD when redirect leads to 403', async () => {
			const fetch = createMockFetch([
				{ location: 'https://gitlab.com/forbidden', status: 302 },
				{ message: 'Forbidden', status: 403 },
			]);
			const execMock = createMockExec({
				'git ls-remote https://gitlab.com/Rich-Harris/degit-test-repo': `${refsHash}\tHEAD\n`,
			});

			try {
				await degit('gitlab:Rich-Harris/degit-test-repo', {
					exec: execMock.fn,
					fetch: fetch.fn,
				}).clone('.tmp/index-suite/test-repo');
				assert.fail('expected to throw');
			} catch (error) {
				assert.equal(error.code, 'COULD_NOT_DOWNLOAD');
				assert.equal(
					error.url,
					`https://gitlab.com/Rich-Harris/degit-test-repo/repository/archive.tar.gz?ref=${refsHash}`,
				);
			}

			assert.equal(fetch.calls.length, 2);
			assert.equal(
				fetch.calls[0].url,
				`https://gitlab.com/Rich-Harris/degit-test-repo/repository/archive.tar.gz?ref=${refsHash}`,
			);
			assert.equal(fetch.calls[1].url, 'https://gitlab.com/forbidden');
		});

		it('maps SourceHut tar download failure to COULD_NOT_DOWNLOAD when redirect leads to 403', async () => {
			const fetch = createMockFetch([
				{ location: 'https://git.sr.ht/forbidden', status: 302 },
				{ code: 403, message: 'Forbidden', status: 403 },
			]);
			const execMock = createMockExec({
				'git ls-remote https://git.sr.ht/~satotake/degit-test-repo': `${refsHash}\tHEAD\n`,
			});

			try {
				await degit('git.sr.ht/~satotake/degit-test-repo', {
					exec: execMock.fn,
					fetch: fetch.fn,
				}).clone('.tmp/index-suite/test-repo');
				assert.fail('expected to throw');
			} catch (error) {
				assert.equal(error.code, 'COULD_NOT_DOWNLOAD');
				assert.equal(
					error.url,
					`https://git.sr.ht/~satotake/degit-test-repo/archive/${refsHash}.tar.gz`,
				);
			}

			assert.equal(fetch.calls.length, 2);
			assert.equal(
				fetch.calls[0].url,
				`https://git.sr.ht/~satotake/degit-test-repo/archive/${refsHash}.tar.gz`,
			);
			assert.equal(fetch.calls[1].url, 'https://git.sr.ht/forbidden');
		});
	});

	describe('git mode', () => {
		it('clone rejects with DEST_NOT_EMPTY when destination has files and force is false', async () => {
			fs.mkdirSync('.tmp/index-suite/ne', { recursive: true });
			fs.writeFileSync('.tmp/index-suite/ne/x', '1');
			await assert.rejects(
				async () => await degit('Rich-Harris/degit-test-repo').clone('.tmp/index-suite/ne'),
				(err) => err && err.code === 'DEST_NOT_EMPTY',
			);
		});

		it('constructor throws when mode is not a supported value', () => {
			assert.throws(
				() => degit('Rich-Harris/degit-test-repo', { mode: 'svn' }),
				/Valid modes are/,
			);
		});

		it('runs git clone and strips .git via injected exec when mode is git', async () => {
			const execMock = createMockExec({
				'git clone git@github.com:Rich-Harris/degit-test-repo-private .tmp/index-suite/test-repo':
					'',
				[`rm -rf ${path.resolve('.tmp/index-suite/test-repo', '.git')}`]: '',
			});

			await degit('https://github.com/Rich-Harris/degit-test-repo-private.git', {
				exec: execMock.fn,
				mode: 'git',
			}).clone('.tmp/index-suite/test-repo');

			assert.deepEqual(execMock.calls, [
				'git clone git@github.com:Rich-Harris/degit-test-repo-private .tmp/index-suite/test-repo',
				`rm -rf ${path.resolve('.tmp/index-suite/test-repo', '.git')}`,
			]);
		});
	});
});
