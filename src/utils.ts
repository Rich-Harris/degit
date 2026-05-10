import fs from 'fs';
import path from 'path';
import homeOrTmp from 'home-or-tmp';
import https from 'https';
import child_process from 'child_process';
import URL from 'url';
import Agent from 'https-proxy-agent';
import { rimrafSync, copydirSync } from 'sander';

const tmpDirName = 'tmp';
export const degitConfigName = 'degit.json';

export class DegitError extends Error {
	constructor(message: string, opts: { [key: string]: unknown }) {
		super(message);
		Object.assign(this, opts);
	}
}

export function tryRequire(file: string, opts?: { clearCache?: boolean }): unknown {
	try {
		if (opts?.clearCache === true) {
			delete require.cache[require.resolve(file)];
		}
		return require(file);
	} catch (err) {
		return null;
	}
}

export type ExecResult = {
	stdout: string;
	stderr: string;
};

export function exec(command: string): Promise<ExecResult> {
	return new Promise((fulfil, reject) => {
		child_process.exec(command, (err, stdout, stderr) => {
			if (err) {
				reject(err);
				return;
			}

			fulfil({ stdout, stderr });
		});
	});
}

export function mkdirp(dir: string): void {
	const parent = path.dirname(dir);
	if (parent === dir) return;

	mkdirp(parent);

	try {
		fs.mkdirSync(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
	}
}

export function fetch(url: string, dest: string, proxy?: string): Promise<void> {
	return new Promise((fulfil, reject) => {
		let options: string | https.RequestOptions = url;

		if (proxy) {
			const parsedUrl = URL.parse(url);
			options = {
				hostname: parsedUrl.hostname || parsedUrl.host || '',
				path: parsedUrl.path || '',
				agent: new Agent(proxy)
			};
		}

		https
			.get(options, response => {
				const code = response.statusCode || 0;
				if (code >= 400) {
					reject({ code, message: response.statusMessage || '' });
				} else if (code >= 300) {
					const location = response.headers.location;
					if (typeof location === 'string') {
						fetch(location, dest, proxy).then(fulfil, reject);
					} else {
						reject({ code, message: 'Redirect without location header' });
					}
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
	rimrafSync(tmpDir);
	mkdirp(tmpDir);
	fs.readdirSync(dest).forEach(file => {
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
	fs.readdirSync(tmpDir).forEach(filename => {
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

export const base = path.join(homeOrTmp, '.degit');
