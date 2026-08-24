/* eslint-disable max-lines */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import degit from '../../src/index.js';
import { generateGitlabRepoCandidates, parse } from '../../src/domain/repo.js';
import { Degit } from '../../src/core/orchestrator.js';
import { DegitError } from '../../src/shared/utils.js';
import { providerCases } from './index-support.js';
import type { Directive } from '../../src/domain/types.js';

const { suiteCache, suiteTmp } = vi.hoisted(() => ({
	suiteCache: '.tmp/index-main-suite-cache',
	suiteTmp: '.tmp/index-main-suite',
}));

vi.mock('../../src/shared/utils.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/shared/utils.js')>(
		'../../src/shared/utils.js',
	);

	return {
		...actual,
		base: path.join(process.cwd(), suiteCache),
	};
});

function makeEscapeWorkspace() {
	const workspace = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
	const dest = path.join(workspace, 'dest');
	const sibling = path.join(workspace, 'sibling');
	fs.mkdirSync(dest, { recursive: true });
	fs.mkdirSync(sibling, { recursive: true });
	return { workspace, dest, sibling };
}

/* eslint-disable max-lines-per-function */
describe('degit index', () => {
	beforeEach(() => {
		fs.rmSync(suiteTmp, { force: true, recursive: true });
		fs.rmSync(suiteCache, { force: true, recursive: true });
	});
	afterEach(() => {
		fs.rmSync(suiteTmp, { force: true, recursive: true });
		fs.rmSync(suiteCache, { force: true, recursive: true });
		delete process.env.PROJECT_NAME;
	});
	it('exports a usable JS library when importing the built entrypoint', async () => {
		const builtEntryPoint = path.resolve(process.cwd(), 'dist/index.js');
		const { default: builtDegit } = await import(new URL(`file://${builtEntryPoint}`).href);
		const instance = builtDegit('Rich-Harris/degit-test-repo');

		assert.equal(typeof builtDegit, 'function');
		assert.equal(typeof instance.clone, 'function');
		assert.equal(typeof instance.doActions, 'function');
		assert.equal(typeof instance.on, 'function');
	});

	providerCases.forEach((test) => {
		it(`parsed repo fields match expected URLs when src targets ${test.site}`, () => {
			const { repo } = degit(test.publicSrc);
			assert.equal(repo.site, test.site);
			assert.equal(repo.user, test.user);
			assert.equal(repo.name, test.name);
			assert.equal(repo.url, test.url);
			assert.equal(repo.ssh, test.ssh);
			assert.equal(repo.transport, 'https');
		});
	});
	it('parses gitlab:// prefix with custom domain when host is explicit', () => {
		const repo = parse('gitlab://git.example.com/user/repo');

		assert.equal(repo.url, 'https://git.example.com/user/repo');
		assert.equal(repo.ssh, 'ssh://git@git.example.com/user/repo');
		assert.equal(repo.site, 'gitlab');
	});
	it('parses gitlab: prefix to gitlab.com when no double-slash', () => {
		const repo = parse('gitlab:user/repo');

		assert.equal(repo.url, 'https://gitlab.com/user/repo');
	});
	it('parses gitlab: prefix to gitlab.com when dot is in username', () => {
		const repo = parse('gitlab:user.name/repo');

		assert.equal(repo.url, 'https://gitlab.com/user.name/repo');
	});
	it('parses a full GitHub tree URL into a ref and subdirectory when the URL contains a branch path', () => {
		const repo = parse('https://github.com/TanStack/table/tree/main/examples/react/filters');

		assert.equal(repo.user, 'TanStack');
		assert.equal(repo.name, 'table');
		assert.equal(repo.ref, 'main');
		assert.equal(repo.subdir, '/examples/react/filters');
		assert.equal(repo.url, 'https://github.com/TanStack/table');
		assert.equal(repo.ssh, 'ssh://git@github.com/TanStack/table');
	});
	it('decodes a URL-encoded subdirectory segment into @types when the URL contains %40types', () => {
		const repo = parse('https://github.com/user/repo/tree/main/%40types');

		assert.equal(repo.ref, 'main');
		assert.equal(repo.subdir, '/@types');
	});
	it('parses a full GitHub tree URL into only a ref when no subdirectory is given', () => {
		const repo = parse('https://github.com/user/repo/tree/main');

		assert.equal(repo.ref, 'main');
		assert.equal(repo.subdir, undefined);
	});
	it('uses an explicit #ref over the branch in a full URL when both are provided', () => {
		const repo = parse('https://github.com/user/repo/tree/main/subdir#dev');

		assert.equal(repo.ref, 'dev');
		assert.equal(repo.subdir, '/subdir');
	});
	it('parses a full GitLab tree URL into a ref and subdirectory when the URL uses the GitLab marker', () => {
		const repo = parse('https://gitlab.com/user/repo/-/tree/dev/sub/dir');

		assert.equal(repo.ref, 'dev');
		assert.equal(repo.subdir, '/sub/dir');
	});
	it('parses a full Bitbucket src URL into a ref and subdirectory when the URL uses the src marker', () => {
		const repo = parse('https://bitbucket.org/user/repo/src/main/sub');

		assert.equal(repo.ref, 'main');
		assert.equal(repo.subdir, '/sub');
	});
	it('treats shorthand paths literally when they contain tree-like segments', () => {
		const repo = parse('github:user/repo/tree');

		assert.equal(repo.ref, 'HEAD');
		assert.equal(repo.subdir, '/tree');
	});
	it('parses gitlab: prefix to gitlab.com when dot is in repo name', () => {
		const repo = parse('gitlab:user/my.repo');

		assert.equal(repo.url, 'https://gitlab.com/user/my.repo');
	});
	it('throws BAD_SRC when gitlab:// has no user or repo after host', () => {
		assert.throws(
			() => parse('gitlab://myhost.com'),
			(err: any) => err?.code === 'BAD_SRC',
		);
	});
	it('parses explicit ssh sources when the source uses ssh transport', () => {
		const { repo } = degit('git@github.com:Rich-Harris/degit-test-repo');

		assert.equal(repo.transport, 'ssh');
		assert.equal(repo.ssh, 'ssh://git@github.com/Rich-Harris/degit-test-repo');
	});
	it('throws UNSUPPORTED_HOST when the host prefix is not supported', () => {
		assert.throws(
			() => {
				degit('codeberg:Rich-Harris/degit-test-repo');
			},
			(err: any) => err?.code === 'UNSUPPORTED_HOST',
		);
	});
	it('rejects with DEST_NOT_EMPTY when destination has files and force is false', async () => {
		fs.mkdirSync(path.join(suiteTmp, 'ne'), { recursive: true });
		fs.writeFileSync(path.join(suiteTmp, 'ne/x'), '1');
		await assert.rejects(
			async () => await degit('Rich-Harris/degit-test-repo').clone(path.join(suiteTmp, 'ne')),
			(err: any) => err?.code === 'DEST_NOT_EMPTY',
		);
	});
	it('throws when mode is not a supported value', () => {
		assert.throws(
			() => degit('Rich-Harris/degit-test-repo', { mode: 'svn' as never }),
			/Valid modes are/u,
		);
	});
	it('removes nested directories recursively when pruning the destination', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

		try {
			fs.mkdirSync(path.join(dest, 'nested', 'child'), { recursive: true });
			fs.writeFileSync(path.join(dest, 'nested', 'child', 'file.txt'), 'nested\n');
			fs.writeFileSync(path.join(dest, 'flat.txt'), 'flat\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.remove(dest, { action: 'remove', files: ['nested', 'flat.txt'] });

			assert.equal(fs.existsSync(path.join(dest, 'nested')), false);
			assert.equal(fs.existsSync(path.join(dest, 'flat.txt')), false);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('warns and skips paths that escape the destination when removing files', () => {
		const { workspace, dest, sibling } = makeEscapeWorkspace();
		const warnings: string[] = [];

		try {
			fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, { action: 'remove', files: ['../sibling'] });

			assert.equal(fs.existsSync(path.join(sibling, 'secret.txt')), true);
			assert.equal(warnings.length, 1);
			assert.match(
				warnings[0],
				/action wants to remove .*outside the destination, skipping/u,
			);
			assert.match(warnings[0], /\.\.\/sibling/u);
		} finally {
			fs.rmSync(workspace, { force: true, recursive: true });
		}
	});
	it('removes files matching a glob pattern when files contains a glob', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

		try {
			fs.writeFileSync(path.join(dest, 'a.md'), 'a\n');
			fs.writeFileSync(path.join(dest, 'b.md'), 'b\n');
			fs.writeFileSync(path.join(dest, 'keep.ts'), 'keep\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.remove(dest, { action: 'remove', files: ['*.md'], allowGlobs: true });

			assert.equal(fs.existsSync(path.join(dest, 'a.md')), false);
			assert.equal(fs.existsSync(path.join(dest, 'b.md')), false);
			assert.equal(fs.existsSync(path.join(dest, 'keep.ts')), true);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('removes nested dotfiles matching a glob when the glob targets a dotfolder', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

		try {
			fs.mkdirSync(path.join(dest, '.github'), { recursive: true });
			fs.writeFileSync(path.join(dest, '.github', 'foo.md'), 'foo\n');
			fs.writeFileSync(path.join(dest, '.github', 'bar.yml'), 'bar\n');
			fs.writeFileSync(path.join(dest, 'README.md'), 'readme\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.remove(dest, {
				action: 'remove',
				files: ['.github/**/*.md'],
				allowGlobs: true,
			});

			assert.equal(fs.existsSync(path.join(dest, '.github', 'foo.md')), false);
			assert.equal(fs.existsSync(path.join(dest, '.github', 'bar.yml')), true);
			assert.equal(fs.existsSync(path.join(dest, 'README.md')), true);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('warns and skips glob patterns when allowGlobs is not set', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
		const warnings: string[] = [];

		try {
			fs.writeFileSync(path.join(dest, 'a.md'), 'a\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, { action: 'remove', files: ['*.md'] });

			assert.equal(fs.existsSync(path.join(dest, 'a.md')), true);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /allowGlobs/u);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('removes nested directory contents without spurious warnings when the glob matches descendants', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
		const warnings: string[] = [];

		try {
			fs.mkdirSync(path.join(dest, 'nested', 'child'), { recursive: true });
			fs.writeFileSync(path.join(dest, 'nested', 'child', 'file.txt'), 'nested\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, { action: 'remove', files: ['nested/**'], allowGlobs: true });

			assert.equal(fs.existsSync(path.join(dest, 'nested', 'child', 'file.txt')), false);
			assert.equal(fs.existsSync(path.join(dest, 'nested', 'child')), false);
			assert.equal(warnings.length, 0);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('warns and skips files that resolve outside the destination when they are reached through a symlink', () => {
		const { workspace, dest, sibling } = makeEscapeWorkspace();
		const warnings: string[] = [];

		try {
			fs.writeFileSync(path.join(sibling, 'keep.md'), 'keep\n');
			fs.symlinkSync(sibling, path.join(dest, 'outside-link'));

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, {
				action: 'remove',
				files: ['outside-link/**/*.md'],
				allowGlobs: true,
			});

			assert.equal(fs.existsSync(path.join(sibling, 'keep.md')), true);
			assert.equal(warnings.length, 1);
			assert.match(
				warnings[0],
				/action wants to remove .*outside the destination, skipping/u,
			);
		} finally {
			fs.rmSync(workspace, { force: true, recursive: true });
		}
	});
	it('removes a top-level directory symlink when it points outside the destination', () => {
		const { workspace, dest, sibling } = makeEscapeWorkspace();

		try {
			fs.writeFileSync(path.join(sibling, 'keep.md'), 'keep\n');
			fs.symlinkSync(sibling, path.join(dest, 'outside-link'));

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.remove(dest, { action: 'remove', files: ['outside-link'] });

			assert.equal(fs.existsSync(path.join(dest, 'outside-link')), false);
			assert.equal(fs.existsSync(path.join(sibling, 'keep.md')), true);
		} finally {
			fs.rmSync(workspace, { force: true, recursive: true });
		}
	});
	it('removes a nested symlink without deleting its target when the target is inside the destination', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

		try {
			fs.mkdirSync(path.join(dest, 'dir'), { recursive: true });
			fs.writeFileSync(path.join(dest, 'dir', 'real.md'), 'real\n');
			fs.symlinkSync(path.join(dest, 'dir', 'real.md'), path.join(dest, 'dir', 'link.md'));

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.remove(dest, { action: 'remove', files: ['dir/link.md'] });

			assert.equal(fs.existsSync(path.join(dest, 'dir', 'link.md')), false);
			assert.equal(fs.existsSync(path.join(dest, 'dir', 'real.md')), true);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('warns and skips glob matches that escape the destination when the glob expands outside dest', () => {
		const { workspace, dest, sibling } = makeEscapeWorkspace();
		const warnings: string[] = [];

		try {
			fs.writeFileSync(path.join(sibling, 'secret.md'), 'secret\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, {
				action: 'remove',
				files: ['../sibling/*.md'],
				allowGlobs: true,
			});

			assert.equal(fs.existsSync(path.join(sibling, 'secret.md')), true);
			assert.equal(warnings.length, 1);
			assert.match(
				warnings[0],
				/action wants to remove .*outside the destination, skipping/u,
			);
		} finally {
			fs.rmSync(workspace, { force: true, recursive: true });
		}
	});
	it('warns about a missing exact file when a non-glob path does not exist', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
		const warnings: string[] = [];

		try {
			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, { action: 'remove', files: ['missing.txt'] });

			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /action wants to remove .*but it does not exist/u);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});
	it('returns nested group candidates when the GitLab source has more than two path segments', () => {
		const source = 'gitlab:gitlab-org/frontend/utils#v0.3.4';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[0].user, 'gitlab-org');
		assert.equal(candidates[0].name, 'frontend');
		assert.equal(candidates[0].subdir, '/utils');
		assert.equal(candidates[1].user, 'gitlab-org/frontend');
		assert.equal(candidates[1].name, 'utils');
		assert.equal(candidates[1].subdir, undefined);
	});
	it('returns nested group candidates when the GitLab source uses ssh transport', () => {
		const source = 'git@gitlab.com:gitlab-org/frontend/utils#v0.3.4';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[1].url, 'https://gitlab.com/gitlab-org/frontend/utils');
		assert.equal(candidates[1].ssh, 'ssh://git@gitlab.com/gitlab-org/frontend/utils');
	});
	it('returns nested group candidates when the GitLab source uses an explicit ssh URL', () => {
		const source = 'ssh://git@gitlab.com/gitlab-org/frontend/utils#v0.3.4';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[1].url, 'https://gitlab.com/gitlab-org/frontend/utils');
	});
	it('preserves the subdirectory when a full GitLab tree URL points to a nested group', () => {
		const source = 'https://gitlab.com/gitlab-org/frontend/utils/-/tree/v0.3.4/subdir';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[0].user, 'gitlab-org');
		assert.equal(candidates[0].name, 'frontend');
		assert.equal(candidates[0].subdir, '/subdir');
		assert.equal(candidates[1].user, 'gitlab-org/frontend');
		assert.equal(candidates[1].name, 'utils');
		assert.equal(candidates[1].subdir, '/subdir');
	});
	it('returns nested group candidates when the GitLab source uses http', () => {
		const source = 'http://gitlab.com/gitlab-org/frontend/utils/-/tree/v0.3.4';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[1].url, 'https://gitlab.com/gitlab-org/frontend/utils');
	});
	it('returns nested group candidates when the GitLab source omits a ref', () => {
		const source = 'gitlab:gitlab-org/frontend/utils';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[1].user, 'gitlab-org/frontend');
		assert.equal(candidates[1].name, 'utils');
		assert.equal(candidates[1].ref, 'HEAD');
	});
	it('preserves the shorthand subdir when a GitLab path contains a subdirectory segment', () => {
		const source = 'gitlab:user/repo/subdir#ref';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[0].user, 'user');
		assert.equal(candidates[0].name, 'repo');
		assert.equal(candidates[0].subdir, '/subdir');
	});
	it('uses the custom domain when the GitLab source uses the gitlab protocol', () => {
		const source = 'gitlab://git.example.com/group/sub/project';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 2);
		assert.equal(candidates[1].url, 'https://git.example.com/group/sub/project');
		assert.equal(candidates[1].ssh, 'ssh://git@git.example.com/group/sub/project');
	});
	it('strips the .git suffix when the GitLab source includes one', () => {
		const source = 'git@gitlab.com:group/project.git#ref';
		const repo = parse(source);
		const candidates = generateGitlabRepoCandidates(source, repo);

		assert.equal(candidates.length, 1);
		assert.equal(candidates[0].user, 'group');
		assert.equal(candidates[0].name, 'project');
	});
	it('returns the original repo when the source is not GitLab', () => {
		const repo = parse('github:user/repo');
		const candidates = generateGitlabRepoCandidates('github:user/repo', repo);

		assert.equal(candidates.length, 1);
		assert.equal(candidates[0], repo);
	});

	async function withCloneFiles(
		files: string[],
		setup: (target: string) => void,
		assertions: (dest: string) => void,
	) {
		fs.mkdirSync(suiteTmp, { recursive: true });
		const dest = fs.mkdtempSync(path.join(suiteTmp, 'files-'));
		const stub = vi
			.spyOn(Degit.prototype as any, 'cloneToDestination')
			.mockImplementation((target: string) => {
				setup(target);
				return Promise.resolve();
			});

		try {
			await degit('Rich-Harris/degit-test-repo', { force: true, files }).clone(dest);
			assertions(dest);
		} finally {
			stub.mockRestore();
			fs.rmSync(suiteTmp, { force: true, recursive: true });
		}
	}

	it('keeps only the requested files and degit.json when the clone finishes', async () => {
		await withCloneFiles(
			['README.md'],
			(target) => {
				fs.writeFileSync(path.join(target, 'README.md'), 'readme');
				fs.writeFileSync(path.join(target, 'package.json'), '{}');
				fs.writeFileSync(path.join(target, 'degit.json'), 'not an array');
			},
			(dest) => {
				assert.equal(fs.existsSync(path.join(dest, 'README.md')), true);
				assert.equal(fs.existsSync(path.join(dest, 'package.json')), false);
				assert.equal(fs.existsSync(path.join(dest, 'degit.json')), true);
			},
		);
	});

	it('applies remove directives to kept files when files includes the removed path', async () => {
		await withCloneFiles(
			['README.md', 'package.json'],
			(target) => {
				fs.writeFileSync(path.join(target, 'README.md'), 'readme');
				fs.writeFileSync(path.join(target, 'package.json'), '{}');
				fs.writeFileSync(
					path.join(target, 'degit.json'),
					JSON.stringify([{ action: 'remove', files: 'package.json' }]),
				);
			},
			(dest) => {
				assert.equal(fs.existsSync(path.join(dest, 'README.md')), true);
				assert.equal(fs.existsSync(path.join(dest, 'package.json')), false);
				assert.equal(fs.existsSync(path.join(dest, 'degit.json')), false);
			},
		);
	});

	it('returns an instance with repo undefined and doActions as a function when called with no arguments', () => {
		const emitter = degit();

		assert.equal(emitter.repo, undefined);
		assert.equal(typeof emitter.doActions, 'function');
	});

	function assertNoActionsCache() {
		assert.equal(
			fs.existsSync(suiteCache) &&
				fs.readdirSync(suiteCache).some((name) => name.startsWith('actions-')),
			false,
		);
	}

	async function withDoActionsDest(callback: (dest: string) => Promise<void>) {
		fs.mkdirSync(suiteTmp, { recursive: true });
		const dest = fs.mkdtempSync(path.join(suiteTmp, 'doactions-'));
		try {
			await callback(dest);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	}

	it('rejects a missing destination when doActions has no clone directive', async () => {
		const missingDest = path.join(suiteTmp, 'missing-dest');
		fs.rmSync(missingDest, { force: true, recursive: true });

		await assert.rejects(
			async () =>
				await degit().doActions(
					[{ action: 'remove', files: ['x'] }] as Directive[],
					missingDest,
				),
			(err: any) => err?.code === 'MISSING_DEST',
		);
	});

	it('rejects a non-directory destination when doActions has no clone directive', async () => {
		await withDoActionsDest(async (dest) => {
			const fileDest = path.join(dest, 'not-a-dir');
			fs.writeFileSync(fileDest, 'not a directory');

			await assert.rejects(
				async () =>
					await degit().doActions(
						[{ action: 'remove', files: ['x'] }] as Directive[],
						fileDest,
					),
				(err: any) => err?.code === 'ENOTDIR',
			);
		});
	});

	it('doActions runs a remove directive when called without a source and cleans the staging directory', async () => {
		await withDoActionsDest(async (dest) => {
			fs.writeFileSync(path.join(dest, 'x'), 'x');

			await degit().doActions([{ action: 'remove', files: ['x'] }] as Directive[], dest);

			assert.equal(fs.existsSync(path.join(dest, 'x')), false);
			assertNoActionsCache();
		});
	});

	it('doActions runs a search_replace directive without a source when the PROJECT_NAME env var is set', async () => {
		await withDoActionsDest(async (dest) => {
			fs.writeFileSync(path.join(dest, 'x'), '{{project_name}}');

			process.env.PROJECT_NAME = 'foo';

			await degit().doActions(
				[
					{
						action: 'search_replace',
						files: ['x'],
						pattern: '\\{\\{project_name\\}\\}',
						replacement: 'PROJECT_NAME',
					},
				] as Directive[],
				dest,
			);

			assert.equal(fs.readFileSync(path.join(dest, 'x'), 'utf8'), 'foo');
			assertNoActionsCache();
		});
	});

	it('clone() rejects with MISSING_SRC when called on a source-less instance', async () => {
		await withDoActionsDest(async (dest) => {
			await assert.rejects(
				async () => await degit().clone(dest),
				(err: any) => err?.code === 'MISSING_SRC',
			);
		});
	});

	it('rejects an empty string source with BAD_SRC when the source is an empty string', () => {
		assert.throws(
			() => degit(''),
			(err: any) => err?.code === 'BAD_SRC',
		);
	});

	it('doActions runs a second time when called on the same source-less instance', async () => {
		await withDoActionsDest(async (dest) => {
			fs.writeFileSync(path.join(dest, 'x'), 'x');

			const stub = vi.spyOn(Degit.prototype, 'clone').mockImplementation((target: string) => {
				fs.writeFileSync(path.join(target, 'y'), 'y');
				return Promise.resolve();
			});

			try {
				const emitter = degit();

				await emitter.doActions(
					[{ action: 'clone', src: 'user/repo' }] as Directive[],
					dest,
				);

				assert.equal(fs.existsSync(path.join(dest, 'x')), true);
				assert.equal(fs.existsSync(path.join(dest, 'y')), true);

				await emitter.doActions([{ action: 'remove', files: ['y'] }] as Directive[], dest);

				assert.equal(fs.existsSync(path.join(dest, 'x')), true);
				assert.equal(fs.existsSync(path.join(dest, 'y')), false);
			} finally {
				stub.mockRestore();
			}
		});
	});

	it('doActions restores the destination and cleans up when a clone directive fails', async () => {
		await withDoActionsDest(async (dest) => {
			fs.writeFileSync(path.join(dest, 'x'), 'x');

			const stub = vi.spyOn(Degit.prototype, 'clone').mockImplementation(() => {
				throw new DegitError('mock clone failure', { code: 'COULD_NOT_DOWNLOAD' });
			});

			try {
				await assert.rejects(
					async () =>
						await degit().doActions(
							[{ action: 'clone', src: 'user/repo' }] as Directive[],
							dest,
						),
					(err: any) => err?.code === 'COULD_NOT_DOWNLOAD',
				);

				assert.equal(fs.existsSync(path.join(dest, 'x')), true);
				assertNoActionsCache();
			} finally {
				stub.mockRestore();
			}
		});
	});

	it('removes a clone-created file when a remove directive targets it after a clone', async () => {
		const stub = vi.spyOn(Degit.prototype, 'clone').mockImplementation((target: string) => {
			fs.writeFileSync(path.join(target, 'README.md'), 'clone readme');
			fs.writeFileSync(path.join(target, 'LICENSE'), 'clone license');
			return Promise.resolve();
		});

		try {
			await withDoActionsDest(async (dest) => {
				fs.writeFileSync(path.join(dest, 'x'), 'x');

				await degit().doActions(
					[
						{ action: 'clone', src: 'user/repo' } as Directive,
						{ action: 'remove', files: ['LICENSE'] } as Directive,
					],
					dest,
				);

				assert.equal(fs.existsSync(path.join(dest, 'x')), true);
				assert.equal(fs.existsSync(path.join(dest, 'README.md')), true);
				assert.equal(fs.existsSync(path.join(dest, 'LICENSE')), false);
				assertNoActionsCache();
			});
		} finally {
			stub.mockRestore();
		}
	});
});
/* eslint-enable max-lines-per-function */
