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

const { suiteCache, suiteTmp } = vi.hoisted(() => ({
	suiteCache: '.tmp/index-tar-suite-cache',
	suiteTmp: '.tmp/index-tar-suite',
}));

function expectPackageArchive(dest: string) {
	compareDirToExpected(dest, {
		packages: '',
		'packages/app': '',
		'packages/app/index.js': 'export default 1\n',
		'packages/app/lib': '',
		'packages/app/lib/nested.txt': 'nested\n',
		'packages/ignored.txt': 'ignored\n',
	});
}

vi.mock('../../src/shared/utils.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/shared/utils.js')>(
		'../../src/shared/utils.js',
	);

	return {
		...actual,
		base: path.join(process.cwd(), suiteCache),
	};
});

/* eslint-disable max-lines-per-function */
describe('degit index tar suites', () => {
	beforeEach(() => fs.rmSync(suiteTmp, { force: true, recursive: true }));
	afterEach(() => fs.rmSync(suiteTmp, { force: true, recursive: true }));

	providerCases.forEach((test) => {
		it(`falls back to git clone using the source transport when redirect leads to 403 for ${test.site}`, async () => {
			clearArchiveCache(suiteCache, test);
			const fetch = createMockFetch([
				{ location: test.redirectUrl, status: 302 },
				{ code: 403, message: 'Forbidden', status: 403 },
			]);
			const gitMock = createMockGit({
				[`fetchRefs ${test.url}`]: gitRefs,
				[`clone ${test.url} ${suiteTmp}/test-repo HEAD`]: '',
			});

			await degit(test.publicSrc, {
				git: gitMock.fn,
				fetch: fetch.fn,
			}).clone(`${suiteTmp}/test-repo`);

			assert.equal(fetch.calls.length, 2);
			assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
			assert.equal(fetch.calls[1].url, test.redirectUrl);
			assert.deepEqual(gitMock.calls, [
				`fetchRefs ${test.url}`,
				`clone ${test.url} ${suiteTmp}/test-repo HEAD`,
			]);
		});
	});

	it('falls back to git clone when a repeated extraction failure occurs for github', async () => {
		const test = providerCases[0];
		const dest = `${suiteTmp}/test-repo`;
		const archiveDir = path.join(suiteCache, test.site, test.user, test.name);
		const corruptArchive = path.join(suiteTmp, 'corrupt-archive.tar.gz');
		clearArchiveCache(suiteCache, test);
		fs.mkdirSync(suiteTmp, { recursive: true });
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

	providerCases.forEach((test) => {
		it(`uses the default branch hash when HEAD is missing for ${test.site}`, async () => {
			clearArchiveCache(suiteCache, test);
			const fetch = createCopyFetch(
				await createArchiveFixture(`degit-test-repo-${refsHash}`, suiteTmp),
			);
			const gitMock = createMockGit({
				[`fetchRefs ${test.url}`]: branchRefs,
			});

			await degit(test.publicSrc, {
				git: gitMock.fn,
				fetch: fetch.fn,
			}).clone(`${suiteTmp}/test-repo`);

			expectPackageArchive(`${suiteTmp}/test-repo`);
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
			(err: any) => err?.code === 'MISSING_REF',
		);
	});

	providerCases.forEach((test) => {
		it(`extracts a nested subdirectory when cloning a nested path for ${test.site}`, async () => {
			const dest = `${suiteTmp}/test-repo`;
			clearArchiveCache(suiteCache, test);
			const archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`, suiteTmp);
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
			const dest = `${suiteTmp}/test-repo`;
			const archiveDir = path.join(suiteCache, test.site, test.user, test.name);
			clearArchiveCache(suiteCache, test);
			const archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`, suiteTmp);
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

			expectPackageArchive(dest);
			assert.equal(fetch.calls.length, 1);
			assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
		});
	});
});
/* eslint-enable max-lines-per-function */
