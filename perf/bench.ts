/* oxlint-disable no-await-in-loop, security/detect-non-literal-fs-filename, security/detect-object-injection */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as tar from 'tar';

type BenchmarkDefinition = {
	cache: boolean;
	name: string;
	setup: () => Promise<BenchmarkRuntime>;
};

type BenchmarkRuntime = {
	cleanup: () => void;
	clone: () => Promise<void>;
};

type BenchmarkBaseline = {
	maxRegression: number;
	medianMs: number;
};

type BenchmarkReport = BenchmarkBaseline & {
	currentMedianMs: number;
	name: string;
	samplesMs: number[];
};

type BenchmarkConfig = {
	iterations: number;
	warmups: number;
};

type BenchmarkResults = {
	benchmarks: Record<string, BenchmarkBaseline>;
	version: number;
};

const config: BenchmarkConfig = {
	iterations: 7,
	warmups: 2,
};

const benchmarkFile = new URL('./baseline.json', import.meta.url);

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'degit-perf-'));
const sandboxHome = path.join(sandboxRoot, 'home');

process.env.HOME = sandboxHome;
process.env.XDG_CACHE_HOME = path.join(sandboxHome, '.cache');
process.env.LOCALAPPDATA = path.join(sandboxHome, 'AppData', 'Local');

const [{ default: degit }, { base }] = await Promise.all([
	import(new URL('../src/index.ts', import.meta.url).href),
	import(new URL('../src/utils.ts', import.meta.url).href),
]);

const baseline = readBaseline();
const fixtureData = await createFixture(degit);

try {
	const reports: BenchmarkReport[] = [];

	for (const benchmark of benchmarks(fixtureData)) {
		const runtime = await benchmark.setup();
		const samplesMs: number[] = [];

		try {
			for (let _ = 0; _ < config.warmups; _ += 1) {
				await runtime.clone();
			}

			for (let _ = 0; _ < config.iterations; _ += 1) {
				const startedAt = performance.now();
				await runtime.clone();
				samplesMs.push(performance.now() - startedAt);
			}
		} finally {
			runtime.cleanup();
		}

		reports.push({
			...baseline.benchmarks[benchmark.name],
			currentMedianMs: median(samplesMs),
			name: benchmark.name,
			samplesMs,
		});
	}

	const failures: string[] = [];

	for (const report of reports) {
		const limitMs = report.medianMs * (1 + report.maxRegression);
		const isRegression = report.currentMedianMs > limitMs;

		printReport(report, limitMs, isRegression);

		if (isRegression) {
			failures.push(
				`${report.name}: current median ${report.currentMedianMs.toFixed(1)}ms exceeded ${limitMs.toFixed(1)}ms`,
			);
		}
	}

	if (failures.length > 0) {
		console.error('\nPerformance regression detected:');
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exitCode = 1;
	}
} finally {
	fs.rmSync(sandboxRoot, { force: true, recursive: true });
}

function benchmarks(fixture: Fixture) {
	return [
		{
			cache: false,
			name: 'clone-cold',
			setup: () => createColdRuntime(fixture),
		},
		{
			cache: true,
			name: 'clone-cached',
			setup: () => createCachedRuntime(fixture),
		},
	] satisfies BenchmarkDefinition[];
}

type Fixture = {
	archiveFile: string;
	cacheRoot: string;
	destRoot: string;
	hash: string;
	repo: ReturnType<typeof degit>['repo'];
	rootDir: string;
	updateCache: () => void;
};

