import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import mri from 'mri';
import glob from 'tiny-glob/sync.js';
import fuzzysearch from 'fuzzysearch';
import enquirer from 'enquirer';
import degit from './index.js';
import { base, tryRequire } from './utils.js';

/* eslint-disable security/detect-non-literal-fs-filename */
export async function main(argv) {
	const args = mri(argv.slice(2), {
		alias: {
			c: 'cache',
			f: 'force',
			m: 'mode',
			v: 'verbose',
		},
		boolean: ['force', 'cache', 'verbose'],
	});

	const [src, dest = '.'] = args._;

	if (args.help) {
		const help = fs
			.readFileSync(path.join(__dirname, '..', 'help.md'), 'utf8')
			.replaceAll(/^(\s*)#+ (.+)/gm, (m, s, _) => s + chalk.bold(_))
			.replaceAll(/_([^_]+)_/g, (m, _) => chalk.underline(_))
			.replaceAll(/`([^`]+)`/g, (m, _) => chalk.cyan(_));

		process.stdout.write(`\n${help}\n`);
	} else if (!src) {
		const accessLookup = new Map();

		glob(`**/access.json`, { cwd: base }).forEach((file) => {
			const [host, user, repo] = file.split(path.sep);

			const json = fs.readFileSync(`${base}/${file}`, 'utf8');
			const logs = JSON.parse(json);

			Object.entries(logs).forEach(([ref, timestamp]) => {
				const id = `${host}:${user}/${repo}#${ref}`;
				accessLookup.set(id, new Date(timestamp).getTime());
			});
		});

		const getChoice = (file) => {
			const [host, user, repo] = file.split(path.sep);

			return Object.entries(tryRequire(`${base}/${file}`)).map(([ref, hash]) => ({
				message: `${host}:${user}/${repo}#${ref}`,
				name: hash,
				value: `${host}:${user}/${repo}#${ref}`,
			}));
		};

		const choices = glob(`**/map.json`, { cwd: base })
			.map(getChoice)
			.flat()
			.toSorted((a, b) => {
				const aTime = accessLookup.get(a.value) || 0;
				const bTime = accessLookup.get(b.value) || 0;

				return bTime - aTime;
			});

		const options = await enquirer.prompt([
			{
				choices,
				message: 'Repo to clone?',
				name: 'src',
				suggest: (input, choices) =>
					choices.filter(({ value }) => fuzzysearch(input, value)),
				type: 'autocomplete',
			},
			{
				initial: '.',
				message: 'Destination directory?',
				name: 'dest',
				type: 'input',
			},
			{
				message: 'Use cached version?',
				name: 'cache',
				type: 'toggle',
			},
		]);

		const empty = !fs.existsSync(options.dest) || fs.readdirSync(options.dest).length === 0;

		if (!empty) {
			const { force } = await enquirer.prompt([
				{
					message: 'Overwrite existing files?',
					name: 'force',
					type: 'toggle',
				},
			]);

			if (!force) {
				console.error(chalk.magenta(`! Directory not empty — aborting`));
				return;
			}
		}

		run(options.src, options.dest, {
			cache: options.cache,
			force: true,
		});
	} else {
		run(src, dest, args);
	}
}

/* eslint-enable security/detect-non-literal-fs-filename */

export function run(src, dest, args) {
	const d = degit(src, args);

	d.on('info', (event) => {
		console.error(chalk.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	d.on('warn', (event) => {
		console.error(chalk.magenta(`! ${event.message.replace('options.', '--')}`));
	});

	d.clone(dest).catch((error) => {
		console.error(chalk.red(`! ${error.message.replace('options.', '--')}`));
		process.exit(1);
	});
}

if (!process.env.VITEST) {
	main(process.argv).catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
