import fs from 'node:fs';
import path from 'node:path';
import colors from 'yoctocolors';
import { DegitError, degitConfigName, tryRequire } from '../shared/utils.js';
import type { Directive, EventInfo, RemoveDirective } from '../domain/types.js';

type Emit = (info: EventInfo) => void;

export function getDirectives(dest: string): Directive[] | false {
	const directivesPath = path.resolve(dest, degitConfigName);
	const directives =
		(tryRequire(directivesPath, { clearCache: true }) as Directive[] | undefined) || false;
	if (directives) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		fs.unlinkSync(directivesPath);
	}

	return directives;
}

/* eslint-disable security/detect-non-literal-fs-filename */
export function checkDirIsEmpty(
	dir: string,
	force: boolean | undefined,
	info: Emit,
	verboseInfo: Emit,
): void {
	try {
		const files = fs.readdirSync(dir);
		if (files.length > 0) {
			if (force) {
				info({
					code: 'DEST_NOT_EMPTY',
					message: `destination directory is not empty. Using options.force, continuing`,
				});
				return;
			}

			throw new DegitError(
				`destination directory is not empty, aborting. Use options.force to override`,
				{ code: 'DEST_NOT_EMPTY' },
			);
		}

		verboseInfo({
			code: 'DEST_IS_EMPTY',
			message: `destination directory is empty`,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
}

export function removeFiles(dest: string, action: RemoveDirective, info: Emit, warn: Emit): void {
	const files = Array.isArray(action.files) ? action.files : [action.files];
	const root = path.resolve(dest);
	const removedFiles = files.flatMap((file) => removeFile(root, file, warn));

	if (removedFiles.length > 0) {
		info({
			code: 'REMOVED',
			message: `removed: ${colors.bold(removedFiles.map((file) => colors.bold(file)).join(', '))}`,
		});
	}
}

function removeFile(root: string, file: string, warn: Emit): string[] {
	const filePath = path.resolve(root, file);
	const relativePath = path.relative(root, filePath);

	if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		warn({
			code: 'FILE_OUTSIDE_DEST',
			message: `action wants to remove ${colors.bold(file)} but it is outside the destination, skipping`,
		});
		return [];
	}

	if (!fs.existsSync(filePath)) {
		warn({
			code: 'FILE_DOES_NOT_EXIST',
			message: `action wants to remove ${colors.bold(file)} but it does not exist`,
		});
		return [];
	}

	if (fs.lstatSync(filePath).isDirectory()) {
		fs.rmSync(filePath, { force: true, recursive: true });
		return [`${file}/`];
	}

	fs.unlinkSync(filePath);
	return [file];
}

/* eslint-enable security/detect-non-literal-fs-filename */
