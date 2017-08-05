const child_process = require('child_process');
const chalk = require('chalk');
const https = require('https');
const path = require('path');
const fs = require('fs');

chalk.enabled = process.platform !== 'win32';

function error(message, err) {
	process.stderr.write(chalk.redBright(`[!] ${message}\n`));
	if (err) {
		process.stderr.write(chalk.grey(err.stack) + '\n');
	}
	process.exit(1);
}

function log(message) {
	process.stdout(chalk.cyanBright(`[>] ${message}\n`));
}

exports.exec = function exec(command) {
	return new Promise((fulfil, reject) => {
		child_process.exec(command, (err, stdout, stderr) => {
			if (err) {
				reject(err);
				return;
			}

			fulfil({ stdout, stderr });
		});
	});
};

exports.mkdirp = function mkdirp(dir) {
	const parent = path.dirname(dir);
	if (parent === dir) return;

	mkdirp(parent);

	try {
		fs.mkdirSync(dir);
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
};

exports.checkDirIsEmpty = function checkDirIsEmpty(dir, args) {
	try {
		const files = fs.readdirSync(dir);
		if (files.length > 0) {
			if (args.force) {
				log(`destination directory is not empty. Using --force, continuing`);
			} else {
				error(`destination directory is not empty, aborting. Use --force to override`);
			}
		} else if (args.verbose) {
			log(`destination directory is empty`);
		}
	} catch (err) {
		if (err.code !== 'ENOENT') error(err.message, err);
	}
};

exports.fetch = function fetch(url, dest) {
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
};

exports.tryRequire = function(file) {
	try {
		return require(file);
	} catch (err) {
		return null;
	}
};

exports.log = log;
exports.error = error;
