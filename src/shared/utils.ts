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

export function stashFiles(dir: string, dest: string): void {
	const tmpDir = path.join(dir, tmpDirName);
	fs.rmSync(tmpDir, { force: true, recursive: true });
	mkdirp(tmpDir);
	fs.readdirSync(dest).forEach((file) => {
		const filePath = path.join(dest, file);
		const targetPath = path.join(tmpDir, file);
		const isDir = fs.lstatSync(filePath).isDirectory();
		if (isDir) {
			fs.cpSync(filePath, targetPath, { recursive: true });
			fs.rmSync(filePath, { force: true, recursive: true });
		} else {
			fs.copyFileSync(filePath, targetPath);
			fs.unlinkSync(filePath);
		}
	});
}

export function unstashFiles(dir: string, dest: string): void {
	const tmpDir = path.join(dir, tmpDirName);
	fs.readdirSync(tmpDir).forEach((filename) => {
		const tmpFile = path.join(tmpDir, filename);
		const targetPath = path.join(dest, filename);
		const isDir = fs.lstatSync(tmpFile).isDirectory();
		if (isDir) {
			fs.cpSync(tmpFile, targetPath, { recursive: true });
			fs.rmSync(tmpFile, { force: true, recursive: true });
		} else {
			if (filename !== 'degit.json') {
				fs.copyFileSync(tmpFile, targetPath);
			}
			fs.unlinkSync(tmpFile);
		}
	});
	fs.rmSync(tmpDir, { force: true, recursive: true });
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
