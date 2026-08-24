import fs from 'node:fs';
import path from 'node:path';
import colors from 'yoctocolors';
import { safeResolve } from '../shared/utils.js';
import type { EventInfo, SearchReplaceDirective } from '../domain/types.js';

export function searchReplaceFiles(
	dest: string,
	action: SearchReplaceDirective,
	info: (info: EventInfo) => void,
	warn: (info: EventInfo) => void,
) {
	/* eslint-disable security/detect-non-literal-regexp, security/detect-non-literal-fs-filename */
	const files = Array.isArray(action.files) ? action.files : [action.files];
	const root = path.resolve(dest);
	const replacement = process.env[action.replacement];

	if (replacement === undefined) {
		warn({
			message: `action wants to search_replace using env var ${colors.bold(action.replacement)} but it is not defined, skipping`,
		});
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
		const realPath = fs.realpathSync(filePath);
		if (!safeResolve(root, realPath)) {
			warn({
				message: `action wants to search_replace ${colors.bold(file)} but it is outside the destination, skipping`,
			});
			return [];
		}
		if (fs.statSync(realPath).isDirectory()) {
			warn({
				message: `action wants to search_replace ${colors.bold(file)} but it is a directory, skipping`,
			});
			return [];
		}
		const content = fs.readFileSync(realPath, 'utf8');
		const nextContent = content.replace(pattern, () => replacement);
		if (nextContent === content) {
			return [];
		}
		fs.writeFileSync(realPath, nextContent);
		return [file];
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
			warn({
				message: `action wants to search_replace ${colors.bold(file)} but it does not exist`,
			});
			return [];
		}
		throw error;
	}
	/* eslint-enable security/detect-non-literal-regexp, security/detect-non-literal-fs-filename */
}