async function createFixture(degitFactory: typeof degit): Promise<Fixture> {
	const rootDir = fs.mkdtempSync(path.join(sandboxRoot, 'fixture-'));
	const archiveRoot = path.join(rootDir, 'degit-perf-fixture');
	const treeRoot = path.join(archiveRoot, 'packages/app');
	const hash = '0123456789abcdef0123456789abcdef01234567';
	const repoSrc = 'Rich-Harris/degit-test-repo';
	const repo = degitFactory(repoSrc).repo;
	const cacheRoot = path.join(base, repo.site, repo.user, repo.name);
	const destRoot = path.join(rootDir, 'dest');
	const archiveFile = path.join(rootDir, 'degit-perf-fixture.tar.gz');

	fs.mkdirSync(path.join(treeRoot, 'lib', 'nested'), { recursive: true });
	for (let index = 0; index < 40; index += 1) {
		fs.writeFileSync(
			path.join(treeRoot, 'lib', 'nested', `file-${index}.txt`),
			`file ${index}\n`,
		);
	}
	fs.writeFileSync(path.join(treeRoot, 'index.js'), 'export default 1;\n');
	fs.writeFileSync(path.join(treeRoot, 'README.md'), '# fixture\n');
	fs.writeFileSync(path.join(archiveRoot, 'packages/ignored.txt'), 'ignored\n');

	await tar.create({ C: rootDir, file: archiveFile, gzip: true }, ['degit-perf-fixture']);

	return {
		archiveFile,
		cacheRoot,
		destRoot,
		hash,
		repo,
		rootDir,
		updateCache: () => {
			fs.mkdirSync(cacheRoot, { recursive: true });
			fs.writeFileSync(
				path.join(cacheRoot, 'map.json'),
				JSON.stringify({ [repo.ref]: hash }, null, '\t'),
			);
			fs.copyFileSync(archiveFile, path.join(cacheRoot, `${hash}.tar.gz`));
		},
	};
}

async function createColdRuntime(fixture: Fixture): Promise<BenchmarkRuntime> {
	const fetch = createCopyFetch(fixture.archiveFile);
	const git = createMockGit(fixture.hash, fixture.repo.url);
	const client = degit('Rich-Harris/degit-test-repo', {
		fetch: fetch.fn,
		git,
	});
	const dest = path.join(fixture.destRoot, 'cold');

	return {
		cleanup: () => {
			fs.rmSync(dest, { force: true, recursive: true });
			fs.rmSync(fixture.cacheRoot, { force: true, recursive: true });
		},
		clone: async () => {
			fs.rmSync(dest, { force: true, recursive: true });
			fs.rmSync(fixture.cacheRoot, { force: true, recursive: true });
			await client.clone(dest);
		},
	};
}

async function createCachedRuntime(fixture: Fixture): Promise<BenchmarkRuntime> {
	fixture.updateCache();
	const client = degit('Rich-Harris/degit-test-repo', {
		cache: true,
		fetch: () => Promise.reject(new Error('cached benchmark should not fetch')),
	});
	const dest = path.join(fixture.destRoot, 'cached');

	return {
		cleanup: () => {
			fs.rmSync(dest, { force: true, recursive: true });
			fs.rmSync(fixture.cacheRoot, { force: true, recursive: true });
		},
		clone: async () => {
			fs.rmSync(dest, { force: true, recursive: true });
			fixture.updateCache();
			await client.clone(dest);
		},
	};
}

function createCopyFetch(sourceFile: string) {
	return {
		fn: async (_url: string, file: string) => {
			fs.copyFileSync(sourceFile, file);
		},
	};
}

function createMockGit(hash: string, url: string) {
	return {
		clone: async () => {
			throw new Error(`unexpected git clone for ${url}`);
		},
		fetchRefs: async () => [{ hash, name: 'main', type: 'HEAD' }],
	};
}

function median(samples: number[]) {
	const sorted = samples.toSorted((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function printReport(report: BenchmarkReport, limitMs: number, isRegression: boolean) {
	const verdict = isRegression ? 'FAIL' : 'PASS';
	console.log(
		`${verdict} ${report.name}: ${report.currentMedianMs.toFixed(1)}ms ` +
			`(baseline ${report.medianMs.toFixed(1)}ms, limit ${limitMs.toFixed(1)}ms)`,
	);
	console.log(`  samples: ${report.samplesMs.map((sample) => sample.toFixed(1)).join(', ')}`);
}

function readBaseline(): BenchmarkResults {
	const fileContents = fs.readFileSync(benchmarkFile, 'utf8');
	const parsed = JSON.parse(fileContents) as BenchmarkResults;

	assert.equal(parsed.version, 1, 'benchmark baseline version must be 1');

	for (const benchmark of ['clone-cold', 'clone-cached']) {
		assert.ok(parsed.benchmarks[benchmark], `missing ${benchmark} baseline`);
	}

	return parsed;
}
