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

vi.mock('../../src/utils.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/utils.js')>('../../src/utils.js');

	return {
		...actual,
		base: path.join(process.cwd(), '.tmp', 'index-suite-cache'),
	};
});

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

function createArchiveRootFixture(rootName) {
	fs.mkdirSync('.tmp/index-suite', { recursive: true });
	const archiveDir = fs.mkdtempSync(path.join('.tmp/index-suite', 'archive-'));
	const archiveRoot = path.join(archiveDir, rootName);

	return { archiveDir, archiveRoot };
}

async function createArchiveFixture(rootName) {
	const { archiveDir, archiveRoot } = createArchiveRootFixture(rootName);

	fs.mkdirSync(path.join(archiveRoot, 'packages/app/lib'), { recursive: true });
	fs.writeFileSync(path.join(archiveRoot, 'packages/app/index.js'), 'export default 1\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/app/lib/nested.txt'), 'nested\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/ignored.txt'), 'ignored\n');

	const archiveFile = path.join(archiveDir, `${rootName}.tar.gz`);
	await tar.create({ C: archiveDir, file: archiveFile, gzip: true }, [rootName]);

	return archiveFile;
}

async function createArchiveWithFileFixture(rootName, relativePath, contents) {
	const { archiveDir, archiveRoot } = createArchiveRootFixture(rootName);

	fs.mkdirSync(path.dirname(path.join(archiveRoot, relativePath)), { recursive: true });
	fs.writeFileSync(path.join(archiveRoot, relativePath), contents);

	const archiveFile = path.join(archiveDir, `${rootName}.tar.gz`);
	await tar.create({ C: archiveDir, file: archiveFile, gzip: true }, [rootName]);

	return archiveFile;
}

function createArchiveWithGitLfsPointerFixture(rootName) {
	return createArchiveWithFileFixture(
		rootName,
		'packages/app/asset.bin',
		'version https://git-lfs.github.com/spec/v1\noid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nsize 1234\n',
	);
}

async function cloneAndReadFile(test, archiveFile, dest, filePath, gitCloneOutput) {
	const fetch = createCopyFetch(archiveFile);
	const gitMock = createMockGit({
		[`fetchRefs ${test.url}`]: gitRefs,
		[`clone ${test.url} ${dest} HEAD`]: (_repo, cloneDest) => {
			fs.mkdirSync(cloneDest, { recursive: true });
			fs.writeFileSync(path.join(cloneDest, filePath), gitCloneOutput);
		},
	});

	await degit(test.publicSrc, {
		git: gitMock.fn,
		fetch: fetch.fn,
	}).clone(dest);

	return { fetch, gitMock };
}

async function cloneAndExpectGitFallback(test, archiveFile, dest) {
	const { fetch, gitMock } = await cloneAndReadFile(
		test,
		archiveFile,
		dest,
		'from-git.txt',
		'git clone output\n',
	);

	assert.equal(fs.existsSync(path.join(dest, 'from-git.txt')), true);
	assert.equal(fs.readFileSync(path.join(dest, 'from-git.txt'), 'utf8'), 'git clone output\n');
	assert.equal(fetch.calls.length, 1);
	assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
	assert.deepEqual(gitMock.calls, [`fetchRefs ${test.url}`, `clone ${test.url} ${dest} HEAD`]);
}

async function cloneAndExpectTarContent(test, archiveFile, dest, expectedPath, expectedContent) {
	const fetch = createCopyFetch(archiveFile);
	const gitMock = createMockGit({
		[`fetchRefs ${test.url}`]: gitRefs,
	});

	await degit(test.publicSrc, {
		git: gitMock.fn,
		fetch: fetch.fn,
	}).clone(dest);

	assert.equal(fs.existsSync(path.join(dest, expectedPath)), true);
	assert.equal(fs.readFileSync(path.join(dest, expectedPath), 'utf8'), expectedContent);
	assert.equal(fetch.calls.length, 1);
	assert.equal(fetch.calls[0].url, test.archiveUrl(refsHash));
	assert.deepEqual(gitMock.calls, [`fetchRefs ${test.url}`]);
}

