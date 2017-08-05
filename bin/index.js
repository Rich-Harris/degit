#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const mri = require('mri');
const tar = require('tar');
const homeOrTmp = require('home-or-tmp');
const { checkDirIsEmpty, error, exec, fetch, log, mkdirp, tryRequire } = require('./utils.js');

const base = path.join(homeOrTmp, '.degit');

const args = mri(process.argv.slice(2), {
	alias: {
		f: 'force',
		c: 'cache',
		v: 'verbose'
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
	if (args.verbose) log(`cloning ${src} to ${dest}`);

	checkDirIsEmpty(dest, args);

	const repo = parse(src);

	const dir = path.join(base, repo.site, repo.user, repo.name);
	const cached = tryRequire(path.join(dir, 'map.json')) || {};

	const hash = args.cache ?
		getHashFromCache(cached) :
		await getHash(repo, cached);

	if (!hash) {
		// TODO 'did you mean...?'
		error(`could not find commit hash for ${repo.ref}`);
	}

	const file = `${dir}/${hash}.tar.gz`;
	const url = (
		repo.site === 'gitlab' ? `${repo.url}/repository/archive.tar.gz?ref=${hash}` :
		repo.site === 'bitbucket' ? `${repo.url}/get/${hash}.tar.gz` :
		`${repo.url}/archive/${hash}.tar.gz`
	);

	try {
		if (!args.cache) await downloadIfNotExists(url, file);
	} catch (err) {
		error(`could not download ${chalk.bold(url)}`, err);
	}

	updateCache(dir, repo, hash, cached);

	mkdirp(dest);
	await untar(file, dest);

	log(`cloned ${chalk.bold(`${repo.user}/${repo.name}#${repo.ref}`)}${dest !== '.' ? ` to ${chalk.bold(dest)}` : ''}`);
}

function parse(src) {
	const match = /^(?:https:\/\/([^/]+)\/|git@([^/]+):|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:#(.+))?/.exec(src);
	if (!match) error(`could not parse ${src}`);

	const site = (match[1] || match[2] || match[3] || 'github').replace(/\.(com|org)$/, '');
	if (!supported.has(site)) error(`degit supports GitHub, GitLab and BitBucket`);

	const user = match[4];
	const name = match[5].replace(/\.git$/, '');
	const ref = match[6] || 'master';

	const url = `https://${site}.${site === 'bitbucket' ? 'org' : 'com'}/${user}/${name}`;

	return { site, user, name, ref, url };
}

async function getHash(repo, cached) {
	try {
		const refs = await fetchRefs(repo);
		if (args.verbose) log(`fetched ${refs.length} ${refs.length === 1 ? 'ref' : 'refs'}`);
		return selectRef(refs, repo.ref);
	} catch (err) {
		return getHashFromCache(repo, cached);
	}
}

function getHashFromCache(repo, cached) {
	if (repo.ref in cached) {
		const hash = cached[repo.ref];
		log(`using cached commit hash ${hash}`);
		return hash;
	}
}

async function fetchRefs(repo) {
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
		if (!match) error(`could not parse ${ref}`);
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
}

function updateCache(dir, repo, hash, cached) {
	if (cached[repo.ref] === hash) return;

	const oldHash = cached[repo.ref];
	if (oldHash) {
		let used = false;
		for (const key in cached) {
			if (cached[key] === hash) {
				used = true;
				break;
			}
		}

		if (!used) {
			// we no longer need this tar file
			try {
				fs.unlinkSync(path.join(dir, `${oldHash}.tar.gz`));
			} catch (err) {
				// ignore
			}
		}
	}

	cached[repo.ref] = hash;
	fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(cached, null, '  '));
}

function selectRef(refs, selector) {
	for (const ref of refs) {
		if (ref.name === selector) {
			if (args.verbose) log(`found matching commit hash: ${ref.hash}`);
			return ref.hash;
		}
	}

	if (selector.length < 8) return null;

	for (const ref of refs) {
		if (ref.hash.startsWith(selector)) return ref.hash;
	}
}

async function downloadIfNotExists(url, file) {
	try {
		fs.statSync(file);
		if (args.verbose) log(`${file} already exists locally`);
	} catch (err) {
		mkdirp(path.dirname(file));
		if (args.verbose) log(`downloading ${url} to ${file}`);
		return await fetch(url, file);
	}
}

async function untar(file, dest) {
	if (args.verbose) log(`extracting ${file} to ${dest}`);
	return tar.extract({
		file,
		strip: 1,
		C: dest
	});
}