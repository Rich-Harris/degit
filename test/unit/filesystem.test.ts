/* eslint-disable max-lines */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { getDirectives, keepFiles } from '../../src/operations/filesystem.js';
import type { EventInfo } from '../../src/domain/types.js';

function makeTempWorkspace() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'degit-filesystem-'));
}

function runKeepFiles(root: string, files: string[] | undefined) {
	const warnings: EventInfo[] = [];
	keepFiles(root, files, (info) => warnings.push(info));
	return warnings;
}

/* eslint-disable max-lines-per-function */
describe('filesystem', () => {
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

	it('keeps listed files when files contains file paths', () => {
		const root = makeTempWorkspace();

		try {
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');
			fs.writeFileSync(path.join(root, 'package.json'), '{}');

			const warnings = runKeepFiles(root, ['README.md']);

			assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
			assert.equal(fs.existsSync(path.join(root, 'package.json')), false);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('keeps a listed directory and its descendants when files contains a directory path', () => {
		const root = makeTempWorkspace();

		try {
			fs.mkdirSync(path.join(root, 'src'), { recursive: true });
			fs.mkdirSync(path.join(root, 'src2'), { recursive: true });
			fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'index');
			fs.writeFileSync(path.join(root, 'src2', 'sibling.ts'), 'sibling');
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');

			const warnings = runKeepFiles(root, ['src']);

			assert.equal(fs.existsSync(path.join(root, 'src', 'index.ts')), true);
			assert.equal(fs.existsSync(path.join(root, 'src2')), false);
			assert.equal(fs.existsSync(path.join(root, 'src2', 'sibling.ts')), false);
			assert.equal(fs.existsSync(path.join(root, 'README.md')), false);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('warns and skips a path that escapes the destination when files contains a path outside the destination', () => {
		const workspace = makeTempWorkspace();
		const root = path.join(workspace, 'dest');

		try {
			fs.mkdirSync(root, { recursive: true });
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');

			const warnings = runKeepFiles(root, ['../outside']);

			assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
			assert.equal(warnings.length, 2);
			assert.equal(warnings[0].code, 'FILE_OUTSIDE_DEST');
			assert.match(warnings[0].message, /\.\.\/outside/u);
			assert.equal(warnings[1].code, 'NO_FILES_MATCHED');
		} finally {
			fs.rmSync(workspace, { force: true, recursive: true });
		}
	});

	it('warns and skips a missing file when files contains a path that does not exist', () => {
		const root = makeTempWorkspace();

		try {
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');

			const warnings = runKeepFiles(root, ['missing.txt']);

			assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
			assert.equal(warnings.length, 2);
			assert.equal(warnings[0].code, 'FILE_DOES_NOT_EXIST');
			assert.match(warnings[0].message, /missing\.txt/u);
			assert.equal(warnings[1].code, 'NO_FILES_MATCHED');
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('preserves nested files inside a kept directory when a directory is listed', () => {
		const root = makeTempWorkspace();

		try {
			fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
			fs.writeFileSync(path.join(root, 'src', 'nested', 'file.ts'), 'nested');
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');

			const warnings = runKeepFiles(root, ['src']);

			assert.equal(fs.existsSync(path.join(root, 'src', 'nested', 'file.ts')), true);
			assert.equal(fs.existsSync(path.join(root, 'README.md')), false);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('preserves parent directories of kept files while deleting sibling files when a file inside the directory is kept', () => {
		const root = makeTempWorkspace();

		try {
			fs.mkdirSync(path.join(root, 'src'), { recursive: true });
			fs.writeFileSync(path.join(root, 'src', 'keep.ts'), 'keep');
			fs.writeFileSync(path.join(root, 'src', 'drop.ts'), 'drop');
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');

			const warnings = runKeepFiles(root, ['src/keep.ts']);

			assert.equal(fs.existsSync(path.join(root, 'src', 'keep.ts')), true);
			assert.equal(fs.existsSync(path.join(root, 'src', 'drop.ts')), false);
			assert.equal(fs.existsSync(path.join(root, 'src')), true);
			assert.equal(fs.existsSync(path.join(root, 'README.md')), false);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('preserves a regular top-level degit.json when files is provided', () => {
		const root = makeTempWorkspace();

		try {
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');
			fs.writeFileSync(path.join(root, 'package.json'), '{}');
			fs.writeFileSync(path.join(root, 'degit.json'), 'not valid');

			const warnings = runKeepFiles(root, ['README.md']);

			assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
			assert.equal(fs.existsSync(path.join(root, 'degit.json')), true);
			assert.equal(fs.existsSync(path.join(root, 'package.json')), false);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('keeps the whole destination and warns when no requested files resolve', () => {
		const root = makeTempWorkspace();

		try {
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');
			fs.writeFileSync(path.join(root, 'package.json'), '{}');

			const warnings = runKeepFiles(root, ['missing.txt']);

			assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
			assert.equal(fs.existsSync(path.join(root, 'package.json')), true);
			assert.equal(warnings.length, 2);
			assert.equal(warnings[0].code, 'FILE_DOES_NOT_EXIST');
			assert.equal(warnings[1].code, 'NO_FILES_MATCHED');
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('keeps listed symlinks without following them when files contains symlinks', () => {
		const root = makeTempWorkspace();

		try {
			fs.mkdirSync(path.join(root, 'src'), { recursive: true });
			fs.writeFileSync(path.join(root, 'src', 'file.ts'), 'file');
			fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
			fs.symlinkSync('src', path.join(root, 'dir-link'));
			fs.symlinkSync('keep.txt', path.join(root, 'file-link'));

			const warnings = runKeepFiles(root, ['dir-link', 'file-link']);

			assert.equal(fs.lstatSync(path.join(root, 'dir-link')).isSymbolicLink(), true);
			assert.equal(fs.lstatSync(path.join(root, 'file-link')).isSymbolicLink(), true);
			assert.equal(fs.existsSync(path.join(root, 'src')), false);
			assert.equal(fs.existsSync(path.join(root, 'keep.txt')), false);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('leaves the destination unchanged when files is undefined', () => {
		const root = makeTempWorkspace();

		try {
			fs.writeFileSync(path.join(root, 'README.md'), 'readme');

			const warnings = runKeepFiles(root, undefined);

			assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});
});
/* eslint-enable max-lines-per-function */
