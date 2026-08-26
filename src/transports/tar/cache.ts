import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Repo } from '../../domain/repo.js';
import { tryReadJson } from '../../shared/utils.js';

export function readCachedRefs(dir: string) {
	return (tryReadJson(path.join(dir, 'map.json')) || {}) as Record<string, string>;
}

export async function updateCache(
	dir: string,
	repo: Repo,
	hash: string,
	cached: Record<string, string>,
) {
	const cache = new Map(Object.entries(cached));
	const logs = tryReadJson(path.join(dir, 'access.json')) || {};
	logs[repo.ref] = new Date().toISOString();
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	await writeFile(path.join(dir, 'access.json'), JSON.stringify(logs, null, '  '));

	const currentHash = cache.get(repo.ref);
	// oxlint-disable-next-line security/detect-possible-timing-attacks
	if (currentHash === hash) {
		return;
	}

	cache.set(repo.ref, hash);

	if (currentHash && ![...cache.values()].includes(currentHash)) {
		try {
			await rm(path.join(dir, `${currentHash}.tar.gz`), { force: true, recursive: true });
		} catch {}
	}
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	await writeFile(
		path.join(dir, 'map.json'),
		JSON.stringify(Object.fromEntries(cache), null, '  '),
	);
}
