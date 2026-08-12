import fs from 'node:fs';
import path from 'node:path';
import colors from 'yoctocolors';
import { DegitError, degitConfigName } from '../shared/utils.js';
import type { Directive, EventInfo, RemoveDirective } from '../domain/types.js';

type Emit = (info: EventInfo) => void;

/* eslint-disable security/detect-non-literal-fs-filename */
export function getDirectives(dest: string): Directive[] | false {
	const directivesPath = path.resolve(dest, degitConfigName);

	try {
		if (!fs.lstatSync(directivesPath).isFile()) {
			return false;
		}

		const directives = JSON.parse(fs.readFileSync(directivesPath, 'utf8'));
		if (!Array.isArray(directives)) {
			return false;
		}

		fs.unlinkSync(directivesPath);
		return directives as Directive[];
	} catch {
		return false;
	}
}

export function checkDirIsEmpty(
	dir: string,
	force: boolean | undefined,
	info: Emit,
	verboseInfo: Emit,
) {
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

export function removeFiles(dest: string, action: RemoveDirective, info: Emit, warn: Emit) {
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

function removeFile(root: string, file: string, warn: Emit) {
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

// eslint-disable-next-line max-lines-per-function
export function keepFiles(dest: string, files: string[] | undefined, warn: Emit) {
	if (!files || files.length === 0) {
		return;
	}

	const root = path.resolve(dest);
	const keepFileSet = new Set<string>();
	const keepDirSet = new Set<string>();
	let hasUserKeeps = false;

	for (const file of files) {
		const filePath = path.resolve(root, file);
		const relativePath = path.relative(root, filePath);

		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			warn({
				code: 'FILE_OUTSIDE_DEST',
				message: `action wants to keep ${colors.bold(file)} but it is outside the destination, skipping`,
			});
			continue;
		}

		if (!fs.existsSync(filePath)) {
			warn({
				code: 'FILE_DOES_NOT_EXIST',
				message: `action wants to keep ${colors.bold(file)} but it does not exist`,
			});
			continue;
		}

		const stats = fs.lstatSync(filePath);
		if (!stats.isSymbolicLink() && stats.isDirectory()) {
			keepDirSet.add(filePath);
		} else {
			keepFileSet.add(filePath);
		}
		hasUserKeeps = true;
	}

	if (!hasUserKeeps) {
		warn({
			code: 'NO_FILES_MATCHED',
			message: `no requested files were found, keeping the entire destination`,
		});
		return;
	}

	const directivesPath = path.resolve(root, degitConfigName);
	try {
		if (fs.lstatSync(directivesPath).isFile()) {
			keepFileSet.add(directivesPath);
		}
	} catch {
		// degit.json is missing or not accessible
	}

	function isKept(filePath: string): boolean {
		if (keepFileSet.has(filePath)) {
			return true;
		}

		for (const dir of keepDirSet) {
			if (filePath === dir || filePath.startsWith(path.join(dir, ''))) {
				return true;
			}
		}

		return false;
	}

	prune(root);

	function prune(dir: string) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				prune(fullPath);
				if (fs.readdirSync(fullPath).length === 0 && !isKept(fullPath)) {
					fs.rmdirSync(fullPath);
				}
			} else if (!isKept(fullPath)) {
				fs.unlinkSync(fullPath);
			}
		}
	}
}

export function copyRepoSubdir(srcDir: string, dest: string, subdir: string) {
	const normalized = subdir.split('/').filter(Boolean).join('/');
	const source = path.join(srcDir, normalized);

	if (!fs.existsSync(source)) {
		throw new DegitError(`could not find subdirectory ${subdir} in cloned repository`, {
			code: 'MISSING_SUBDIR',
			subdir,
		});
	}

	fs.mkdirSync(dest, { recursive: true });

	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		const srcPath = path.join(source, entry.name);
		const destPath = path.join(dest, entry.name);
		fs.cpSync(srcPath, destPath, { recursive: true });
	}
}

/* eslint-enable security/detect-non-literal-fs-filename */
