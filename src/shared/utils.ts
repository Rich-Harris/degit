import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import * as URL from 'node:url';
import Agent from 'https-proxy-agent';

const tmpDirName = 'tmp';
const degitConfigName = 'degit.json';

type ResolveBaseOptions = {
	env?: NodeJS.ProcessEnv;
	homedir?: string;
	platform?: NodeJS.Platform;
};

export { degitConfigName };

export class DegitError extends Error {
	code?: string;
	constructor(message: string, opts: Record<string, unknown> = {}) {
		super(message);
		Object.assign(this, opts);
	}
}

export function safeResolve(root: string, file: string): string | undefined {
	const filePath = path.resolve(root, file);
	const relativePath = path.relative(root, filePath);

	if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		return undefined;
	}

	return filePath;
}

export function validateDestination(dest: string, allowMissing: boolean): boolean {
	try {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const lstat = fs.lstatSync(dest);
		if (lstat.isSymbolicLink()) {
			throw new DegitError(`destination is a symlink: ${dest}`, { code: 'ENOTDIR' });
		}
		if (!lstat.isDirectory()) {
			throw new DegitError(`destination is not a directory: ${dest}`, { code: 'ENOTDIR' });
		}
		return true;
	} catch (error) {
		if (error instanceof DegitError) {
			throw error;
		}
		const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
		if (code !== 'ENOENT') {
			throw new DegitError(
				`could not stat destination: ${error instanceof Error ? error.message : String(error)}`,
				{
					code: 'COULD_NOT_STAT',
					original: error,
				},
			);
		}
	}

	if (!allowMissing) {
		throw new DegitError(`destination does not exist: ${dest}`, { code: 'MISSING_DEST' });
	}

	return false;
}

/* eslint-disable security/detect-non-literal-fs-filename */
export function tryReadJson(file: string) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

export function mkdirp(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

export function fetch(url: string, dest: string, proxy?: string): Promise<void> {
	return new Promise((fulfil, reject) => {
		let options: string | import('node:http').RequestOptions = url;

		if (proxy) {
			const parsedUrl = URL.parse(url);
			options = {
				agent: Agent(proxy) as unknown as import('node:http').Agent,
				hostname: parsedUrl.host,
				path: parsedUrl.path,
			};
		}

		https
			.get(options, (response) => {
				const code = response.statusCode;
				if (code >= 400) {
					response.resume();
					reject({ code, message: response.statusMessage });
				} else if (code >= 300) {
					response.resume();
					fetch(response.headers.location, dest, proxy).then(fulfil, reject);
				} else {
					response
						.pipe(fs.createWriteStream(dest))
						.on('finish', () => fulfil())
						.on('error', reject);
				}
			})
			.on('error', reject);
	});
}

export type StashedEntry = { filePath: string; isDir: boolean };

export function copyToStash(dir: string, dest: string): StashedEntry[] {
	const tmpDir = path.join(dir, tmpDirName);
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	fs.rmSync(tmpDir, { force: true, recursive: true });
	mkdirp(tmpDir);

	const toRemove: StashedEntry[] = [];

	for (const file of fs.readdirSync(dest)) {
		const filePath = path.join(dest, file);
		const targetPath = path.join(tmpDir, file);

		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const lstat = fs.lstatSync(filePath);
		const isDir = lstat.isDirectory();
		const isSymlink = lstat.isSymbolicLink();

		if (isSymlink) {
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			const linkTarget = fs.readlinkSync(filePath);
			let linkTargetIsDir = false;
			try {
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				linkTargetIsDir = fs.statSync(filePath).isDirectory();
			} catch {}
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.symlinkSync(linkTarget, targetPath, linkTargetIsDir ? 'dir' : 'file');
		} else if (isDir) {
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.cpSync(filePath, targetPath, { recursive: true, dereference: false });
		} else {
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.copyFileSync(filePath, targetPath);
		}

		toRemove.push({ filePath, isDir });
	}

	return toRemove;
}

export function removeStashedFromDest(entries: StashedEntry[]): void {
	for (const { filePath, isDir } of entries) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		fs.rmSync(filePath, { force: true, recursive: isDir });
	}
}

