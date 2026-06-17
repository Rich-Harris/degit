import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sync as rimraf } from 'rimraf';
import degit from '../../src/index.js';
import { base } from '../../src/utils.js';
import { providerCases } from './index-support.js';
import {
	registerTarExtractionSuites,
	registerTarModeFetchFailureSuite,
} from './index-tar-suites.js';
import { registerGitModeSuites } from './index-git-suites.js';

vi.mock('../../src/utils.js', async () => {
	const actual = await vi.importActual<typeof import('../../src/utils.js')>('../../src/utils.js');

	return {
		...actual,
		base: path.join(process.cwd(), '.tmp', 'index-suite-cache'),
	};
});

const indexTmp = '.tmp/index-suite';

beforeEach(async () => await rimraf(indexTmp));
afterEach(async () => await rimraf(indexTmp));

describe('degit index built entrypoint', () => {
	it('exports a usable JS library when importing the built entrypoint', async () => {
		const builtEntryPoint = path.resolve(process.cwd(), 'dist/index.js');
		const { default: builtDegit } = await import(new URL(`file://${builtEntryPoint}`).href);
		const instance = builtDegit('Rich-Harris/degit-test-repo');

		assert.equal(typeof builtDegit, 'function');
		assert.equal(typeof instance.clone, 'function');
		assert.equal(typeof instance.on, 'function');
	});
});

describe('degit index parser', () => {
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

	it('parses explicit ssh sources as ssh transport', () => {
		const { repo } = degit('git@github.com:Rich-Harris/degit-test-repo');

		assert.equal(repo.transport, 'ssh');
		assert.equal(repo.ssh, 'ssh://git@github.com/Rich-Harris/degit-test-repo');
	});

	it('throws UNSUPPORTED_HOST when the host prefix is not supported', () => {
		assert.throws(
			() => {
				degit('codeberg:Rich-Harris/degit-test-repo');
			},
			(err: any) => err && err.code === 'UNSUPPORTED_HOST',
		);
	});
});

registerTarModeFetchFailureSuite(base);
registerTarExtractionSuites(base);
registerGitModeSuites(base);

describe('degit index clone validation', () => {
	it('rejects with DEST_NOT_EMPTY when destination has files and force is false', async () => {
		fs.mkdirSync('.tmp/index-suite/ne', { recursive: true });
		fs.writeFileSync('.tmp/index-suite/ne/x', '1');
		await assert.rejects(
			async () => await degit('Rich-Harris/degit-test-repo').clone('.tmp/index-suite/ne'),
			(err: any) => err && err.code === 'DEST_NOT_EMPTY',
		);
	});

	it('throws when mode is not a supported value', () => {
		assert.throws(
			() => degit('Rich-Harris/degit-test-repo', { mode: 'svn' }),
			/Valid modes are/,
		);
	});
});

describe('degit index remove', () => {
	it('removes nested directories recursively from the destination', () => {
		const dest = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));

		try {
			fs.mkdirSync(path.join(dest, 'nested', 'child'), { recursive: true });
			fs.writeFileSync(path.join(dest, 'nested', 'child', 'file.txt'), 'nested\n');
			fs.writeFileSync(path.join(dest, 'flat.txt'), 'flat\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.remove(dest, { files: ['nested', 'flat.txt'] });

			assert.equal(fs.existsSync(path.join(dest, 'nested')), false);
			assert.equal(fs.existsSync(path.join(dest, 'flat.txt')), false);
		} finally {
			fs.rmSync(dest, { force: true, recursive: true });
		}
	});

	it('warns and skips paths that escape the destination when removing files', () => {
		const workspace = fs.mkdtempSync(path.join(process.cwd(), 'remove-'));
		const dest = path.join(workspace, 'dest');
		const sibling = path.join(workspace, 'sibling');
		const warnings: string[] = [];

		try {
			fs.mkdirSync(dest, { recursive: true });
			fs.mkdirSync(sibling, { recursive: true });
			fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret\n');

			const emitter = degit('Rich-Harris/degit-test-repo');
			emitter.on('warn', (event) => warnings.push(event.message));

			emitter.remove(dest, { files: ['../sibling'] });

			assert.equal(fs.existsSync(path.join(sibling, 'secret.txt')), true);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /action wants to remove .*outside the destination, skipping/);
			assert.match(warnings[0], /\.\.\/sibling/);
		} finally {
			fs.rmSync(workspace, { force: true, recursive: true });
		}
	});
});
