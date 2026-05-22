import sourceMapSupport from 'source-map-support';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { sync as rimraf } from 'rimraf';
import degit from '../src/index.js';
import { base } from '../src/utils.js';
import {
	compareDirToExpected,
	createCopyFetch,
	createMockExec,
	createMockFetch,
} from './helpers.js';

sourceMapSupport.install();

const refsHash = '0123456789abcdef0123456789abcdef0123456789';

function createProviderCase({ build, domain, publicSrc, redirectUrl, site, user }) {
	const name = 'degit-test-repo';
	const privateName = `${name}-private`;
	const url = `https://${domain}/${user}/${name}`;
	return {
		...build({ domain, name, privateName, url, user }),
		name,
		privateName,
		publicSrc,
		redirectUrl,
		site,
		url,
		user,
	};
}

const providerCases = [
	createProviderCase({
		domain: 'github.com',
		publicSrc: 'Rich-Harris/degit-test-repo',
		redirectUrl: 'https://github.com/forbidden',
		site: 'github',
		user: 'Rich-Harris',
		build: ({ domain, name, privateName, url, user }) => ({
			archiveUrl: (hash) => `${url}/archive/${hash}.tar.gz`,
			gitSrc: `https://${domain}/${user}/${privateName}.git`,
			lsRemote: `git ls-remote ${url}`,
			ssh: `git@${domain}:${user}/${name}`,
		}),
	}),
	createProviderCase({
		domain: 'gitlab.com',
		publicSrc: 'gitlab:Rich-Harris/degit-test-repo',
		redirectUrl: 'https://gitlab.com/forbidden',
		site: 'gitlab',
		user: 'Rich-Harris',
		build: ({ domain, name, privateName, url, user }) => ({
			archiveUrl: (hash) => `${url}/repository/archive.tar.gz?ref=${hash}`,
			gitSrc: `gitlab:${user}/${privateName}`,
			lsRemote: `git ls-remote ${url}`,
			ssh: `git@${domain}:${user}/${name}`,
		}),
	}),
	createProviderCase({
		domain: 'bitbucket.org',
		publicSrc: 'bitbucket:Rich_Harris/degit-test-repo',
		redirectUrl: 'https://bitbucket.org/forbidden',
		site: 'bitbucket',
		user: 'Rich_Harris',
		build: ({ domain, name, privateName, url, user }) => ({
			archiveUrl: (hash) => `${url}/get/${hash}.tar.gz`,
			gitSrc: `bitbucket:${user}/${privateName}`,
			lsRemote: `git ls-remote ${url}`,
			ssh: `git@${domain}:${user}/${name}`,
		}),
	}),
	createProviderCase({
		domain: 'git.sr.ht',
		publicSrc: 'git.sr.ht/~satotake/degit-test-repo',
		redirectUrl: 'https://git.sr.ht/forbidden',
		site: 'git.sr.ht',
		user: '~satotake',
		build: ({ domain, name, privateName, url, user }) => ({
			archiveUrl: (hash) => `${url}/archive/${hash}.tar.gz`,
			gitSrc: `git.sr.ht/${user}/${privateName}`,
			lsRemote: `git ls-remote ${url}`,
			ssh: `git@${domain}:${user}/${name}`,
		}),
	}),
];

async function createArchiveFixture(rootName) {
	fs.mkdirSync('.tmp/index-suite', { recursive: true });
	const archiveDir = fs.mkdtempSync(path.join('.tmp/index-suite', 'archive-'));
	const archiveRoot = path.join(archiveDir, rootName);

	fs.mkdirSync(path.join(archiveRoot, 'packages/app/lib'), { recursive: true });
	fs.writeFileSync(path.join(archiveRoot, 'packages/app/index.js'), 'export default 1\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/app/lib/nested.txt'), 'nested\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/ignored.txt'), 'ignored\n');

	const archiveFile = path.join(archiveDir, `${rootName}.tar.gz`);
	await tar.create({ C: archiveDir, file: archiveFile, gzip: true }, [rootName]);

	return archiveFile;
}

function clearArchiveCache(test, hash) {
	const archiveFile = path.join(base, test.site, test.user, test.name, `${hash}.tar.gz`);
	fs.rmSync(archiveFile, { force: true });
}

describe('degit index', () => {
	const indexTmp = '.tmp/index-suite';

	beforeEach(async () => await rimraf(indexTmp));
	afterEach(async () => await rimraf(indexTmp));

	it('exports a usable JS library from the built entrypoint', async () => {
		const { default: builtDegit } = await import(new URL('../dist/index.js', import.meta.url).href);
		const instance = builtDegit('Rich-Harris/degit-test-repo');

		assert.equal(typeof builtDegit, 'function');
		assert.equal(typeof instance.clone, 'function');
		assert.equal(typeof instance.on, 'function');
	});

	describe('parser', () => {
		providerCases.forEach((test) => {
			it(`parsed repo fields match expected URLs when src targets ${test.site}`, () => {
				const { repo } = degit(test.publicSrc);
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
		providerCases.forEach((test) => {
			it(`maps ${test.site} tar download failure to COULD_NOT_DOWNLOAD when redirect leads to 403`, async () => {
				clearArchiveCache(test, refsHash);
				const fetch = createMockFetch([
					{ location: test.redirectUrl, status: 302 },
					{ code: 403, message: 'Forbidden', status: 403 },
				]);
				const execMock = createMockExec({
					[test.lsRemote]: `${refsHash}\tHEAD\n`,
				});

				try {
					await degit(test.publicSrc, {
						exec: execMock.fn,
						fetch: fetch.fn,
					}).clone('.tmp/index-suite/test-repo');
					assert.fail('expected to throw');
				} catch (error) {
					assert.equal(error.code, 'COULD_NOT_DOWNLOAD');
					assert.equal(error.url, test.archiveUrl(refsHash));
				}

				assert.equal(fetch.calls.length, 2);
				assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
				assert.equal(fetch.calls[1].url, test.redirectUrl);
			});
		});
	});

	describe('tar mode extraction', () => {
		let archiveFile;

		beforeEach(async () => {
			archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`);
		});

		providerCases.forEach((test) => {
			it(`extracts a nested subdirectory for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				clearArchiveCache(test, refsHash);
				const fetch = createCopyFetch(archiveFile);
				const execMock = createMockExec({
					[test.lsRemote]: `${refsHash}\tHEAD\n`,
				});

				await degit(`${test.publicSrc}/packages/app`, {
					exec: execMock.fn,
					fetch: fetch.fn,
				}).clone(dest);

				compareDirToExpected(dest, {
					'index.js': 'export default 1\n',
					lib: '',
					'lib/nested.txt': 'nested\n',
				});
				assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
			});
		});
	});

	describe('git mode', () => {
		providerCases.forEach((test) => {
			it(`runs git clone and strips .git via injected exec when mode is git for ${test.site}`, async () => {
				const execMock = createMockExec({
					[`git clone git@${test.url.split('/')[2]}:${test.user}/${test.privateName} .tmp/index-suite/test-repo`]:
						'',
					[`rm -rf ${path.resolve('.tmp/index-suite/test-repo', '.git')}`]: '',
				});

				await degit(test.gitSrc, {
					exec: execMock.fn,
					mode: 'git',
				}).clone('.tmp/index-suite/test-repo');

				assert.deepEqual(execMock.calls, [
					`git clone git@${test.url.split('/')[2]}:${test.user}/${test.privateName} .tmp/index-suite/test-repo`,
					`rm -rf ${path.resolve('.tmp/index-suite/test-repo', '.git')}`,
				]);
			});
		});

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
	});
});
