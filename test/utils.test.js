import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { sync as rimraf } from 'rimraf';
import {
	DegitError,
	degitConfigName,
	exec,
	fetch,
	mkdirp,
	stashFiles,
	tryRequire,
	unstashFiles,
} from '../src/utils.js';

describe('utils', () => {
	let tmpRoot;

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'degit-utils-'));
	});

	afterEach(() => {
		rimraf(tmpRoot);
	});

	it('directories exist when mkdirp receives a nested path', () => {
		const nested = path.join(tmpRoot, 'a', 'b', 'c');
		mkdirp(nested);
		assert.ok(fs.statSync(nested).isDirectory());
	});

	it('mkdirp succeeds when the directory already exists', () => {
		const d = path.join(tmpRoot, 'exists');
		fs.mkdirSync(d, { recursive: true });
		mkdirp(d);
		assert.ok(fs.statSync(d).isDirectory());
	});

	it('returns null when the module file is missing', () => {
		const missing = path.join(tmpRoot, 'nope.js');
		assert.equal(tryRequire(missing), null);
	});

	it('returns module exports when the file is a valid module', () => {
		const modPath = path.join(tmpRoot, 'm.js');
		fs.writeFileSync(modPath, 'module.exports = { x: 42 };');
		const loaded = tryRequire(modPath);
		assert.equal(loaded.x, 42);
	});

	it('reloads updated exports when clearCache is true', () => {
		const modPath = path.join(tmpRoot, 'c.js');
		fs.writeFileSync(modPath, 'module.exports = { v: 1 };');
		assert.equal(tryRequire(modPath).v, 1);
		fs.writeFileSync(modPath, 'module.exports = { v: 2 };');
		assert.equal(tryRequire(modPath, { clearCache: true }).v, 2);
	});

	it('resolves with stdout when exec succeeds', async () => {
		vi.spyOn(child_process, 'execFile').mockImplementation((cmd, args, cb) => {
			cb(null, 'out\n', '');
		});
		const r = await exec('echo hi');
		assert.equal(r.stdout, 'out\n');
		child_process.execFile.mockRestore();
	});

	it('rejects when exec reports an error', async () => {
		vi.spyOn(child_process, 'execFile').mockImplementation((cmd, args, cb) => {
			cb(new Error('fail'));
		});
		try {
			await exec('bad');
			assert.fail('expected reject');
		} catch (error) {
			assert.ok(error);
		}
		child_process.execFile.mockRestore();
	});

	it('rejects with HTTP status code when the response is not successful', async () => {
		const res = { statusCode: 404, statusMessage: 'Not Found' };
		vi.spyOn(https, 'get').mockImplementation((opts, cb) => {
			const req = new EventEmitter();
			setImmediate(() => cb(res));
			return req;
		});
		const dest = path.join(tmpRoot, 'out.tgz');
		try {
			await fetch('https://example.com/x', dest, null);
			assert.fail('expected reject');
		} catch (error) {
			assert.equal(error.code, 404);
		}
		https.get.mockRestore();
	});

	it('rejects when the download stream emits an error', async () => {
		const dest = path.join(tmpRoot, 'pipe-err.bin');
		const finalRes = Object.assign(new EventEmitter(), {
			pipe(destStream) {
				setImmediate(() => destStream.emit('error', new Error('pipe broke')));
				return destStream;
			},
			statusCode: 200,
		});
		vi.spyOn(https, 'get').mockImplementation((opts, cb) => {
			const req = new EventEmitter();
			setImmediate(() => cb(finalRes));
			return req;
		});
		try {
			await fetch('https://example.com/y', dest, null);
			assert.fail('expected reject');
		} catch (error) {
			assert.ok(String(error.message).includes('pipe broke'));
		}
		https.get.mockRestore();
	});

	it('follows redirect targets when the server returns a redirect', async () => {
		const dest = path.join(tmpRoot, 'out.bin');
		const finalRes = Object.assign(new EventEmitter(), {
			pipe(destStream) {
				destStream.write('x');
				destStream.end(() => {
					setImmediate(() => destStream.emit('finish'));
				});
				return destStream;
			},
			statusCode: 200,
		});
		const redirectRes = {
			headers: { location: 'https://example.com/final' },
			statusCode: 302,
		};
		let call = 0;
		vi.spyOn(https, 'get').mockImplementation((opts, cb) => {
			const req = new EventEmitter();
			if (call++ === 0) {
				setImmediate(() => cb(redirectRes));
			} else {
				setImmediate(() => cb(finalRes));
			}
			return req;
		});
		await fetch('https://example.com/start', dest, null);
		assert.equal(call, 2);
		https.get.mockRestore();
	});

	it('passes an HTTPS agent when a proxy URL is provided', async () => {
		const dest = path.join(tmpRoot, 'p.bin');
		const finalRes = Object.assign(new EventEmitter(), {
			pipe(destStream) {
				destStream.end(() => {
					setImmediate(() => destStream.emit('finish'));
				});
				return destStream;
			},
			statusCode: 200,
		});
		vi.spyOn(https, 'get').mockImplementation((opts, cb) => {
			assert.ok(opts.agent);
			const req = new EventEmitter();
			setImmediate(() => cb(finalRes));
			return req;
		});
		await fetch('https://example.com/a', dest, 'http://127.0.0.1:9');
		https.get.mockRestore();
	});

	it('rejects when the HTTP request emits a network error', async () => {
		vi.spyOn(https, 'get').mockImplementation(() => {
			const req = new EventEmitter();
			setImmediate(() => req.emit('error', new Error('net down')));
			return req;
		});
		const dest = path.join(tmpRoot, 'e.bin');
		try {
			await fetch('https://example.com/z', dest, null);
			assert.fail('expected reject');
		} catch (error) {
			assert.ok(String(error.message).includes('net down'));
		}
		https.get.mockRestore();
	});

	it('restores nested files when unstash runs after stash', () => {
		const dir = path.join(tmpRoot, 'cache');
		const dest = path.join(tmpRoot, 'dest');
		fs.mkdirSync(dir, { recursive: true });
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, 'a.txt'), 'A');
		const sub = path.join(dest, 'sub');
		fs.mkdirSync(sub);
		fs.writeFileSync(path.join(sub, 'b.txt'), 'B');
		stashFiles(dir, dest);
		assert.equal(fs.readdirSync(dest).length, 0);
		unstashFiles(dir, dest);
		assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'A');
		assert.equal(fs.readFileSync(path.join(sub, 'b.txt'), 'utf8'), 'B');
	});

	it('restores other files but omits degit config when unstash skips that copy', () => {
		const dir = path.join(tmpRoot, 'c2');
		const dest = path.join(tmpRoot, 'd2');
		fs.mkdirSync(dir, { recursive: true });
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, 'keep.txt'), 'K');
		stashFiles(dir, dest);
		const tmpDir = path.join(dir, 'tmp');
		fs.writeFileSync(path.join(tmpDir, degitConfigName), '{"x":1}');
		fs.writeFileSync(path.join(tmpDir, 'z.txt'), 'Z');
		unstashFiles(dir, dest);
		assert.ok(!fs.existsSync(path.join(dest, degitConfigName)));
		assert.equal(fs.readFileSync(path.join(dest, 'z.txt'), 'utf8'), 'Z');
		assert.equal(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'K');
	});

	it('attaches message, code, and url when DegitError is constructed', () => {
		const e = new DegitError('msg', { code: 'X', url: 'u' });
		assert.equal(e.message, 'msg');
		assert.equal(e.code, 'X');
		assert.equal(e.url, 'u');
	});
});
