import fs from 'fs-extra';
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
): Promise<string | undefined> {
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

function createArchiveSource(dir: string, repo: Repo, hash: string): Promise<ArchiveSource> {
	const provider = getProvider(repo.site);
	if (!provider) {
		throw new DegitError(`degit supports GitHub, GitLab, Sourcehut and BitBucket`, {
			code: 'UNSUPPORTED_HOST',
		});
	}

	return fs.mkdtemp(path.join(dir, 'extract-')).then((workDir) => ({
		file: path.join(dir, `${hash}.tar.gz`),
		subdir: repo.subdir ? `${repo.name}-${hash}${repo.subdir}` : null,
		url: provider.archiveUrl(repo, hash),
		workDir,
	}));
}

function untar(file: string, dest: string, subdir: string | null = null): Promise<void> {
	return tar.extract(
		{
			C: dest,
			file,
			strip: subdir ? subdir.split('/').length : 1,
		},
		subdir ? [subdir] : [],
	);
}

function ensureArchiveFile(context: TarContext, source: ArchiveSource): Promise<void> {
	if (context.cache) {
		return Promise.resolve();
	}

	return fs.pathExists(source.file).then((exists) => {
		if (exists) {
			context.verboseInfo({
				code: 'FILE_EXISTS',
				message: `${source.file} already exists locally`,
			});
			return;
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

		return Promise.resolve()
			.then(() => context.fetch(source.url, source.file, context.proxy))
			.catch((error) => {
				throw new DegitError(`could not download ${source.url}`, {
					code: 'COULD_NOT_DOWNLOAD',
					url: source.url,
					original: error,
				});
			});
	});
}

function hasGitLfsPointers(dir: string): Promise<boolean> {
	// Paths are discovered from extracted archive contents under a controlled temp dir.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	return fs.readdir(dir, { withFileTypes: true }).then((entries) =>
		Promise.all(
			entries.map((entry) => {
				const entryPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					return hasGitLfsPointers(entryPath);
				}

				if (!entry.isFile()) {
					return Promise.resolve(false);
				}

				// Paths are discovered from extracted archive contents under a controlled temp dir.
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				return fs.readFile(entryPath, 'utf8').then((contents) => {
					return (
						/^version https:\/\/git-lfs\.github\.com\/spec\/v1$/m.test(contents) &&
						/^oid sha256:[0-9a-f]{64}$/m.test(contents) &&
						/^size \d+$/m.test(contents)
					);
				});
			}),
		).then((checks) => checks.some(Boolean)),
	);
}

function copyExtractedFiles(sourceDir: string, destDir: string): Promise<void> {
	// Paths are discovered from extracted archive contents under a controlled temp dir.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	return fs.readdir(sourceDir, { withFileTypes: true }).then((entries) =>
		Promise.all(
			entries.map((entry) => {
				const sourcePath = path.join(sourceDir, entry.name);
				const destinationPath = path.join(destDir, entry.name);
				return fs.copy(sourcePath, destinationPath);
			}),
		),
	);
}

function untarWithRetry(context: TarContext, source: ArchiveSource): Promise<void> {
	return untar(source.file, source.workDir, source.subdir).catch((error) => {
		if ((error as { code?: string }).code !== 'TAR_BAD_ARCHIVE') {
			throw error;
		}

		return fs
			.remove(source.file)
			.catch(() => {
				// Ignore cleanup failures and continue with a fresh download.
			})
			.then(() => context.fetch(source.url, source.file, context.proxy))
			.then(() => untar(source.file, source.workDir, source.subdir));
	});
}

function extractArchive(
	context: TarContext,
	source: ArchiveSource,
	dest: string,
): Promise<boolean> {
	context.verboseInfo({
		code: 'EXTRACTING',
		message: `extracting ${source.subdir ? `${context.repo.subdir} from ` : ''}${source.file} to ${source.workDir}`,
	});

	return untarWithRetry(context, source)
		.then(() => hasGitLfsPointers(source.workDir))
		.then((hasPointers) => {
			if (!hasPointers) {
				mkdirp(dest);
				return copyExtractedFiles(source.workDir, dest).then(() => hasPointers);
			}

			return hasPointers;
		})
		.catch((error) => {
			throw new DegitError(`could not download ${source.url}`, {
				code: 'COULD_NOT_DOWNLOAD',
				url: source.url,
				original: error,
			});
		})
		.finally(() => fs.remove(source.workDir));
}

export function cloneWithTar(context: TarContext, dir: string, dest: string): Promise<void> {
	const cached = readCachedRefs(dir);
	return resolveArchiveHash(context, cached, dest).then((hash) => {
		if (!hash) {
			return;
		}

		mkdirp(dir);
		return createArchiveSource(dir, context.repo, hash)
			.then((source) =>
				ensureArchiveFile(context, source).then(() =>
					extractArchive(context, source, dest),
				),
			)
			.then((shouldFallbackToGit) => {
				if (shouldFallbackToGit) {
					context.warn({
						message: `git lfs pointer detected in tar snapshot; falling back to git clone`,
					});
					return context.cloneWithGit(dest);
				}
			})
			.then(() => updateCache(dir, context.repo, hash, cached));
	});
}
