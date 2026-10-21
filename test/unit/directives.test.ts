/* eslint-disable max-lines */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDirectives, type DirectiveContext } from '../../src/operations/directives.js';
import type { Directive } from '../../src/domain/types.js';

function makeTempWorkspace(prefix: string) {
	return fs.mkdtempSync(path.join(process.cwd(), prefix));
}

function makeDispatcher() {
	const infos: string[] = [];
	const warnings: string[] = [];
	const context = {
		fetch: vi.fn<(...args: any[]) => any>(),
		getGitClient: vi.fn<(...args: any[]) => any>(),
		getStagingDir: vi.fn<() => Promise<string>>(() => Promise.resolve('')),
		hasStashed: false,
		info: vi.fn<(...args: any[]) => any>((info) => infos.push(info.message)),
		warn: vi.fn<(...args: any[]) => any>((info) => warnings.push(info.message)),
	} as unknown as DirectiveContext;
	const createChild = vi.fn<(...args: any[]) => any>(() => ({
		clone: vi.fn<(...args: any[]) => any>(),
		on: vi.fn<(...args: any[]) => any>().mockReturnThis(),
	}));

	return { context, createChild, infos, warnings };
}

function assertNoStash(root: string, context: ReturnType<typeof makeDispatcher>['context']) {
	assert.equal(context.hasStashed, false);
	assert.equal(fs.existsSync(path.join(root, 'tmp')), false);
}

type CloneDirectiveCtx = {
	root: string;
	dest: string;
	context: ReturnType<typeof makeDispatcher>['context'];
	createChild: ReturnType<typeof makeDispatcher>['createChild'];
	childClone: ReturnType<typeof vi.fn>;
};

type SearchReplaceCtx = { root: string; dest: string } & ReturnType<typeof makeDispatcher>;

async function withSearchReplace<T>(run: (ctx: SearchReplaceCtx) => Promise<T>): Promise<T> {
	const root = makeTempWorkspace('search-replace-');
	const dest = path.join(root, 'dest');
	const dispatcher = makeDispatcher();
	fs.mkdirSync(dest, { recursive: true });
	try {
		return await run({ root, dest, ...dispatcher });
	} finally {
		fs.rmSync(root, { force: true, recursive: true });
	}
}

async function withCloneDirective<T>(
	prefix: string,
	run: (ctx: CloneDirectiveCtx) => Promise<T>,
): Promise<T> {
	const root = makeTempWorkspace(prefix);
	const dest = path.join(root, 'dest');
	const { context, createChild } = makeDispatcher();
	Object.assign(context, {
		stagingDir: root,
		getStagingDir: vi.fn<() => Promise<string>>(() => Promise.resolve(root)),
	});
	const childClone = vi.fn<(...args: any[]) => any>();
	createChild.mockReturnValue({
		clone: childClone,
		on: vi.fn<(...args: any[]) => any>().mockReturnThis(),
	});
	try {
		return await run({ root, dest, context, createChild, childClone });
	} finally {
		fs.rmSync(root, { force: true, recursive: true });
	}
}

afterEach(() => {
	delete process.env.PROJECT_NAME;
});

