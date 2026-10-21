import assert from 'node:assert';
import { execFileSync } from 'node:child_process';

describe('verify-docs', () => {
	it('exits zero when the self-check fixtures pass', () => {
		assert.doesNotThrow(() => execFileSync('node', ['scripts/verify-docs.js', '--self-check']));
	});
});
