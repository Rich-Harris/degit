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
};

const privateIntegrationRepos: IntegrationRepo[] = [
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

describe('private integration suite', () => {
	for (const test of privateIntegrationRepos) {
		it(`clones the pinned ${test.site} repository when the integration suite runs`, async () => {
			const integrationTmp = path.join('.tmp', 'integration-suite-private', test.site);
			assert.ok(test.src, `integration repo ${test.site} is missing a source`);
			const source = test.src;

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
