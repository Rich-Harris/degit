import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createIntegrationRunner } from './runner.js';

type IntegrationRepo = {
	expectedFile: string;
	site: string;
	src?: string;
	gitUrl?: string;
};

const publicRepos: IntegrationRepo[] = [
	{
		expectedFile: 'README',
		site: 'github',
		src: 'octocat/Hello-World#7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
	},
	{
		expectedFile: 'CHANGELOG',
		gitUrl: 'https://gitlab.com/gitlab-org/gitlab-test.git',
		site: 'gitlab',
	},
	{
		expectedFile: 'README.md',
		site: 'bitbucket',
		src: 'bitbucket:cloudrepo-examples/maven-library-example#72aa7e3eed2c014e1a2b37b650a940c495abe11b',
	},
	{
		expectedFile: 'README.md',
		gitUrl: 'https://git.sr.ht/~showyourcode/public',
		site: 'git.sr.ht',
	},
];

const privateRepos: IntegrationRepo[] = [
	{
		expectedFile: 'README.md',
		site: 'github-private',
		src: 'git@github.com:YogliB/degit-test.git',
	},
	{
		expectedFile: 'README.md',
		site: 'gitlab-private',
		src: 'git@gitlab.com:yogevbb/degit-test',
	},
	{
		expectedFile: 'README.md',
		site: 'git.sr.ht-private',
		src: 'git@git.sr.ht:~yoglib/degit',
	},
];

const runner = createIntegrationRunner();

async function runSuite(repos: IntegrationRepo[], baseDir: string) {
	/* oxlint-disable no-await-in-loop */
	for (const test of repos) {
		const integrationTmp = path.join(baseDir, test.site);
		const source = test.src ?? test.gitUrl;

		if (!source) {
			throw new Error(`integration repo ${test.site} is missing a source`);
		}

		fs.rmSync(integrationTmp, { force: true, recursive: true });

		try {
			await runner.clone(source, integrationTmp);

			assert.equal(fs.existsSync(path.join(integrationTmp, test.expectedFile)), true);
			assert.equal(fs.readdirSync(integrationTmp).length > 0, true);
		} finally {
			fs.rmSync(integrationTmp, { force: true, recursive: true });
		}
	}
	/* oxlint-enable no-await-in-loop */
}

await runSuite(publicRepos, '.tmp/integration-suite-public');

if (process.env.SSH_PRIVATE_KEY?.trim()) {
	await runSuite(privateRepos, '.tmp/integration-suite-private');
}
