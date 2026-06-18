import { timingSafeEqual } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import type { Repo } from '../../domain/repo.js';
import { tryRequire } from '../../shared/utils.js';

function sameHash(left: string | undefined, right: string): boolean {
	if (!left || left.length !== right.length) {
		return false;
	}

	return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function mapFromRecord(record: Record<string, string>): Map<string, string> {
	return new Map(Object.entries(record));
}

function recordFromMap(map: Map<string, string>): Record<string, string> {
	return Object.fromEntries(map);
}

export function readCachedRefs(dir: string): Record<string, string> {
	return (tryRequire(path.join(dir, 'map.json')) || {}) as Record<string, string>;
}

export function updateCache(
	dir: string,
	repo: Repo,
	hash: string,
	cached: Record<string, string>,
): Promise<void> {
	const cache = mapFromRecord(cached);
	const logs = (tryRequire(path.join(dir, 'access.json')) || {}) as Record<string, string>;
	logs[repo.ref] = new Date().toISOString();
	// Dynamic cache file paths are derived from repo/ref values within the cache root.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	return fs
		.writeFile(path.join(dir, 'access.json'), JSON.stringify(logs, null, '  '))
		.then(() => {
			const currentHash = cache.get(repo.ref);
			if (sameHash(currentHash, hash)) {
				return;
			}

			const writeCacheFile = (): Promise<void> => {
				cache.set(repo.ref, hash);
				// Dynamic cache file paths are derived from repo/ref values within the cache root.
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				return fs.writeFile(
					path.join(dir, 'map.json'),
					JSON.stringify(recordFromMap(cache), null, '  '),
				);
			};

			if (currentHash && !Array.from(cache.values()).some((value) => sameHash(value, hash))) {
				return fs
					.remove(path.join(dir, `${currentHash}.tar.gz`))
					.catch(() => {
						// Ignore cache cleanup failures.
					})
					.then(writeCacheFile);
			}

			return writeCacheFile();
		});
}
