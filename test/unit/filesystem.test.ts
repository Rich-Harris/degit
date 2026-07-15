import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { getDirectives } from '../../src/operations/filesystem.js';

function makeTempWorkspace() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'degit-filesystem-'));
}

/* eslint-disable max-lines-per-function */
describe('getDirectives', () => {
	it('loads and removes directives when degit.json is a regular JSON file', () => {
		const root = makeTempWorkspace();
		const directives = [{ action: 'remove', files: 'LICENSE' }];
		const directivesPath = path.join(root, 'degit.json');

		try {
			fs.writeFileSync(directivesPath, JSON.stringify(directives));

			assert.deepEqual(getDirectives(root), directives);
			assert.equal(fs.existsSync(directivesPath), false);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('loads and removes empty directives when degit.json is a regular JSON file', () => {
		const root = makeTempWorkspace();
		const directivesPath = path.join(root, 'degit.json');

		try {
			fs.writeFileSync(directivesPath, '[]');

			assert.deepEqual(getDirectives(root), []);
			assert.equal(fs.existsSync(directivesPath), false);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('returns false without execution when degit.json is a directory', () => {
		const root = makeTempWorkspace();
		const directivesPath = path.join(root, 'degit.json');
		const globalWithCanary = globalThis as typeof globalThis & {
			degitDirectiveCanary?: boolean;
		};

		try {
			fs.mkdirSync(directivesPath);
			fs.writeFileSync(
				path.join(directivesPath, 'index.js'),
				'globalThis.degitDirectiveCanary = true; module.exports = null;',
			);

			assert.equal(getDirectives(root), false);
			assert.equal(globalWithCanary.degitDirectiveCanary, undefined);
			assert.equal(fs.lstatSync(directivesPath).isDirectory(), true);
		} finally {
			delete globalWithCanary.degitDirectiveCanary;
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('returns false when degit.json is a symlink', () => {
		const root = makeTempWorkspace();
		const targetPath = path.join(root, 'directives.json');
		const directivesPath = path.join(root, 'degit.json');

		try {
			fs.writeFileSync(targetPath, '[]');
			fs.symlinkSync(targetPath, directivesPath);

			assert.equal(getDirectives(root), false);
			assert.equal(fs.lstatSync(directivesPath).isSymbolicLink(), true);
			assert.equal(fs.existsSync(targetPath), true);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('returns false without removal when degit.json contains malformed or non-array JSON', () => {
		const root = makeTempWorkspace();
		const directivesPath = path.join(root, 'degit.json');

		try {
			fs.writeFileSync(directivesPath, 'module.exports = [];');

			assert.equal(getDirectives(root), false);
			assert.equal(fs.readFileSync(directivesPath, 'utf8'), 'module.exports = [];');

			fs.writeFileSync(directivesPath, '{}');

			assert.equal(getDirectives(root), false);
			assert.equal(fs.readFileSync(directivesPath, 'utf8'), '{}');
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});
});
/* eslint-enable max-lines-per-function */
