import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { vi } from 'vitest';

let gitClientLoaded = false;
const fetchRefs = vi.fn(() => [
	{ hash: '0123456789abcdef0123456789abcdef0123456789', type: 'HEAD' },
]);
const clone = vi.fn(async () => {});

vi.mock('../../src/transports/git/client.js', () => {
	gitClientLoaded = true;
	return {
		defaultGitClient: {
			clone,
			fetchRefs,
		},
	};
});

const { default: degit } = await import('../../src/index.js');

describe('lazy git backend', () => {
	it('loads the default git client only when clone needs it', async () => {
		assert.equal(gitClientLoaded, false);

		const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'degit-lazy-git-'));

		try {
			const d = degit('Rich-Harris/degit-test-repo', { mode: 'git' });
			assert.equal(gitClientLoaded, false);

			await d.clone(dest);

			assert.equal(gitClientLoaded, true);
			assert.equal(fetchRefs.mock.calls.length, 1);
			assert.equal(clone.mock.calls.length, 1);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
});
