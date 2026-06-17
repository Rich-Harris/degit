import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import degit from '../../src/index.js';
import {
	compareDirToExpected,
	createCopyFetch,
	createMockFetch,
	createMockGit,
} from '../helpers.js';
import {
	branchRefs,
	clearArchiveCache,
	createArchiveFixture,
	gitRefs,
	providerCases,
	refsHash,
} from './index-support.js';

export function registerTarModeFetchFailureSuite(cacheBase) {
	describe('degit index tar mode fetch failures', () => {
		providerCases.forEach((test) => {
			it(`falls back to git clone using the source transport when redirect leads to 403 for ${test.site}`, async () => {
				clearArchiveCache(cacheBase, test);
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
	});
}

function registerTarExtractionFallbackSuite(cacheBase) {
	describe('degit index tar mode extraction fallback', () => {
		it('falls back to git clone after a repeated extraction failure for github', async () => {
			const test = providerCases[0];
			const dest = '.tmp/index-suite/test-repo';
			const archiveDir = path.join(cacheBase, test.site, test.user, test.name);
			const corruptArchive = path.join('.tmp/index-suite', 'corrupt-archive.tar.gz');
			clearArchiveCache(cacheBase, test);
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
}

function registerHeadFallbackSuite(cacheBase) {
	describe('degit index tar mode HEAD fallback', () => {
		providerCases.forEach((test) => {
			it(`uses the default branch hash when HEAD is missing for ${test.site}`, async () => {
				clearArchiveCache(cacheBase, test);
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
	});
}

function registerNestedExtractionSuite(cacheBase) {
	describe('degit index tar mode nested extraction', () => {
		providerCases.forEach((test) => {
			it(`extracts a nested subdirectory when cloning a nested path for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				clearArchiveCache(cacheBase, test);
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
	});
}

function registerCachedArchiveRecoverySuite(cacheBase) {
	describe('degit index tar mode cached archive recovery', () => {
		providerCases.forEach((test) => {
			it(`redownloads the tarball when the cached archive is corrupted for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				const archiveDir = path.join(cacheBase, test.site, test.user, test.name);
				clearArchiveCache(cacheBase, test);
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
}

export function registerTarExtractionSuites(cacheBase) {
	registerTarExtractionFallbackSuite(cacheBase);
	registerHeadFallbackSuite(cacheBase);
	registerNestedExtractionSuite(cacheBase);
	registerCachedArchiveRecoverySuite(cacheBase);
}
