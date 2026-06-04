import assert from 'node:assert';
import { vi } from 'vitest';

let gitClientLoaded = false;
const fetchRefs = vi.fn(async () => [
	{ hash: '0123456789abcdef0123456789abcdef0123456789', type: 'HEAD' },
]);

vi.mock('../../src/git-client.js', () => {
	gitClientLoaded = true;
	return {
		defaultGitClient: {
			clone: vi.fn(async () => {}),
			fetchRefs,
		},
	};
});

const { default: degit } = await import('../../src/index.js');

describe('lazy git backend', () => {
	it('loads the default git client only when the clone path needs it', async () => {
		assert.equal(gitClientLoaded, false);

		const d = degit('Rich-Harris/degit-test-repo');
		assert.equal(gitClientLoaded, false);

		await (d as any)._getHash(d.repo, {});

		assert.equal(gitClientLoaded, true);
		assert.equal(fetchRefs.mock.calls.length, 1);
	});
});