function clearArchiveCache(test) {
	const archiveDir = path.join(base, test.site, test.user, test.name);
	fs.rmSync(archiveDir, { force: true, recursive: true });
}

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

	                providerCases.forEach((test) => {
	                        it(`does not fall back when a file merely quotes a pointer snippet for ${test.site}`, async () => {
	                                const dest = '.tmp/index-suite/test-repo';
	                                clearArchiveCache(test, refsHash);
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
	                                clearArchiveCache(test, refsHash);
	                                const archiveFile = await createArchiveWithGitLfsPointerFixture(
	                                        `degit-test-repo-${refsHash}`,
	                                );
	                                await cloneAndExpectGitFallback(test, archiveFile, dest);
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

	                it('removes nested directories recursively from the destination', () => {
	                        const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

	                        try {
	                                fs.mkdirSync(path.join(dest, 'nested', 'child'), { recursive: true });
	                                fs.writeFileSync(path.join(dest, 'nested', 'child', 'file.txt'), 'nested\n');
	                                fs.writeFileSync(path.join(dest, 'flat.txt'), 'flat\n');

	                                const emitter = degit('Rich-Harris/degit-test-repo');
	                                emitter.remove(dest, { files: ['nested', 'flat.txt'] });

	                                assert.equal(fs.existsSync(path.join(dest, 'nested')), false);
	                                assert.equal(fs.existsSync(path.join(dest, 'flat.txt')), false);
	                        } finally {
	                                fs.rmSync(dest, { force: true, recursive: true });
	                        }
	                });

	                it('warns and skips paths that escape the destination when removing files', () => {
	                        const workspace = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
	                        const dest = path.join(workspace, 'dest');
	                        const sibling = path.join(workspace, 'sibling');
	                        const warnings: string[] = [];

	                        try {
	                                fs.mkdirSync(dest, { recursive: true });
	                                fs.mkdirSync(sibling, { recursive: true });
	                                fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret\n');

	                                const emitter = degit('Rich-Harris/degit-test-repo');
	                                emitter.on('warn', (event) => warnings.push(event.message));

	                                emitter.remove(dest, { files: ['../sibling'] });

	                                assert.equal(fs.existsSync(path.join(sibling, 'secret.txt')), true);
	                                assert.equal(warnings.length, 1);
	                                assert.match(
	                                        warnings[0],
	                                        /action wants to remove .*outside the destination, skipping/,
	                                );
	                                assert.match(warnings[0], /\.\.\/sibling/);
	                        } finally {
	                                fs.rmSync(workspace, { force: true, recursive: true });
	                        }
	                });
	        });
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

		it('removes nested directories recursively from the destination', () => {
			const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

			try {
				fs.mkdirSync(path.join(dest, 'nested', 'child'), { recursive: true });
				fs.writeFileSync(path.join(dest, 'nested', 'child', 'file.txt'), 'nested\n');
				fs.writeFileSync(path.join(dest, 'flat.txt'), 'flat\n');

				const emitter = degit('Rich-Harris/degit-test-repo');
				emitter.remove(dest, { files: ['nested', 'flat.txt'] });

				assert.equal(fs.existsSync(path.join(dest, 'nested')), false);
				assert.equal(fs.existsSync(path.join(dest, 'flat.txt')), false);
			} finally {
				fs.rmSync(dest, { force: true, recursive: true });
			}
		});

		it('warns and skips paths that escape the destination when removing files', () => {
			const workspace = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
			const dest = path.join(workspace, 'dest');
			const sibling = path.join(workspace, 'sibling');
			const warnings: string[] = [];

			try {
				fs.mkdirSync(dest, { recursive: true });
				fs.mkdirSync(sibling, { recursive: true });
				fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret\n');

				const emitter = degit('Rich-Harris/degit-test-repo');
				emitter.on('warn', (event) => warnings.push(event.message));

				emitter.remove(dest, { files: ['../sibling'] });

				assert.equal(fs.existsSync(path.join(sibling, 'secret.txt')), true);
				assert.equal(warnings.length, 1);
				assert.match(
					warnings[0],
					/action wants to remove .*outside the destination, skipping/,
				);
				assert.match(warnings[0], /\.\.\/sibling/);
			} finally {
				fs.rmSync(workspace, { force: true, recursive: true });
			}
		});
	});
