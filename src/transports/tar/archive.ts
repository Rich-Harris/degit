import { constants, cp, mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { getProvider, type Repo } from '../../domain/repo.js';
import { readCachedRefs, updateCache } from './cache.js';
import { DegitError, mkdirp } from '../../shared/utils.js';
import type { EventInfo, FetchFn } from '../../domain/types.js';

type TarContext = {
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
	const provider = getProvider(repo.site);
	if (!provider) {
		throw new DegitError(`degit supports GitHub, GitLab, Sourcehut and BitBucket`, {
			code: 'UNSUPPORTED_HOST',
		});
	}

	return {
		file: path.join(dir, `${hash}.tar.gz`),
		subdir: repo.subdir ? `${repo.name}-${hash}${repo.subdir}` : null,
		url: provider.archiveUrl(repo, hash),
		workDir: await mkdtemp(path.join(dir, 'extract-')),
	};
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
	} catch {
		// Missing files and permission-denied paths are both treated as absent.
	}

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

		await untarWithRetry(context, source);
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

async function untarWithRetry(context: TarContext, source: ArchiveSource) {
	try {
		await untar(source.file, source.workDir, source.subdir);
	} catch (error) {
		if ((error as { code?: string }).code !== 'TAR_BAD_ARCHIVE') {
			throw error;
		}

		try {
			await rm(source.file, { force: true, recursive: true });
		} catch {
			// Ignore cleanup failures and continue with a fresh download.
		}

		await context.fetch(source.url, source.file, context.proxy);
		await untar(source.file, source.workDir, source.subdir);
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
	const shouldFallbackToGit = await extractArchive(context, source, dest);

	if (shouldFallbackToGit) {
		context.warn({
			message: `git lfs pointer detected in tar snapshot; falling back to git clone`,
		});
		await context.cloneWithGit(dest);
	}

	await updateCache(dir, context.repo, hash, cached);
}

function untar(file: string, dest: string, subdir: string | null = null) {
	return tar.extract(
		{
			C: dest,
			file,
			strip: subdir ? subdir.split('/').length : 1,
		},
		subdir ? [subdir] : [],
	);
}

async function hasGitLfsPointers(dir: string): Promise<boolean> {
	// Paths are discovered from extracted archive contents under a controlled temp dir.
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

		// Paths are discovered from extracted archive contents under a controlled temp dir.
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
	// Paths are discovered from extracted archive contents under a controlled temp dir.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const entries = await readdir(sourceDir, { withFileTypes: true });
	await Promise.all(
		entries.map(async (entry) => {
			const sourcePath = path.join(sourceDir, entry.name);
			const destinationPath = path.join(destDir, entry.name);
			// cp() overwrites existing files the same way the old copy behavior did for this path.
			await cp(sourcePath, destinationPath, { recursive: true });
		}),
	);
}
