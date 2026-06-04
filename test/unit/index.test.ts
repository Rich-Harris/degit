import sourceMapSupport from 'source-map-support';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { sync as rimraf } from 'rimraf';
import degit from '../../src/index.js';
import { base } from '../../src/utils.js';
import {
	compareDirToExpected,
	createCopyFetch,
	createMockGit,
	createMockFetch,
} from '../helpers.js';

sourceMapSupport.install();

const refsHash = '0123456789abcdef0123456789abcdef0123456789';
const gitRefs = [{ hash: refsHash, type: 'HEAD' }];
const branchRefs = [{ hash: refsHash, name: 'main', type: 'branch' }];

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
			lsRemote: `git ls-remote -- ${url}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
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
			lsRemote: `git ls-remote -- ${url}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
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
			lsRemote: `git ls-remote -- ${url}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
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
			lsRemote: `git ls-remote -- ${url}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
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

function clearArchiveCache(test, _hash) {
	const archiveDir = path.join(base, test.site, test.user, test.name);
	fs.rmSync(archiveDir, { force: true, recursive: true });
}

describe('degit index', () => {
	const indexTmp = '.tmp/index-suite';

	beforeEach(async () => await rimraf(indexTmp));
	afterEach(async () => await rimraf(indexTmp));

	it('exports a usable JS library when importing the built entrypoint', async () => {
		const builtEntryPoint = path.resolve(process.cwd(), 'dist/index.js');
		const { default: builtDegit } = await import(new URL(`file://${builtEntryPoint}`).href);
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
				assert.equal(repo.transport, 'https');
			});
		});

		it('parses explicit ssh sources as ssh transport', () => {
			const { repo } = degit('git@github.com:Rich-Harris/degit-test-repo');

			assert.equal(repo.transport, 'ssh');
			assert.equal(repo.ssh, 'ssh://git@github.com/Rich-Harris/degit-test-repo');
		});

		it('throws UNSUPPORTED_HOST when the host prefix is not supported', () => {
			assert.throws(
				() => {
					degit('codeberg:Rich-Harris/degit-test-repo');
				},
				(err: any) => err && err.code === 'UNSUPPORTED_HOST',
			);
		});
	});

	describe('tar mode fetch failures', () => {
		providerCases.forEach((test) => {
			it(`falls back to git clone using the source transport when redirect leads to 403 for ${test.site}`, async () => {
				clearArchiveCache(test, refsHash);
				const fetch = createMockFetch([
					{ location: test.redirectUrl, status: 302 },
					{ code: 403, message: 'Forbidden', status: 403 },
				]);
				const gitMock = createMockGit({
					[`fetchRefs ${test.url}`]: gitRefs,
					[`clone ${test.url} .tmp/index-suite/test-repo HEAD`]: '',
				});

				await degit(test.publicSrc, {
					git: gitMock.fn,
					fetch: fetch.fn,
				}).clone('.tmp/index-suite/test-repo');

				assert.equal(fetch.calls.length, 2);
				assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
				assert.equal(fetch.calls[1].url, test.redirectUrl);
				assert.deepEqual(gitMock.calls, [
					`fetchRefs ${test.url}`,
					`clone ${test.url} .tmp/index-suite/test-repo HEAD`,
				]);
			});
		});

		it('falls back to git clone after a repeated extraction failure for github', async () => {
			const test = providerCases[0];
			const dest = '.tmp/index-suite/test-repo';
			const archiveDir = path.join(base, test.site, test.user, test.name);
			const corruptArchive = path.join('.tmp/index-suite', 'corrupt-archive.tar.gz');
			clearArchiveCache(test, refsHash);
			fs.mkdirSync('.tmp/index-suite', { recursive: true });
			fs.mkdirSync(archiveDir, { recursive: true });
			fs.writeFileSync(path.join(archiveDir, `${refsHash}.tar.gz`), 'not a tarball');
			fs.writeFileSync(corruptArchive, 'not a tarball');
			const fetch = createCopyFetch(corruptArchive);
			const gitMock = createMockGit({
				[`fetchRefs ${test.url}`]: gitRefs,
				[`clone ${test.url} ${dest} HEAD`]: '',
			});

			await degit(test.publicSrc, {
				git: gitMock.fn,
				fetch: fetch.fn,
			}).clone(dest);

			assert.equal(fetch.calls.length, 1);
			assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
			assert.deepEqual(gitMock.calls, [
				`fetchRefs ${test.url}`,
				`clone ${test.url} ${dest} HEAD`,
			]);
		});
	});

	describe('tar mode HEAD fallback', () => {
		providerCases.forEach((test) => {
			it(`uses the default branch hash when HEAD is missing for ${test.site}`, async () => {
				clearArchiveCache(test, refsHash);
				const fetch = createCopyFetch(
					await createArchiveFixture(`degit-test-repo-${refsHash}`),
				);
				const gitMock = createMockGit({
					[`fetchRefs ${test.url}`]: branchRefs,
				});

				await degit(test.publicSrc, {
					git: gitMock.fn,
					fetch: fetch.fn,
				}).clone('.tmp/index-suite/test-repo');

				compareDirToExpected('.tmp/index-suite/test-repo', {
					packages: '',
					'packages/app': '',
					'packages/app/index.js': 'export default 1\n',
					'packages/app/lib': '',
					'packages/app/lib/nested.txt': 'nested\n',
					'packages/ignored.txt': 'ignored\n',
				});
				assert.equal(fetch.calls.length, 1);
				assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
				assert.deepEqual(gitMock.calls, [`fetchRefs ${test.url}`]);
			});
		});

		it('throws MISSING_REF when no refs are returned for HEAD', async () => {
			const test = providerCases[1];
			const dest = '.tmp/index-suite/empty-refs';
			const gitMock = createMockGit({
				[`fetchRefs ${test.url}`]: [],
			});

			await assert.rejects(
				async () => await degit(test.publicSrc, { git: gitMock.fn }).clone(dest),
				(err: any) => err && err.code === 'MISSING_REF',
			);
		});

		it('uses the git backend for ssh sources when mode is git', async () => {
			const dest = '.tmp/index-suite/ssh-git-mode';
			const gitMock = createMockGit({
				[`fetchRefs ssh://git@github.com/Rich-Harris/degit-test-repo`]: gitRefs,
				[`clone ssh://git@github.com/Rich-Harris/degit-test-repo ${dest} ${refsHash}`]: '',
			});

			await degit('git@github.com:Rich-Harris/degit-test-repo', {
				git: gitMock.fn,
				mode: 'git',
			}).clone(dest);

			assert.deepEqual(gitMock.calls, [
				'fetchRefs ssh://git@github.com/Rich-Harris/degit-test-repo',
				`clone ssh://git@github.com/Rich-Harris/degit-test-repo ${dest} ${refsHash}`,
			]);
		});
	});

	describe('tar mode extraction', () => {
		providerCases.forEach((test) => {
			it(`extracts a nested subdirectory when cloning a nested path for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				clearArchiveCache(test, refsHash);
				const archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`);
				const fetch = createCopyFetch(archiveFile);
				const gitMock = createMockGit({
					[`fetchRefs ${test.url}`]: gitRefs,
				});

				await degit(`${test.publicSrc}/packages/app`, {
					git: gitMock.fn,
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

		providerCases.forEach((test) => {
			it(`redownloads the tarball when the cached archive is corrupted for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				const archiveDir = path.join(base, test.site, test.user, test.name);
				clearArchiveCache(test, refsHash);
				const archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`);
				fs.mkdirSync(archiveDir, { recursive: true });
				fs.writeFileSync(path.join(archiveDir, `${refsHash}.tar.gz`), 'not a tarball');
				const fetch = createCopyFetch(archiveFile);
				const gitMock = createMockGit({
					[`fetchRefs ${test.url}`]: gitRefs,
				});

				await degit(test.publicSrc, {
					git: gitMock.fn,
					fetch: fetch.fn,
				}).clone(dest);

				compareDirToExpected(dest, {
					packages: '',
					'packages/app': '',
					'packages/app/index.js': 'export default 1\n',
					'packages/app/lib': '',
					'packages/app/lib/nested.txt': 'nested\n',
					'packages/ignored.txt': 'ignored\n',
				});
				assert.equal(fetch.calls.length, 1);
				assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
			});
		});
	});

	describe('explicit git mode', () => {
		providerCases.forEach((test) => {
			it(`uses the git backend immediately when mode is git for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				const gitMock = createMockGit({
					[`fetchRefs ${test.url}`]: gitRefs,
					[`clone ${test.url} ${dest} ${refsHash}`]: '',
				});
				const warnings: string[] = [];
				const emitter = degit(test.publicSrc, {
					git: gitMock.fn,
					mode: 'git',
				});

				emitter.on('warn', (event) => warnings.push(event.message));

				await emitter.clone(dest);

				assert.deepEqual(warnings, []);
				assert.deepEqual(gitMock.calls, [
					`fetchRefs ${test.url}`,
					`clone ${test.url} ${dest} ${refsHash}`,
				]);
			});
		});

		it('uses the git backend on Windows when mode is git', async () => {
			const test = providerCases[0];
			const dest = '.tmp/index-suite/windows-git-mode';
			const gitMock = createMockGit({
				[`fetchRefs ${test.url}`]: gitRefs,
				[`clone ${test.url} ${dest} ${refsHash}`]: '',
			});
			const warnings: string[] = [];

			const emitter = degit(test.publicSrc, {
				git: gitMock.fn,
				mode: 'git',
				platform: 'win32',
			});

			emitter.on('warn', (event) => warnings.push(event.message));

			await emitter.clone(dest);

			assert.deepEqual(warnings, []);
			assert.deepEqual(gitMock.calls, [
				`fetchRefs ${test.url}`,
				`clone ${test.url} ${dest} ${refsHash}`,
			]);
		});

		it('rejects with DEST_NOT_EMPTY when destination has files and force is false', async () => {
			fs.mkdirSync('.tmp/index-suite/ne', { recursive: true });
			fs.writeFileSync('.tmp/index-suite/ne/x', '1');
			await assert.rejects(
				async () => await degit('Rich-Harris/degit-test-repo').clone('.tmp/index-suite/ne'),
				(err: any) => err && err.code === 'DEST_NOT_EMPTY',
			);
		});

		it('throws when mode is not a supported value', () => {
			assert.throws(
				() => degit('Rich-Harris/degit-test-repo', { mode: 'svn' }),
				/Valid modes are/,
			);
		});
	});
});
