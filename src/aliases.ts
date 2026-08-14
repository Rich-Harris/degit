import fs from 'node:fs';
import path from 'node:path';
import colors from 'yoctocolors';
import { base, mkdirp, tryReadJson } from './shared/utils.js';

export const aliasesFile = path.join(base, 'aliases.json');

/* eslint-disable security/detect-non-literal-fs-filename */
export function loadAliases(): Record<string, string> {
	return (tryReadJson(aliasesFile) as Record<string, string>) ?? {};
}

function writeAliases(aliases: Record<string, string>) {
	mkdirp(base);
	fs.writeFileSync(aliasesFile, JSON.stringify(aliases, null, 2));
}
/* eslint-enable security/detect-non-literal-fs-filename */

export function resolveAlias(aliases: Record<string, string>, name: string): string | undefined {
	// oxlint-disable-next-line security/detect-object-injection
	return Object.hasOwn(aliases, name) ? aliases[name] : undefined;
}

export function saveAlias(name: string, repo: string) {
	const aliases = loadAliases();
	const updated = { ...aliases, [name]: repo };
	writeAliases(updated);
}

export function removeAlias(name: string): boolean {
	const aliases = loadAliases();

	if (!Object.hasOwn(aliases, name)) {
		return false;
	}

	// oxlint-disable-next-line security/detect-object-injection
	delete aliases[name];

	if (Object.keys(aliases).length === 0) {
		fs.rmSync(aliasesFile, { force: true });
	} else {
		writeAliases(aliases);
	}

	return true;
}

export function handleAliasSubcommand(args: string[]) {
	const repo = args[1];
	const name = args[2];

	if (!repo || !name) {
		console.error(colors.red('! usage: degit alias <repo> <name>'));
		process.exit(1);
	}

	saveAlias(name, repo);
	console.log(colors.green(`> added alias '${name}' -> ${repo}`));
}

export function handleUnaliasSubcommand(args: string[]) {
	const name = args[1];

	if (!name) {
		console.error(colors.red('! usage: degit unalias <name>'));
		process.exit(1);
	}

	if (!removeAlias(name)) {
		console.error(colors.red(`! alias '${name}' not found`));
		process.exit(1);
	}

	console.log(colors.green(`> removed alias '${name}'`));
}

export function handleListSubcommand() {
	const aliases = loadAliases();
	const entries = Object.entries(aliases).toSorted(([a], [b]) => a.localeCompare(b));

	if (entries.length === 0) {
		console.log('no aliases');
		return;
	}

	for (const [name, repo] of entries) {
		console.log(`${name} -> ${repo}`);
	}
}
