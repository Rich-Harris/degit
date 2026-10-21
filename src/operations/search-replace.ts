import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import colors from 'yoctocolors';
import { safeResolve } from '../shared/utils.js';
import type { EventInfo, SearchReplaceDirective } from '../domain/types.js';

const MAX_SEARCH_REPLACE_BYTES = 10 * 1024 * 1024;
const SEARCH_REPLACE_TIMEOUT_MS = 1000;
const SEARCH_REPLACE_SCRIPT = new vm.Script('text.replace(pattern, () => replacement)');
const SECRET_ENV_PARTS = new Set([
	'AUTH',
	'CERT',
	'CREDENTIAL',
	'CREDENTIALS',
	'KEY',
	'PASS',
	'PASSWORD',
	'PASSWD',
	'PRIVATE',
	'PWD',
	'SECRET',
	'TOKEN',
]);

function looksLikeSecret(name: string): boolean {
	return name.split(/[^A-Za-z]+/u).some((part) => SECRET_ENV_PARTS.has(part.toUpperCase()));
}

function resolveReplacement(
	action: SearchReplaceDirective,
	allowEnv: string[] | undefined,
	info: (info: EventInfo) => void,
	warn: (info: EventInfo) => void,
) {
	if (allowEnv !== undefined && !allowEnv.includes(action.replacement)) {
		warn({
			message: `action wants to search_replace using env var ${colors.bold(action.replacement)} but it is not in --allow-env, skipping`,
		});
		return;
	}

	const replacement = process.env[action.replacement];

	if (replacement === undefined) {
		warn({
			message: `action wants to search_replace using env var ${colors.bold(action.replacement)} but it is not defined, skipping`,
		});
		return;
	}

	info({
		message: `search_replace reading env var ${colors.bold(action.replacement)}`,
	});

	if (looksLikeSecret(action.replacement)) {
		warn({
			message: `search_replace is writing env var ${colors.bold(action.replacement)} into files; the name looks like a secret`,
		});
	}

	return replacement;
}

export function searchReplaceFiles(
	dest: string,
	action: SearchReplaceDirective,
	allowEnv: string[] | undefined,
	info: (info: EventInfo) => void,
	warn: (info: EventInfo) => void,
) {
	/* eslint-disable security/detect-non-literal-regexp, security/detect-non-literal-fs-filename */
	const files = Array.isArray(action.files) ? action.files : [action.files];
	const root = path.resolve(dest);
	const replacement = resolveReplacement(action, allowEnv, info, warn);

	if (replacement === undefined) {
		return;
	}

	let pattern: RegExp;
	try {
		pattern = new RegExp(action.pattern, 'gu');
	} catch {
		warn({
			message: `action wants to search_replace using an invalid pattern ${colors.bold(action.pattern)}, skipping`,
		});
		return;
	}

	const replacedFiles = files.flatMap((file) =>
		replaceFile(root, file, pattern, replacement, warn),
	);

	if (replacedFiles.length > 0) {
		info({
			message: `replaced content in ${colors.bold(String(replacedFiles.length))} files: ${replacedFiles.map((file) => colors.bold(file)).join(', ')}`,
		});
	}
}

function replaceFile(
	root: string,
	file: string,
	pattern: RegExp,
	replacement: string,
	warn: (info: EventInfo) => void,
) {
	const filePath = safeResolve(root, file);
	if (!filePath) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it is outside the destination, skipping`,
		});
		return [];
	}

	try {
		const realPath = resolveWritableFile(root, file, filePath, warn);
		if (!realPath) {
			return [];
		}
		const content = fs.readFileSync(realPath, 'utf8');
		const nextContent = runReplace(content, pattern, replacement);
		if (nextContent === content) {
			return [];
		}
		fs.writeFileSync(realPath, nextContent);
		return [file];
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
			warn({
				message: `search_replace pattern timed out on ${colors.bold(file)}, skipping`,
			});
			return [];
		}
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
			warn({
				message: `action wants to search_replace ${colors.bold(file)} but it does not exist`,
			});
			return [];
		}
		throw error;
	}
}

function resolveWritableFile(
	root: string,
	file: string,
	filePath: string,
	warn: (info: EventInfo) => void,
) {
	const realPath = fs.realpathSync(filePath);
	if (!safeResolve(root, realPath)) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it is outside the destination, skipping`,
		});
		return;
	}
	const stats = fs.statSync(realPath);
	if (stats.isDirectory()) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it is a directory, skipping`,
		});
		return;
	}
	if (stats.size > MAX_SEARCH_REPLACE_BYTES) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it is too large for search_replace, skipping`,
		});
		return;
	}
	return realPath;
}

function runReplace(content: string, pattern: RegExp, replacement: string) {
	return SEARCH_REPLACE_SCRIPT.runInNewContext(
		{ pattern, replacement, text: content },
		{ timeout: SEARCH_REPLACE_TIMEOUT_MS },
	) as string;
}
/* eslint-enable security/detect-non-literal-regexp, security/detect-non-literal-fs-filename */
