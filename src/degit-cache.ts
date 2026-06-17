import { timingSafeEqual } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import type { Repo } from './repo.js';
import { tryRequire } from './utils.js';

function sameHash(left: string | undefined, right: string) {
	if (!left || left.length !== right.length) {
		return false;
	}

	return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function mapFromRecord(record: Record<string, string>) {
	return new Map(Object.entries(record));
}

function recordFromMap(map: Map<string, string>) {
	return Object.fromEntries(map);
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
	const cache = mapFromRecord(cached);
	const logs = tryRequire(path.join(dir, 'access.json')) || {};
	logs[repo.ref] = new Date().toISOString();
	// Dynamic cache file paths are derived from repo/ref values within the cache root.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	await fs.writeFile(path.join(dir, 'access.json'), JSON.stringify(logs, null, '  '));

	const currentHash = cache.get(repo.ref);
	if (sameHash(currentHash, hash)) {
		return;
	}

	if (currentHash && ![...cache.values()].some((value) => sameHash(value, hash))) {
		try {
			await fs.remove(path.join(dir, `${currentHash}.tar.gz`));
		} catch {
			// Ignore cache cleanup failures.
		}
	}

	cache.set(repo.ref, hash);
	// Dynamic cache file paths are derived from repo/ref values within the cache root.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	await fs.writeFile(
		path.join(dir, 'map.json'),
		JSON.stringify(recordFromMap(cache), null, '  '),
	);
}
