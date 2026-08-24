import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import degit from '../../src/index.js';
import { base } from '../../src/shared/utils.js';

function actionsStagingEntries(): string[] {
	return fs.existsSync(base)
		? fs.readdirSync(base).filter((entry) => entry.startsWith('actions-'))
		: [];
}

/* eslint-disable max-lines-per-function */
describe('doactions', () => {
	it('runs a clone action through doActions when the source is a pinned public repo', async () => {
		const integrationTmp = path.join('.tmp', 'integration-suite-doactions');

		fs.rmSync(integrationTmp, { force: true, recursive: true });

		try {
			await degit().doActions(
				[
					{
						action: 'clone',
						src: 'octocat/Hello-World#7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
					},
				],
				integrationTmp,
			);

			assert.equal(fs.existsSync(path.join(integrationTmp, 'README')), true);
		} finally {
			fs.rmSync(integrationTmp, { force: true, recursive: true });
		}
	});

	it('runs a remove action through doActions when a source is provided', async () => {
		const integrationTmp = path.join('.tmp', 'integration-suite-doactions-source');

		fs.rmSync(integrationTmp, { force: true, recursive: true });

		try {
			const emitter = degit('octocat/Hello-World#7fd1a60b01f91b314f59955a4e4d4e80d8edf11d');

			await emitter.clone(integrationTmp);
			await emitter.doActions([{ action: 'remove', files: ['README'] }], integrationTmp);

			assert.equal(fs.existsSync(path.join(integrationTmp, 'README')), false);
		} finally {
			fs.rmSync(integrationTmp, { force: true, recursive: true });
		}
	});

	it('runs a clone action through doActions when a source is provided', async () => {
		const integrationTmp = path.join('.tmp', 'integration-suite-doactions-source-clone');

		fs.rmSync(integrationTmp, { force: true, recursive: true });
		const before = actionsStagingEntries();

		try {
			const emitter = degit('octocat/Hello-World#7fd1a60b01f91b314f59955a4e4d4e80d8edf11d');

			await emitter.doActions(
				[
					{
						action: 'clone',
						src: 'octocat/Hello-World#7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
					},
				],
				integrationTmp,
			);

			assert.equal(fs.existsSync(path.join(integrationTmp, 'README')), true);
			const after = actionsStagingEntries().filter((entry) => !before.includes(entry));
			assert.equal(after.length, 0);
		} finally {
			fs.rmSync(integrationTmp, { force: true, recursive: true });
		}
	});
});
/* eslint-enable max-lines-per-function */
