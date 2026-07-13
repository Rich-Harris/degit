import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { providerArchiveTemplates, type GitProvider } from '../../src/domain/repo.js';
import degit from '../../src/index.js';
import { createCopyFetch, createMockGit } from '../helpers.js';

export const refsHash = '0123456789abcdef0123456789abcdef0123456789';
export const gitRefs = [{ hash: refsHash, type: 'HEAD' }];
export const branchRefs = [{ hash: refsHash, name: 'main', type: 'branch' }];

function createProviderCase({ build, domain, publicSrc, redirectUrl, site, user }) {
	const name = 'degit-test-repo';
	const privateName = `${name}-private`;
	const url = `https://${domain}/${user}/${name}`;
	return {
		...build({ domain, name, privateName, site, url, user }),
		name,
		privateName,
		publicSrc,
		redirectUrl,
		site,
		url,
		user,
	};
}

export const providerCases = [
	createProviderCase({
		domain: 'github.com',
		publicSrc: 'Rich-Harris/degit-test-repo',
		redirectUrl: 'https://github.com/forbidden',
		site: 'github',
		user: 'Rich-Harris',
		build: ({ domain, name, privateName, site, url, user }) => ({
			archiveUrl: (hash) =>
				providerArchiveTemplates[site as GitProvider]({ url, name }, hash),
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
		build: ({ domain, name, privateName, site, url, user }) => ({
			archiveUrl: (hash) =>
				providerArchiveTemplates[site as GitProvider]({ url, name }, hash),
			gitSrc: `gitlab:${user}/${privateName}`,
			lsRemote: `git ls-remote -- ${url}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
		}),
	}),
	createProviderCase({
		domain: 'git.example.com',
		publicSrc: 'gitlab:git.example.com/Rich-Harris/degit-test-repo',
		redirectUrl: 'https://git.example.com/forbidden',
		site: 'gitlab',
		user: 'Rich-Harris',
		build: ({ domain, name, privateName, site, url, user }) => ({
			archiveUrl: (hash) =>
				providerArchiveTemplates[site as GitProvider]({ url, name }, hash),
			gitSrc: `gitlab:${domain}/${user}/${privateName}`,
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
		build: ({ domain, name, privateName, site, url, user }) => ({
			archiveUrl: (hash) =>
				providerArchiveTemplates[site as GitProvider]({ url, name }, hash),
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
		build: ({ domain, name, privateName, site, url, user }) => ({
			archiveUrl: (hash) =>
				providerArchiveTemplates[site as GitProvider]({ url, name }, hash),
			gitSrc: `git.sr.ht/${user}/${privateName}`,
			lsRemote: `git ls-remote -- ${url}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
		}),
	}),
];

function createArchiveRootFixture(rootName, archiveBase = '.tmp/index-suite') {
	fs.mkdirSync(archiveBase, { recursive: true });
	const archiveDir = fs.mkdtempSync(path.join(archiveBase, 'archive-'));
	const archiveRoot = path.join(archiveDir, rootName);

	return { archiveDir, archiveRoot };
}

export async function createArchiveFixture(rootName, archiveBase) {
	const { archiveDir, archiveRoot } = createArchiveRootFixture(rootName, archiveBase);

	fs.mkdirSync(path.join(archiveRoot, 'packages/app/lib'), { recursive: true });
	fs.writeFileSync(path.join(archiveRoot, 'packages/app/index.js'), 'export default 1\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/app/lib/nested.txt'), 'nested\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/ignored.txt'), 'ignored\n');

	const archiveFile = path.join(archiveDir, `${rootName}.tar.gz`);
	await tar.create({ C: archiveDir, file: archiveFile, gzip: true }, [rootName]);

	return archiveFile;
}

async function createArchiveWithFileFixture(rootName, relativePath, contents, archiveBase) {
	const { archiveDir, archiveRoot } = createArchiveRootFixture(rootName, archiveBase);

	fs.mkdirSync(path.dirname(path.join(archiveRoot, relativePath)), { recursive: true });
	fs.writeFileSync(path.join(archiveRoot, relativePath), contents);

	const archiveFile = path.join(archiveDir, `${rootName}.tar.gz`);
	await tar.create({ C: archiveDir, file: archiveFile, gzip: true }, [rootName]);

	return archiveFile;
}

export function createArchiveWithGitLfsPointerFixture(rootName, archiveBase) {
	return createArchiveWithFileFixture(
		rootName,
		'packages/app/asset.bin',
		'version https://git-lfs.github.com/spec/v1\noid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nsize 1234\n',
		archiveBase,
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

export async function cloneAndExpectGitFallback(test, archiveFile, dest) {
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

export async function cloneAndExpectTarContent(
	test,
	archiveFile,
	dest,
	expectedPath,
	expectedContent,
) {
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

export function clearArchiveCache(cacheBase, test) {
	const archiveDir = path.join(cacheBase, test.site, test.user, test.name);
	fs.rmSync(archiveDir, { force: true, recursive: true });
}
