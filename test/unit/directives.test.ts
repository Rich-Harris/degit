import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';
import { applyDirectives } from '../../src/operations/directives.js';

function makeTempWorkspace(prefix: string) {
	return fs.mkdtempSync(path.join(process.cwd(), prefix));
}

function makeDispatcher() {
	const infos: string[] = [];
	const warnings: string[] = [];
	const context = {
		fetch: vi.fn<(...args: any[]) => any>(),
		getGitClient: vi.fn<(...args: any[]) => any>(),
		hasStashed: false,
		info: vi.fn<(...args: any[]) => any>((info) => infos.push(info.message)),
		remove: vi.fn<(...args: any[]) => any>(),
		warn: vi.fn<(...args: any[]) => any>((info) => warnings.push(info.message)),
	};
	const createChild = vi.fn<(...args: any[]) => any>(() => ({
		clone: vi.fn<(...args: any[]) => any>(),
		on: vi.fn<(...args: any[]) => any>().mockReturnThis(),
	}));

	return { context, createChild, infos, warnings };
}

afterEach(() => {
	delete process.env.PROJECT_NAME;
});

/* eslint-disable max-lines-per-function */
describe('search_replace', () => {
	it('replaces every match in targeted files when the env var exists', async () => {
		const root = makeTempWorkspace('search-replace-');
		const dest = path.join(root, 'dest');
		const { context, createChild, infos, warnings } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(
				path.join(dest, 'README.md'),
				'hello {{project_name}}\n{{project_name}}!\n',
			);
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context as never,
				[
					{
						action: 'search_replace',
						files: 'README.md',
						pattern: '\\{\\{project_name\\}\\}',
						replacement: 'PROJECT_NAME',
					},
				],
				root,
				dest,
				createChild,
			);

			assert.equal(
				fs.readFileSync(path.join(dest, 'README.md'), 'utf8'),
				'hello degit\ndegit!\n',
			);
			assert.equal(infos.length, 1);
			assert.match(infos[0], /replaced content in .*README\.md/u);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('warns and skips missing files when the target path does not exist', async () => {
		const root = makeTempWorkspace('search-replace-');
		const dest = path.join(root, 'dest');
		const { context, createChild, warnings } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context as never,
				[
					{
						action: 'search_replace',
						files: 'missing.txt',
						pattern: 'missing',
						replacement: 'PROJECT_NAME',
					},
				],
				root,
				dest,
				createChild,
			);

			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /does not exist/u);
			assert.match(warnings[0], /missing\.txt/u);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('warns and skips paths outside the destination when the target escapes the destination', async () => {
		const root = makeTempWorkspace('search-replace-');
		const dest = path.join(root, 'dest');
		const sibling = path.join(root, 'sibling');
		const { context, createChild, warnings } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.mkdirSync(sibling, { recursive: true });
			fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret\n');
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context as never,
				[
					{
						action: 'search_replace',
						files: '../sibling/secret.txt',
						pattern: 'secret',
						replacement: 'PROJECT_NAME',
					},
				],
				root,
				dest,
				createChild,
			);

			assert.equal(fs.readFileSync(path.join(sibling, 'secret.txt'), 'utf8'), 'secret\n');
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /outside the destination, skipping/u);
			assert.match(warnings[0], /\.\.\/sibling\/secret\.txt/u);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('runs search_replace directives through the directive dispatcher when applyDirectives receives search_replace', async () => {
		const root = makeTempWorkspace('search-replace-');
		const dest = path.join(root, 'dest');
		const directivesDir = path.join(root, 'repo');
		const { context, createChild, infos, warnings } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(path.join(dest, 'package.json'), '{"name":"{{project_name}}"}\n');
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context as never,
				[
					{
						action: 'search_replace',
						files: 'package.json',
						pattern: '\\{\\{project_name\\}\\}',
						replacement: 'PROJECT_NAME',
					},
				],
				directivesDir,
				dest,
				createChild,
			);

			assert.equal(
				fs.readFileSync(path.join(dest, 'package.json'), 'utf8'),
				'{"name":"degit"}\n',
			);
			assert.equal(createChild.mock.calls.length, 0);
			assert.equal(context.remove.mock.calls.length, 0);
			assert.equal(infos.length, 1);
			assert.equal(warnings.length, 0);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});
});
/* eslint-enable max-lines-per-function */
