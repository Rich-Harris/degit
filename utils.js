const child_process = require('child_process');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

exports.error = function error(message, err) {
	console.error(chalk.redBright(`[!] ${message}`)); // eslint-disable-line no-console
	if (err) {
		console.log(chalk.grey(err.stack)); // eslint-disable-line no-console
	}
	process.exit(1);
};

exports.log = function log(message) {
	console.log(chalk.cyanBright(`[>] ${message}`)); // eslint-disable-line no-console
};

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