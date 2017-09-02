import fs from 'fs';
import path from 'path';
import https from 'https';
import child_process from 'child_process';

export class DegitError extends Error {
	constructor(message, opts) {
		super(message);
		Object.assign(this, opts);
	}
}

export function tryRequire(file) {
	try {
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

export function fetch(url, dest) {
	return new Promise((fulfil, reject) => {
		https.get(url, response => {
			const code = response.statusCode;
			if (code >= 400) {
				reject({ code, message: response.statusMessage });
			} else if (code >= 300) {
				fetch(response.headers.location, dest).then(fulfil, reject);
			} else {
				response.pipe(fs.createWriteStream(dest))
					.on('finish', () => fulfil())
					.on('error', reject);
			}
		}).on('error', reject);
	});
}