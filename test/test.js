const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { exec } = require('../utils.js');

const cmd = path.resolve('bin.js');

describe('degit', () => {
	beforeEach(() => exec('rm -rf .tmp'));

	it('clones a repo', async () => {
		await exec(`${cmd} Rich-Harris/degit-test-repo .tmp/test-repo`);

		const files = fs.readdirSync(`.tmp/test-repo`);
		assert.deepEqual(files, [
			'file.txt'
		]);

		assert.equal(
			read(`.tmp/test-repo/file.txt`),
			'hello!'
		);
	});
});

function read(file) {
	return fs.readFileSync(file)
}