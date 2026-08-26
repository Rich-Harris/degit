import { constants, cp, mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { providerArchiveTemplates, type Repo } from '../../domain/repo.js';
import { readCachedRefs, updateCache } from './cache.js';
import { DegitError, mkdirp } from '../../shared/utils.js';
import type { EventInfo, FetchFn } from '../../domain/types.js';

/* eslint-disable max-lines */

export type TarContext = {
	cache?: boolean;
	cloneWithGit(dest: string, ref?: string): Promise<void>;
	fetch: FetchFn;
	getHash(repo: Repo, cached: Record<string, string>): Promise<string | undefined>;
	getHashFromCache(repo: Repo, cached: Record<string, string>): string | undefined;
	proxy?: string;
	repo: Repo;
	verboseInfo(info: EventInfo): void;
	warn(info: EventInfo): void;
};

type ArchiveSource = {
	file: string;
	subdir: string | null;
	url: string;
	workDir: string;
};

async function resolveArchiveHash(
	context: TarContext,
	cached: Record<string, string>,
	dest: string,
) {
	const hash = context.cache
		? context.getHashFromCache(context.repo, cached)
		: await context.getHash(context.repo, cached);

	if (hash) {
		return hash;
	}

	if (context.repo.transport === 'ssh') {
		context.warn({
			message: `tar lookup failed; falling back to git clone`,
		});
		await context.cloneWithGit(dest);
		return;
	}

	throw new DegitError(`could not find commit hash for ${context.repo.ref}`, {
		code: 'MISSING_REF',
		ref: context.repo.ref,
	});
}

async function createArchiveSource(dir: string, repo: Repo, hash: string): Promise<ArchiveSource> {
	return {
		file: path.join(dir, `${hash}.tar.gz`),
		subdir: null,
		url: providerArchiveTemplates[repo.site](repo, hash),
		workDir: await mkdtemp(path.join(dir, 'extract-')),
	};
}

// eslint-disable-next-line max-lines-per-function
async function resolveArchiveSubdir(context: TarContext, source: ArchiveSource) {
	const subdir = context.repo.subdir?.split('/').filter(Boolean).join('/');
	if (!subdir) {
		return;
	}

	const members: string[] = [];
	try {
		await withArchiveRetry(context, source, async () => {
			members.length = 0;
			let fatalWarning: Error | undefined;
			await tar.t({
				file: source.file,
				onReadEntry: (entry) => {
					members.push(entry.path);
				},
				onwarn: (code, message) => {
					if (code === 'TAR_BAD_ARCHIVE') {
						fatalWarning = new Error(message);
						(fatalWarning as { code?: string }).code = code;
					}
				},
			});
			if (fatalWarning) {
				// eslint-disable-next-line no-throw-literal
				throw fatalWarning;
			}
		});
	} catch (error) {
		throw new DegitError(`could not inspect ${source.url}`, {
			code: 'COULD_NOT_DOWNLOAD',
			url: source.url,
			original: error,
		});
	}

	const topLevels = [...new Set(members.map((member) => member.split('/')[0]))];
	for (const rootDir of topLevels) {
		const candidate = `${rootDir}/${subdir}`;
		const candidatePrefix = `${candidate}/`;
		const isMatch = members.some((member) => {
			const normalized = member.replace(/\/$/u, '');
			return normalized === candidate || normalized.startsWith(candidatePrefix);
		});

		if (isMatch) {
			source.subdir = candidate;
			return;
		}
	}

	throw new DegitError(`could not find subdirectory /${subdir} in archive`, {
		code: 'MISSING_SUBDIR',
		subdir: `/${subdir}`,
	});
}

async function ensureArchiveFile(context: TarContext, source: ArchiveSource) {
	if (context.cache) {
		return;
	}

	try {
		await access(source.file, constants.F_OK);
		context.verboseInfo({
			code: 'FILE_EXISTS',
			message: `${source.file} already exists locally`,
		});
		return;
	} catch {}

	mkdirp(path.dirname(source.file));

	if (context.proxy) {
		context.verboseInfo({
			code: 'PROXY',
			message: `using proxy ${context.proxy}`,
		});
	}

	context.verboseInfo({
		code: 'DOWNLOADING',
		message: `downloading ${source.url} to ${source.file}`,
	});

	try {
		await context.fetch(source.url, source.file, context.proxy);
	} catch (error) {
		throw new DegitError(`could not download ${source.url}`, {
			code: 'COULD_NOT_DOWNLOAD',
			url: source.url,
			original: error,
		});
	}
}

async function extractArchive(context: TarContext, source: ArchiveSource, dest: string) {
	try {
		context.verboseInfo({
			code: 'EXTRACTING',
			message: `extracting ${source.subdir ? `${context.repo.subdir} from ` : ''}${source.file} to ${source.workDir}`,
		});

		const [strip, files] = source.subdir
			? [source.subdir.split('/').length, [source.subdir]]
			: [1, []];

		await withArchiveRetry(context, source, () =>
			tar.extract(
				{
					C: source.workDir,
					file: source.file,
					strip,
				},
				files,
			),
		);
		const hasPointers = await hasGitLfsPointers(source.workDir);
		if (!hasPointers) {
			mkdirp(dest);
			await copyExtractedFiles(source.workDir, dest);
		}

		return hasPointers;
	} catch (error) {
		throw new DegitError(`could not download ${source.url}`, {
			code: 'COULD_NOT_DOWNLOAD',
			url: source.url,
			original: error,
		});
	} finally {
		await rm(source.workDir, { force: true, recursive: true });
	}
}

async function withArchiveRetry(
	context: TarContext,
	source: ArchiveSource,
	operation: () => Promise<void>,
): Promise<void> {
	try {
		await operation();
	} catch (error) {
		const code = (error as { code?: string }).code;
		const isRetryableArchiveError =
			typeof code === 'string' &&
			/^(TAR_BAD_ARCHIVE|TAR_ABORT|ZLIB_ERROR|Z_(BUF|DATA|STREAM|MEM|VERSION)_ERROR)$/u.test(
				code,
			);
		if (!isRetryableArchiveError) {
			throw error;
		}

		if (context.cache) {
			throw error;
		}

		try {
			await rm(source.file, { force: true, recursive: true });
		} catch {}

		await context.fetch(source.url, source.file, context.proxy);
		await operation();
	}
}

export async function cloneWithTar(context: TarContext, dir: string, dest: string): Promise<void> {
	const cached = readCachedRefs(dir);
	const hash = await resolveArchiveHash(context, cached, dest);
	if (!hash) {
		return;
	}

	mkdirp(dir);
	const source = await createArchiveSource(dir, context.repo, hash);
	await ensureArchiveFile(context, source);
	if (context.repo.subdir) {
		await resolveArchiveSubdir(context, source);
	}

	const shouldFallbackToGit = await extractArchive(context, source, dest);

	if (shouldFallbackToGit) {
		context.warn({
			message: `git lfs pointer detected in tar snapshot; falling back to git clone`,
		});
		await context.cloneWithGit(dest);
	}

	await updateCache(dir, context.repo, hash, cached);
}

async function hasGitLfsPointers(dir: string): Promise<boolean> {
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const entries = await readdir(dir, { withFileTypes: true });
	const checks = entries.map(async (entry) => {
		const entryPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			return hasGitLfsPointers(entryPath);
		}

		if (!entry.isFile()) {
			return false;
		}

		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const contents = await readFile(entryPath, 'utf8');
		return (
			/^version https:\/\/git-lfs\.github\.com\/spec\/v1$/mu.test(contents) &&
			/^oid sha256:[0-9a-f]{64}$/mu.test(contents) &&
			/^size \d+$/mu.test(contents)
		);
	});

	return (await Promise.all(checks)).some(Boolean);
}

async function copyExtractedFiles(sourceDir: string, destDir: string) {
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const entries = await readdir(sourceDir, { withFileTypes: true });
	await Promise.all(
		entries.map(async (entry) => {
			const sourcePath = path.join(sourceDir, entry.name);
			const destinationPath = path.join(destDir, entry.name);
			await cp(sourcePath, destinationPath, { recursive: true });
		}),
	);
}
