import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import degit from '../../src/index.js';
import {
	createArchiveFixture,
	createArchiveWithGitLfsPointerFixture,
	providerCases,
	refsHash,
	cloneAndExpectGitFallback,
	cloneAndExpectTarContent,
	clearArchiveCache,
	gitRefs,
} from './index-support.js';
import { createMockGit } from '../helpers.js';

const { suiteCache, suiteTmp } = vi.hoisted(() => ({
	suiteCache: '.tmp/index-git-suite-cache',
	suiteTmp: '.tmp/index-git-suite',
}));

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
describe('degit index git suites', () => {
	beforeEach(() => fs.rmSync(suiteTmp, { force: true, recursive: true }));
	afterEach(() => fs.rmSync(suiteTmp, { force: true, recursive: true }));

	it('uses the git backend for ssh sources when mode is git', async () => {
		const dest = `${suiteTmp}/ssh-git-mode`;
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

	providerCases.forEach((test) => {
		it(`uses the git backend immediately when mode is git for ${test.site}`, async () => {
			const dest = `${suiteTmp}/test-repo`;
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
		const dest = `${suiteTmp}/windows-git-mode`;
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

	providerCases.forEach((test) => {
		it(`does not fall back when a file merely quotes a pointer snippet for ${test.site}`, async () => {
			const dest = `${suiteTmp}/test-repo`;
			clearArchiveCache(suiteCache, test);
			const archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`, suiteTmp);
			await cloneAndExpectTarContent(
				test,
				archiveFile,
				dest,
				'packages/app/index.js',
				'export default 1\n',
			);
		});
	});

	providerCases.forEach((test) => {
		it(`falls back to git clone when the tarball contains git-lfs pointers for ${test.site}`, async () => {
			const dest = `${suiteTmp}/test-repo`;
			clearArchiveCache(suiteCache, test);
			const archiveFile = await createArchiveWithGitLfsPointerFixture(
				`degit-test-repo-${refsHash}`,
				suiteTmp,
			);
			await cloneAndExpectGitFallback(test, archiveFile, dest);
		});
	});
});
/* eslint-enable max-lines-per-function */