/* eslint-disable max-lines-per-function */
describe('directives', () => {
	it('warns and skips non-object directives when the directive is not an object', async () => {
		const root = makeTempWorkspace('non-object-');
		const dest = path.join(root, 'dest');
		const { context, createChild, warnings } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });

			await applyDirectives(
				context,
				[null, 'remove', 42, { action: 'unknown' }] as unknown as Directive[],
				dest,
				createChild,
			);

			assert.equal(createChild.mock.calls.length, 0);
			assert.equal(warnings.length, 4);
			assert.match(warnings[0], /unknown directive action/u);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('warns and skips an unknown directive action when the action is not recognized', async () => {
		const root = makeTempWorkspace('unknown-');
		const dest = path.join(root, 'dest');
		const { context, createChild, warnings } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });

			await applyDirectives(
				context,
				[{ action: 'unknown' } as unknown as Directive],
				dest,
				createChild,
			);

			assert.equal(createChild.mock.calls.length, 0);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /unknown directive action/u);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

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
				context,
				[
					{
						action: 'search_replace',
						files: 'README.md',
						pattern: '\\{\\{project_name\\}\\}',
						replacement: 'PROJECT_NAME',
					},
				],
				dest,
				createChild,
			);

			assert.equal(
				fs.readFileSync(path.join(dest, 'README.md'), 'utf8'),
				'hello degit\ndegit!\n',
			);
			assert.equal(infos.length, 2);
			assert.match(infos[0], /reading env var.*PROJECT_NAME/u);
			assert.match(infos[1], /replaced content in .*README\.md/u);
			assert.deepEqual(warnings, []);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('emits an info event naming the env var when the replacement is defined', async () => {
		const root = makeTempWorkspace('search-replace-');
		const dest = path.join(root, 'dest');
		const { context, createChild, infos } = makeDispatcher();

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(path.join(dest, 'a.txt'), 'x\n');
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context,
				[
					{
						action: 'search_replace',
						files: 'a.txt',
						pattern: 'x',
						replacement: 'PROJECT_NAME',
					},
				],
				dest,
				createChild,
			);

			assert.match(infos[0], /search_replace reading env var.*PROJECT_NAME/u);
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	it('warns and skips files larger than 10MB when the file exceeds the size cap', async () => {
		await withSearchReplace(async ({ context, createChild, dest, warnings }) => {
			const big = path.join(dest, 'big.txt');
			const handle = fs.openSync(big, 'w');
			fs.ftruncateSync(handle, 11 * 1024 * 1024);
			fs.closeSync(handle);
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context,
				[
					{
						action: 'search_replace',
						files: 'big.txt',
						pattern: 'x',
						replacement: 'PROJECT_NAME',
					},
				],
				dest,
				createChild,
			);

			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /too large for search_replace, skipping/u);
			assert.match(warnings[0], /big\.txt/u);
		});
	});

	it('warns and skips files when the pattern causes catastrophic backtracking', async () => {
		await withSearchReplace(async ({ context, createChild, dest, warnings }) => {
			fs.writeFileSync(path.join(dest, 'evil.txt'), `${'a'.repeat(35)}!`);
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context,
				[
					{
						action: 'search_replace',
						files: 'evil.txt',
						pattern: '(a+)+$',
						replacement: 'PROJECT_NAME',
					},
				],
				dest,
				createChild,
			);

			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /timed out on .*evil\.txt, skipping/u);
			assert.equal(
				fs.readFileSync(path.join(dest, 'evil.txt'), 'utf8'),
				`${'a'.repeat(35)}!`,
			);
		});
	}, 15_000);

	it('warns and skips missing files when the target path does not exist', async () => {
		await withSearchReplace(async ({ context, createChild, dest, warnings }) => {
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context,
				[
					{
						action: 'search_replace',
						files: 'missing.txt',
						pattern: 'missing',
						replacement: 'PROJECT_NAME',
					},
				],
				dest,
				createChild,
			);

			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /does not exist/u);
			assert.match(warnings[0], /missing\.txt/u);
		});
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
				context,
				[
					{
						action: 'search_replace',
						files: '../sibling/secret.txt',
						pattern: 'secret',
						replacement: 'PROJECT_NAME',
					},
				],
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
		await withSearchReplace(async ({ context, createChild, dest, infos, warnings }) => {
			fs.writeFileSync(path.join(dest, 'package.json'), '{"name":"{{project_name}}"}\n');
			process.env.PROJECT_NAME = 'degit';

			await applyDirectives(
				context,
				[
					{
						action: 'search_replace',
						files: 'package.json',
						pattern: '\\{\\{project_name\\}\\}',
						replacement: 'PROJECT_NAME',
					},
				],
				dest,
				createChild,
			);

			assert.equal(
				fs.readFileSync(path.join(dest, 'package.json'), 'utf8'),
				'{"name":"degit"}\n',
			);
			assert.equal(createChild.mock.calls.length, 0);
			assert.equal(infos.length, 2);
			assert.equal(warnings.length, 0);
		});
	});

	function runCloneDirective(files: string | string[]): Promise<string[] | undefined> {
		return withCloneDirective('clone-files-', async ({ dest, context, createChild }) => {
			fs.mkdirSync(dest, { recursive: true });

			await applyDirectives(
				context,
				[
					{
						action: 'clone',
						src: 'user/another-repo',
						files,
					},
				],
				dest,
				createChild,
			);

			return createChild.mock.calls[0][1].files;
		});
	}

	it('passes files to the child clone when the clone directive lists files', async () => {
		const files = await runCloneDirective(['README.md', 'src/index.ts']);
		assert.deepEqual(files, ['README.md', 'src/index.ts']);
	});

	it('passes a single files value as an array when the clone directive uses a string', async () => {
		const files = await runCloneDirective('README.md');
		assert.deepEqual(files, ['README.md']);
	});

	it('warns and continues cloning when directive nesting depth reaches five', async () => {
		await withCloneDirective(
			'clone-depth-',
			async ({ dest, context, createChild, childClone }) => {
				context.depth = 5;

				await applyDirectives(
					context,
					[{ action: 'clone', src: 'user/repo' }],
					dest,
					createChild,
				);

				expect(context.warn).toHaveBeenCalledWith({
					message: 'clone directive nesting depth 5 reached 5, continuing',
				});
				assert.equal(createChild.mock.calls[0][1].depth, 6);
				assert.equal(childClone.mock.calls.length, 1);
			},
		);
	});

	it('inherits parent options when a clone directive builds a child', async () => {
		await withCloneDirective('clone-options-', async ({ dest, context, createChild }) => {
			fs.mkdirSync(dest, { recursive: true });
			Object.assign(context, { cache: false, verbose: true });

			await applyDirectives(
				context,
				[{ action: 'clone', src: 'user/repo' }],
				dest,
				createChild,
			);

			const options = createChild.mock.calls[0][1] as {
				cache?: boolean;
				mode?: string;
				verbose?: boolean;
				force?: boolean;
			};
			assert.equal(options.cache, false);
			assert.equal(options.mode, undefined);
			assert.equal(options.verbose, true);
			assert.equal(options.force, true);
		});
	});

	it('does not stash when the destination does not exist', async () => {
		await withCloneDirective(
			'clone-missing-',
			async ({ root, dest, context, createChild, childClone }) => {
				childClone.mockImplementation(() => {
					fs.mkdirSync(dest, { recursive: true });
				});

				await applyDirectives(
					context,
					[{ action: 'clone', src: 'user/repo' }],
					dest,
					createChild,
				);

				assert.equal(fs.existsSync(dest), true);
				assert.equal(childClone.mock.calls.length, 1);
				assertNoStash(root, context);
			},
		);
	});

	it('rejects when the destination is a file and not a directory', async () => {
		await withCloneDirective(
			'clone-file-',
			async ({ root, dest, context, createChild, childClone }) => {
				fs.writeFileSync(dest, 'not a directory');

				await assert.rejects(
					async () =>
						await applyDirectives(
							context,
							[{ action: 'clone', src: 'user/repo' }],
							dest,
							createChild,
						),
					(err: any) => err?.code === 'ENOTDIR',
				);

				assert.equal(childClone.mock.calls.length, 0);
				assertNoStash(root, context);
			},
		);
	});

	it('unstashes the destination when a clone directive fails', async () => {
		await withCloneDirective(
			'clone-fail-',
			async ({ dest, context, createChild, childClone }) => {
				childClone.mockImplementation(() => {
					throw new Error('clone failed');
				});

				fs.mkdirSync(dest, { recursive: true });
				fs.writeFileSync(path.join(dest, 'x'), 'x');

				await assert.rejects(
					async () =>
						await applyDirectives(
							context,
							[{ action: 'clone', src: 'user/repo' }],
							dest,
							createChild,
						),
					(err: any) => err?.message === 'clone failed',
				);

				assert.equal(fs.existsSync(path.join(dest, 'x')), true);
				assert.equal(context.hasStashed, false);
			},
		);
	});

	it('resets hasStashed when applyDirectives is called a second time', async () => {
		await withCloneDirective(
			'clone-reset-',
			async ({ dest, context, createChild, childClone }) => {
				fs.mkdirSync(dest, { recursive: true });
				fs.writeFileSync(path.join(dest, 'x'), 'x');

				await applyDirectives(
					context,
					[{ action: 'clone', src: 'user/repo' }],
					dest,
					createChild,
				);

				await applyDirectives(
					context,
					[{ action: 'clone', src: 'user/repo' }],
					dest,
					createChild,
				);

				assert.equal(childClone.mock.calls.length, 2);
			},
		);
	});

	it('restores the destination from a leftover stash before stashing again when the previous call left a dirty stash', async () => {
		await withCloneDirective(
			'clone-retry-',
			async ({ root, dest, context, createChild, childClone }) => {
				fs.mkdirSync(dest, { recursive: true });
				fs.writeFileSync(path.join(dest, 'x'), 'corrupted');

				const tmp = path.join(root, 'tmp');
				fs.mkdirSync(tmp, { recursive: true });
				fs.writeFileSync(path.join(tmp, 'x'), 'original');
				context.hasStashed = true;

				childClone.mockImplementation(() => {
					fs.writeFileSync(path.join(dest, 'y'), 'new');
				});

				await applyDirectives(
					context,
					[{ action: 'clone', src: 'user/repo' }],
					dest,
					createChild,
				);

				assert.equal(fs.readFileSync(path.join(dest, 'x'), 'utf8'), 'original');
				assert.equal(fs.readFileSync(path.join(dest, 'y'), 'utf8'), 'new');
				assert.equal(context.hasStashed, false);
			},
		);
	});

	it('preserves the original destination and child files from each clone when multiple clone directives run', async () => {
		await withCloneDirective(
			'clone-multi-',
			async ({ root, dest, context, createChild, childClone }) => {
				fs.mkdirSync(dest, { recursive: true });
				fs.writeFileSync(path.join(dest, 'original'), 'original');

				const files = ['a', 'b'];
				let index = 0;
				childClone.mockImplementation((target: string) => {
					const name = files[index];
					fs.writeFileSync(path.join(target, name), name);
					index += 1;
				});

				await applyDirectives(
					context,
					[
						{ action: 'clone', src: 'user/repo1' },
						{ action: 'clone', src: 'user/repo2' },
					],
					dest,
					createChild,
				);

				assert.equal(
					createChild.mock.calls.every(
						(call) => (call[1] as { force?: boolean }).force === true,
					),
					true,
				);
				assert.equal(fs.readFileSync(path.join(dest, 'original'), 'utf8'), 'original');
				assert.equal(fs.readFileSync(path.join(dest, 'a'), 'utf8'), 'a');
				assert.equal(fs.readFileSync(path.join(dest, 'b'), 'utf8'), 'b');
				assertNoStash(root, context);
			},
		);
	});

	it('restores a stashed file when a clone creates a directory with the same name and fails', async () => {
		await withCloneDirective(
			'clone-conflict-',
			async ({ root, dest, context, createChild, childClone }) => {
				fs.mkdirSync(dest, { recursive: true });
				fs.writeFileSync(path.join(dest, 'shared'), 'original');

				childClone.mockImplementationOnce((target: string) => {
					fs.rmSync(path.join(target, 'shared'), { force: true });
					fs.mkdirSync(path.join(target, 'shared'), { recursive: true });
					fs.writeFileSync(path.join(target, 'shared', 'child'), 'child');
					throw new Error('clone failed after conflict');
				});

				await assert.rejects(
					applyDirectives(
						context,
						[{ action: 'clone', src: 'user/repo' }],
						dest,
						createChild,
					),
					(err: any) => err?.message === 'clone failed after conflict',
				);

				assert.equal(fs.readFileSync(path.join(dest, 'shared'), 'utf8'), 'original');
				assert.equal(fs.existsSync(path.join(dest, 'shared', 'child')), false);
				assertNoStash(root, context);
			},
		);
	});

	it('keeps child files from successful clones and restores the original destination when a later clone directive fails', async () => {
		await withCloneDirective(
			'clone-multi-fail-',
			async ({ root, dest, context, createChild, childClone }) => {
				fs.mkdirSync(dest, { recursive: true });
				fs.writeFileSync(path.join(dest, 'original'), 'original');

				childClone.mockImplementationOnce((target: string) => {
					fs.writeFileSync(path.join(target, 'clone-0'), 'child');
				});
				childClone.mockImplementationOnce(() => {
					throw new Error('second clone failed');
				});

				await assert.rejects(
					applyDirectives(
						context,
						[
							{ action: 'clone', src: 'user/repo1' },
							{ action: 'clone', src: 'user/repo2' },
						],
						dest,
						createChild,
					),
					(err: any) => err?.message === 'second clone failed',
				);

				assert.equal(fs.readFileSync(path.join(dest, 'original'), 'utf8'), 'original');
				assert.equal(fs.existsSync(path.join(dest, 'clone-0')), true);
				assert.equal(fs.existsSync(path.join(dest, 'clone-1')), false);
				assertNoStash(root, context);
			},
		);
	});

	it('merges a stashed directory with a clone-created directory of the same name when the clone succeeds', async () => {
		await withCloneDirective(
			'clone-dir-merge-',
			async ({ root, dest, context, createChild, childClone }) => {
				fs.mkdirSync(dest, { recursive: true });
				fs.mkdirSync(path.join(dest, 'shared'), { recursive: true });
				fs.writeFileSync(path.join(dest, 'shared', 'original'), 'original');
				fs.writeFileSync(path.join(dest, 'shared', 'over'), 'original-over');

				childClone.mockImplementationOnce((target: string) => {
					fs.mkdirSync(path.join(target, 'shared'), { recursive: true });
					fs.writeFileSync(path.join(target, 'shared', 'over'), 'clone-over');
					fs.writeFileSync(path.join(target, 'shared', 'child'), 'child');
				});

				await applyDirectives(
					context,
					[{ action: 'clone', src: 'user/repo' }],
					dest,
					createChild,
				);

				assert.equal(fs.existsSync(path.join(dest, 'shared', 'original')), true);
				assert.equal(
					fs.readFileSync(path.join(dest, 'shared', 'over'), 'utf8'),
					'original-over',
				);
				assert.equal(fs.readFileSync(path.join(dest, 'shared', 'child'), 'utf8'), 'child');
				assertNoStash(root, context);
			},
		);
	});
});
/* eslint-enable max-lines-per-function */
