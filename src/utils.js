import fs from 'fs';
import path from 'path';
import https from 'https';
import child_process from 'child_process';
import { rimrafSync, copydirSync } from 'sander';

const tmpDirName = 'tmp';
const degitConfigName = 'degit.json';

export { degitConfigName };

export class DegitError extends Error {
	constructor(message, opts) {
		super(message);
		Object.assign(this, opts);
	}
}

export function tryRequire(file, opts) {
	try {
		if (opts && opts.clearCache === true) {
			delete require.cache[require.resolve(file)];
		}
		return require(file);
	} catch (err) {
		return null;
	}
}

export function exec(command) {
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

export function mkdirp(dir) {
	const parent = path.dirname(dir);
	if (parent === dir) return;

	mkdirp(parent);

	try {
		fs.mkdirSync(dir);
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
}

export function stashFiles(dir, dest) {
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

export function unstashFiles(dir, dest) {
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
