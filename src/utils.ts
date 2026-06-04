import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import * as URL from 'node:url';
import { createRequire } from 'node:module';
import Agent from 'https-proxy-agent';
import { copydirSync, rimrafSync } from 'sander';

const require = createRequire(import.meta.url);
const tmpDirName = 'tmp';
const degitConfigName = 'degit.json';

type RequireOptions = {
	clearCache?: boolean;
};

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

export function tryRequire(file: string, opts: RequireOptions = {}) {
	try {
		if (opts && opts.clearCache === true) {
			delete require.cache[require.resolve(file)];
		}
		// oxlint-disable-next-line security/detect-non-literal-require
		return require(file);
	} catch {
		return null;
	}
}

/* eslint-disable security/detect-non-literal-fs-filename */
export function mkdirp(dir: string): void {
	const parent = path.dirname(dir);
	if (parent === dir) {
		return;
	}

	mkdirp(parent);

	try {
		fs.mkdirSync(dir);
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
	}
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
						.on('finish', () => fulfil(undefined))
						.on('error', reject);
				}
			})
			.on('error', reject);
	});
}

export function stashFiles(dir: string, dest: string): void {
	const tmpDir = path.join(dir, tmpDirName);
	rimrafSync(tmpDir);
	mkdirp(tmpDir);
	fs.readdirSync(dest).forEach((file) => {
		const filePath = path.join(dest, file);
		const targetPath = path.join(tmpDir, file);
		const isDir = fs.lstatSync(filePath).isDirectory();
		if (isDir) {
			copydirSync(filePath).to(targetPath);
			rimrafSync(filePath);
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
			copydirSync(tmpFile).to(targetPath);
			rimrafSync(tmpFile);
		} else {
			if (filename !== 'degit.json') {
				fs.copyFileSync(tmpFile, targetPath);
			}
			fs.unlinkSync(tmpFile);
		}
	});
	rimrafSync(tmpDir);
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
