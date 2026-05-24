import assert from 'node:assert';
import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sync as rimraf } from 'rimraf';
import degit from '../src/index.js';

const liveEnabled = process.env.LIVE_TESTS === '1';
const describeLive = liveEnabled ? describe : describe.skip;

const liveRepos = [
	{
		expectedFile: 'README',
		site: 'github',
		src: 'octocat/Hello-World#7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
	},
	{
		expectedFile: 'CHANGELOG',
		gitUrl: 'https://gitlab.com/gitlab-org/gitlab-test.git',
		site: 'gitlab',
		transport: 'git',
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
		transport: 'git',
	},
];

function cloneWithGit(url, dest) {
	child_process.execFileSync('git', ['clone', '--depth', '1', url, dest], {
		stdio: 'ignore',
	});
}

describeLive('live provider integration', () => {
	const liveTmp = '.tmp/live-suite';

	beforeEach(() => rimraf(liveTmp));
	afterEach(() => rimraf(liveTmp));

	for (const test of liveRepos) {
		it(`clones the pinned ${test.site} repository when live tests are enabled`, async () => {
			const dest = path.join(liveTmp, test.site);

			if (test.transport === 'git') {
				cloneWithGit(test.gitUrl, dest);
			} else {
				await degit(test.src).clone(dest);
			}

			assert.equal(fs.existsSync(path.join(dest, test.expectedFile)), true);
			assert.equal(fs.readdirSync(dest).length > 0, true);
		});
	}
});
