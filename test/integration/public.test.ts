import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sync as rimraf } from 'rimraf';
import { createIntegrationRunner } from './runner.js';

const runner = createIntegrationRunner();

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

describe('public integration suite', () => {
	for (const test of publicRepos) {
		it(`clones the pinned ${test.site} repository when the integration suite runs`, async () => {
			const integrationTmp = path.join('.tmp', 'integration-suite-public', test.site);
			const source = [test.src, test.gitUrl].find(Boolean);
			assert.ok(source, `integration repo ${test.site} is missing a source`);

			await rimraf(integrationTmp);

			try {
				await runner.clone(source, integrationTmp);

				assert.equal(fs.existsSync(path.join(integrationTmp, test.expectedFile)), true);
				assert.equal(fs.readdirSync(integrationTmp).length > 0, true);
			} finally {
				await rimraf(integrationTmp);
			}
		});
	}
});
