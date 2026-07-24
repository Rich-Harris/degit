import { timingSafeEqual } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Repo } from '../../domain/repo.js';
import { tryRequire } from '../../shared/utils.js';

function sameHash(left: string | undefined, right: string) {
	if (!left || left.length !== right.length) {
		return false;
	}

	return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function readCachedRefs(dir: string) {
	return (tryRequire(path.join(dir, 'map.json')) || {}) as Record<string, string>;
}

export async function updateCache(
	dir: string,
	repo: Repo,
	hash: string,
	cached: Record<string, string>,
) {
	const cache = new Map(Object.entries(cached));
	const logs = tryRequire(path.join(dir, 'access.json')) || {};
	logs[repo.ref] = new Date().toISOString();
	// Dynamic cache file paths are derived from repo/ref values within the cache root.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	await writeFile(path.join(dir, 'access.json'), JSON.stringify(logs, null, '  '));

	const currentHash = cache.get(repo.ref);
	if (sameHash(currentHash, hash)) {
		return;
	}

	if (currentHash && ![...cache.values()].some((value) => sameHash(value, hash))) {
		try {
			await rm(path.join(dir, `${currentHash}.tar.gz`), { force: true, recursive: true });
		} catch {
			// Ignore cache cleanup failures.
		}
	}

	cache.set(repo.ref, hash);
	// Dynamic cache file paths are derived from repo/ref values within the cache root.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	await writeFile(
		path.join(dir, 'map.json'),
		JSON.stringify(Object.fromEntries(cache), null, '  '),
	);
}
