const child_process = require('child_process');
const chalk = require('chalk');
const path = require('path');
const dns = require('dns');
const fs = require('fs');

function error(message, err) {
	console.error(chalk.redBright(`[!] ${message}`)); // eslint-disable-line no-console
	if (err) {
		console.log(chalk.grey(err.stack)); // eslint-disable-line no-console
	}
	process.exit(1);
}

function log(message) {
	console.log(chalk.cyanBright(`[>] ${message}`)); // eslint-disable-line no-console
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

exports.checkDirIsEmpty = function checkDirIsEmpty(dir, force) {
	try {
		const files = fs.readdirSync(dir);
		if (files.length > 0) {
			if (force) {
				log(`Destination directory is not empty. Using --force, continuing`);
			} else {
				error(`Destination directory is not empty, aborting. Use --force to override`);
			}
		}
	} catch (err) {
		if (err.code !== 'ENOENT') error(err.message, err);
	}
};

exports.getOnlineStatus = function() {
	return new Promise(fulfil => {
		dns.lookup('google.com', err => {
			fulfil(err ? false : true);
		});
	});
};

exports.log = log;
exports.error = error;
