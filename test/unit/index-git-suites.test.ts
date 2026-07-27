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
import { createMockFetch, createMockGit } from '../helpers.js';
import type { Repo } from '../../src/domain/repo.js';

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
			const archiveFile = await createArchiveFixture(test.archiveRoot, suiteTmp);
			expect(fs.existsSync(archiveFile)).toBe(true);
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
				test.archiveRoot,
				suiteTmp,
			);
			expect(fs.existsSync(archiveFile)).toBe(true);
			await cloneAndExpectGitFallback(test, archiveFile, dest);
		});
	});

	function createFileWritingGitMock(files: Record<string, string>) {
		return {
			fetchRefs(_repo: Repo) {
				return Promise.resolve(gitRefs);
			},
			clone(_repo: Repo, cloneDest: string) {
				for (const [file, content] of Object.entries(files)) {
					const filePath = path.join(cloneDest, file);
					fs.mkdirSync(path.dirname(filePath), { recursive: true });
					fs.writeFileSync(filePath, content);
				}
				return Promise.resolve();
			},
		};
	}

	it('sets repo.mode to git in the instance when mode is git', () => {
		const emitter = degit('Rich-Harris/degit-test-repo', { mode: 'git' });
		assert.equal(emitter.repo.mode, 'git');
	});

	it('defaults repo.mode to tar when no mode is provided', () => {
		const emitter = degit('Rich-Harris/degit-test-repo');
		assert.equal(emitter.repo.mode, 'tar');
	});

	it('extracts only the subdirectory when mode is git with subdir', async () => {
		const test = providerCases[0];
		const dest = `${suiteTmp}/git-subdir`;
		const gitMock = createFileWritingGitMock({
			'packages/app/index.js': 'export default 1\n',
			'README.md': 'hello',
		});

		await degit(`${test.publicSrc}/packages/app`, {
			git: gitMock,
			mode: 'git',
		}).clone(dest);

		assert.equal(fs.existsSync(path.join(dest, 'index.js')), true);
		assert.equal(fs.readFileSync(path.join(dest, 'index.js'), 'utf8'), 'export default 1\n');
		assert.equal(fs.existsSync(path.join(dest, 'README.md')), false);
		assert.equal(fs.existsSync(path.join(dest, 'packages')), false);
	});

	it('throws MISSING_SUBDIR when the subdirectory does not exist in git mode', async () => {
		const test = providerCases[0];
		const dest = `${suiteTmp}/git-missing-subdir`;
		const gitMock = createFileWritingGitMock({
			'README.md': 'hello',
		});

		await assert.rejects(
			degit(`${test.publicSrc}/packages/app`, {
				git: gitMock,
				mode: 'git',
			}).clone(dest),
			(err: unknown) => (err as { code?: string }).code === 'MISSING_SUBDIR',
		);
	});

	it('clones the full repository in git mode when no subdirectory is requested', async () => {
		const test = providerCases[0];
		const dest = `${suiteTmp}/git-no-subdir`;
		const gitMock = createFileWritingGitMock({
			'packages/app/index.js': 'export default 1\n',
			'README.md': 'hello',
		});

		await degit(test.publicSrc, {
			git: gitMock,
			mode: 'git',
		}).clone(dest);

		assert.equal(fs.existsSync(path.join(dest, 'README.md')), true);
		assert.equal(fs.existsSync(path.join(dest, 'packages/app/index.js')), true);
	});

	it('extracts only the subdirectory when tar falls back to git', async () => {
		const test = providerCases[0];
		const dest = `${suiteTmp}/tar-fallback-subdir`;
		clearArchiveCache(suiteCache, test);
		const fetchMock = createMockFetch([
			{
				code: 'COULD_NOT_DOWNLOAD',
				message: 'not found',
				status: 404,
			},
		]);
		const gitMock = createFileWritingGitMock({
			'packages/app/index.js': 'export default 1\n',
			'README.md': 'hello',
		});

		await degit(`${test.publicSrc}/packages/app`, {
			cache: false,
			fetch: fetchMock.fn,
			git: gitMock,
		}).clone(dest);

		assert.equal(fs.existsSync(path.join(dest, 'index.js')), true);
		assert.equal(fs.readFileSync(path.join(dest, 'index.js'), 'utf8'), 'export default 1\n');
		assert.equal(fs.existsSync(path.join(dest, 'README.md')), false);
	});
});
/* eslint-enable max-lines-per-function */
