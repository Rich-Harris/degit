import fs from 'node:fs';
import assert from 'node:assert';
import path from 'node:path';

vi.mock('../../src/shared/utils.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/shared/utils.js')>(
		'../../src/shared/utils.js',
	);

	return {
		...actual,
		base: path.join(process.cwd(), '.tmp', 'aliases-suite-cache'),
	};
});

import { aliasesFile, loadAliases, removeAlias, saveAlias } from '../../src/aliases.js';
import { base } from '../../src/shared/utils.js';

/* eslint-disable max-lines-per-function */
describe('aliases', () => {
	beforeEach(() => {
		fs.rmSync(base, { force: true, recursive: true });
	});

	afterEach(() => {
		fs.rmSync(base, { force: true, recursive: true });
	});

	it('returns an empty object when the aliases file does not exist', () => {
		assert.deepStrictEqual(loadAliases(), {});
	});

	it('returns an empty object when the aliases file contains invalid json', () => {
		fs.mkdirSync(base, { recursive: true });
		fs.writeFileSync(aliasesFile, 'not json');

		assert.deepStrictEqual(loadAliases(), {});
	});

	it('saves a new alias when none exists', () => {
		saveAlias('myRepo', 'github:user/repo');

		assert.deepStrictEqual(loadAliases(), { myRepo: 'github:user/repo' });
	});

	it('adds an alias to the existing list when another alias already exists', () => {
		saveAlias('first', 'github:user/first');
		saveAlias('second', 'github:user/second');

		assert.deepStrictEqual(loadAliases(), {
			first: 'github:user/first',
			second: 'github:user/second',
		});
	});

	it('overwrites an existing alias when the same name is saved again', () => {
		saveAlias('myRepo', 'github:user/old');
		saveAlias('myRepo', 'github:user/new');

		assert.deepStrictEqual(loadAliases(), { myRepo: 'github:user/new' });
	});

	it('returns true when an existing alias is removed', () => {
		saveAlias('myRepo', 'github:user/repo');

		assert.equal(removeAlias('myRepo'), true);
		assert.deepStrictEqual(loadAliases(), {});
	});

	it('returns false when removing a non-existent alias', () => {
		assert.equal(removeAlias('missing'), false);
	});
});
