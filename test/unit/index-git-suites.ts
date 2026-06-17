import assert from 'node:assert';
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

function registerSshGitModeSuite() {
	describe('degit index ssh git mode', () => {
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
}

function registerExplicitGitModeSuite() {
	describe('degit index explicit git mode backend', () => {
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
	});
}

function registerExplicitGitModeWindowsSuite() {
	describe('degit index explicit git mode backend on Windows', () => {
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
	});
}

function registerGitLfsFallbackSuite(cacheBase) {
	describe('degit index git-lfs fallback', () => {
		providerCases.forEach((test) => {
			it(`does not fall back when a file merely quotes a pointer snippet for ${test.site}`, async () => {
				const dest = '.tmp/index-suite/test-repo';
				clearArchiveCache(cacheBase, test);
				const archiveFile = await createArchiveFixture(`degit-test-repo-${refsHash}`);
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
				const dest = '.tmp/index-suite/test-repo';
				clearArchiveCache(cacheBase, test);
				const archiveFile = await createArchiveWithGitLfsPointerFixture(
					`degit-test-repo-${refsHash}`,
				);
				await cloneAndExpectGitFallback(test, archiveFile, dest);
			});
		});
	});
}

export function registerGitModeSuites(cacheBase) {
	registerSshGitModeSuite();
	registerExplicitGitModeSuite();
	registerExplicitGitModeWindowsSuite();
	registerGitLfsFallbackSuite(cacheBase);
}
