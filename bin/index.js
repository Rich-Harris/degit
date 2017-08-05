#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const mri = require('mri');
const tar = require('tar');
const homeOrTmp = require('home-or-tmp');
const { checkDirIsEmpty, error, exec, fetch, log, mkdirp } = require('./utils.js');

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

const supported = new Set(['github', 'gitlab', 'bitbucket']);

degit(src, dest);

async function degit(src, dest) {
	checkDirIsEmpty(dest, args.force);

	const repo = parse(src);

	const refs = await getRefs(repo);
	const ref = selectRef(refs, repo.ref);

	if (!ref) {
		// TODO 'did you mean...?'
		error(`Could not find ref ${chalk.bold(repo.ref)}`);
	}

	const file = `${dir}/${repo.site}/${repo.user}/${repo.name}/${ref.hash}.tar.gz`;
	const url = (
		repo.site === 'gitlab' ? `${repo.url}/repository/archive.tar.gz?ref=${ref.hash}` :
		repo.site === 'bitbucket' ? `${repo.url}/get/${ref.hash}.tar.gz` :
		`${repo.url}/archive/${ref.hash}.tar.gz`
	);

	try {
		await downloadIfNotExists(url, file);
	} catch (err) {
		error(`Could not download ${chalk.bold(url)}`, err);
	}

	mkdirp(dest);
	await untar(file, dest);

	log(`Cloned ${chalk.bold(`${repo.user}/${repo.name}#${repo.ref}`)}${dest !== '.' ? ` to ${chalk.bold(dest)}` : ''}`);
}

function parse(src) {
	const match = /^(?:https:\/\/([^/]+)\/|git@([^/]+):|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:#(.+))?/.exec(src);
	if (!match) error(`Could not parse ${src}`);

	const site = (match[1] || match[2] || match[3] || 'github').replace(/\.(com|org)$/, '');
	if (!supported.has(site)) error(`degit supports GitHub, GitLab and BitBucket`);

	const user = match[4];
	const name = match[5].replace(/\.git$/, '');
	const ref = match[6] || 'master';

	const url = `https://${site}.${site === 'bitbucket' ? 'org' : 'com'}/${user}/${name}`;

	return { site, user, name, ref, url };
}

async function getRefs(repo) {
	try {
		const { stdout } = await exec(`git ls-remote ${repo.url}`);

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
		return await fetch(url, file);
	}
}

async function untar(file, dest) {
	return tar.extract({
		file,
		strip: 1,
		C: dest
	});
}