#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const mri = require('mri');
const homeOrTmp = require('home-or-tmp');
const { checkDirIsEmpty, error, log, mkdirp, exec } = require('./utils.js');

const dir = `${homeOrTmp}/.degit`;

const args = mri(process.argv.slice(2), {
	alias: {
		f: 'force'
	}
});

const [src, dest = '.'] = args._;

if (args.help || !src) {
	const help = fs.readFileSync(path.join(__dirname, 'help.md'), 'utf-8')
		.replace(/^(\s*)#+ (.+)/gm, (m, s, _) => s + chalk.bold(_))
		.replace(/_([^_]+)_/g, (m, _) => chalk.underline(_))
		.replace(/`([^`]+)`/g, (m, _) => chalk.cyan(_));

	process.stdout.write(`\n${help}\n`);
	return;
}

const [repo, selector] = src.split('#');
degit(repo, selector, dest);

async function degit(repo, selector = 'master', dest) {
	checkDirIsEmpty(dest, args.force);

	const refs = await getRefs(repo);
	const ref = selectRef(refs, selector);

	if (!ref) {
		// TODO 'did you mean...?'
		error(`Could not find ref ${chalk.bold(selector)}`);
	}

	const file = `${dir}/${repo}/${ref.hash}.tar.gz`;
	const url = `https://github.com/${repo}/archive/${ref.hash}.tar.gz`;

	try {
		await downloadIfNotExists(url, file);
	} catch (err) {
		error(`Could not download ${chalk.bold(url)}`, err);
	}

	mkdirp(dest);
	await untar(file, dest);

	log(`Cloned ${chalk.bold(`${repo}#${selector}`)}${dest !== '.' ? ` to ${chalk.bold(dest)}` : ''}`);
}

async function getRefs(repo) {
	try {
		const { stdout } = await exec(`git ls-remote https://github.com/${repo}`);

		return stdout.split('\n').filter(Boolean).map(row => {
			const [hash, ref] = row.split('\t');

			if (ref === 'HEAD') {
				return {
					type: 'HEAD',
					hash
				};
			}

			const match = /refs\/(\w+)\/(.+)/.exec(ref);
			if (!match) throw new Error(`Could not parse ${ref}`);
			return {
				type: (
					match[1] === 'heads' ? 'branch' :
					match[1] === 'refs' ? 'ref' :
					match[1]
				),
				name: match[2],
				hash
			};
		});
	} catch (err) {
		error(`Could not get refs for ${chalk.bold(repo)}`, err);
	}
}

function selectRef(refs, selector) {
	for (const ref of refs) {
		if (ref.name === selector) return ref;
	}

	if (selector.length < 8) return null;

	for (const ref of refs) {
		if (ref.hash.startsWith(selector)) return ref;
	}
}

async function downloadIfNotExists(url, file) {
	try {
		fs.statSync(file);
	} catch (err) {
		mkdirp(path.dirname(file));
		return await exec(`curl -L ${url} > ${file}`);
	}
}

async function untar(file, dest) {
	await exec(`tar -xf ${file} --strip 1 -C ${dest}`);
}