// eslint-disable-next-line max-lines-per-function
export function unstashFiles(dir: string, dest: string, keepCloneOutput = true): void {
	const tmpDir = path.join(dir, tmpDirName);
	const tmpFiles = new Set(fs.readdirSync(tmpDir));

	if (!keepCloneOutput) {
		for (const filename of fs.readdirSync(dest)) {
			if (!tmpFiles.has(filename)) {
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				fs.rmSync(path.join(dest, filename), { force: true, recursive: true });
			}
		}
	}

	const force = !keepCloneOutput;
	const dirs: string[] = [];
	const symlinks: string[] = [];
	const files: string[] = [];
	for (const filename of tmpFiles) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const lstat = fs.lstatSync(path.join(tmpDir, filename));
		if (lstat.isDirectory()) {
			dirs.push(filename);
		} else if (lstat.isSymbolicLink()) {
			symlinks.push(filename);
		} else {
			files.push(filename);
		}
	}

	for (const filename of [...dirs, ...symlinks, ...files]) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const tmpFile = path.join(tmpDir, filename);
		const targetPath = path.join(dest, filename);
		if (dirs.includes(filename)) {
			removeConflictingDest(targetPath, true, false, force);
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.cpSync(tmpFile, targetPath, { force: true, recursive: true, dereference: false });
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.rmSync(tmpFile, { force: true, recursive: true });
		} else if (symlinks.includes(filename)) {
			unstashSymlink(tmpFile, targetPath, tmpDir);
		} else {
			removeConflictingDest(targetPath, false, false, force);
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.copyFileSync(tmpFile, targetPath);
			// eslint-disable-next-line security/detect-non-literal-fs-filename
			fs.unlinkSync(tmpFile);
		}
	}

	// eslint-disable-next-line security/detect-non-literal-fs-filename
	fs.rmSync(tmpDir, { force: true, recursive: true });
}

function unstashSymlink(tmpFile: string, targetPath: string, tmpDir: string): void {
	removeConflictingDest(targetPath, false, true, false);
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const linkTarget = fs.readlinkSync(tmpFile);
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const resolvedStashTarget = path.isAbsolute(linkTarget)
		? linkTarget
		: path.resolve(path.dirname(tmpFile), linkTarget);
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const resolvedDestTarget = path.isAbsolute(linkTarget)
		? linkTarget
		: path.resolve(path.dirname(targetPath), linkTarget);
	const stashRel = path.relative(tmpDir, resolvedStashTarget);
	const insideStash = !stashRel.startsWith('..') && !path.isAbsolute(stashRel);
	let linkTargetIsDir = false;
	try {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		linkTargetIsDir = fs.statSync(resolvedDestTarget).isDirectory();
	} catch {
		if (insideStash) {
			try {
				// eslint-disable-next-line security/detect-non-literal-fs-filename
				linkTargetIsDir = fs.statSync(resolvedStashTarget).isDirectory();
			} catch {}
		}
	}
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	fs.symlinkSync(linkTarget, targetPath, linkTargetIsDir ? 'dir' : 'file');
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	fs.unlinkSync(tmpFile);
}

function removeConflictingDest(
	targetPath: string,
	tmpIsDir: boolean,
	tmpIsSymlink = false,
	force = false,
): void {
	let exists = false;
	let isDir = false;
	let isSymlink = false;
	try {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const stat = fs.lstatSync(targetPath);
		isDir = stat.isDirectory();
		isSymlink = stat.isSymbolicLink();
		exists = true;
	} catch {}
	if (exists && (force || isSymlink || isDir !== tmpIsDir || tmpIsSymlink)) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		fs.rmSync(targetPath, { force: true, recursive: true });
	}
}

export function resolveBase({
	env = process.env,
	homedir = os.homedir(),
	platform = process.platform,
}: ResolveBaseOptions = {}): string {
	if (platform === 'win32') {
		return path.join(env.LOCALAPPDATA ?? path.join(homedir, 'AppData', 'Local'), 'degit');
	}
	if (platform === 'darwin') {
		return path.join(homedir, 'Library', 'Caches', 'degit');
	}
	return path.join(env.XDG_CACHE_HOME ?? path.join(homedir, '.cache'), 'degit');
}

/* eslint-enable security/detect-non-literal-fs-filename */

export const base = resolveBase();
