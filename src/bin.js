import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import mri from 'mri';
import glob from 'tiny-glob/sync.js';
import fuzzysearch from 'fuzzysearch';
import enquirer from 'enquirer';
import degit from './index.js';
import { tryRequire, base } from './utils.js';

const args = mri(process.argv.slice(2), {
	alias: {
		f: 'force',
		c: 'cache',
		v: 'verbose',
		m: 'mode'
	},
	boolean: ['force', 'cache', 'verbose']
});

const [src, dest = '.'] = args._;

async function main() {
	if (args.help) {
		const help = fs
			.readFileSync(path.join(__dirname, 'help.md'), 'utf-8')
			.replace(/^(\s*)#+ (.+)/gm, (m, s, _) => s + chalk.bold(_))
			.replace(/_([^_]+)_/g, (m, _) => chalk.underline(_))
			.replace(/`([^`]+)`/g, (m, _) => chalk.cyan(_));

		process.stdout.write(`\n${help}\n`);
	} else if (!src) {
		// interactive mode

		const accessLookup = new Map();

		glob(`**/access.json`, { cwd: base }).forEach(file => {
			const [host, user, repo] = file.split(path.sep);

			const json = fs.readFileSync(`${base}/${file}`, 'utf-8');
			const logs = JSON.parse(json);

			Object.entries(logs).forEach(([ref, timestamp]) => {
				const id = `${host}:${user}/${repo}#${ref}`;
				accessLookup.set(id, new Date(timestamp).getTime());
			});
		});

		const getChoice = file => {
			const [host, user, repo] = file.split(path.sep);

			return Object.entries(tryRequire(`${base}/${file}`)).map(
				([ref, hash]) => ({
					name: hash,
					message: `${host}:${user}/${repo}#${ref}`,
					value: `${host}:${user}/${repo}#${ref}`
				})
			);
		};

		const choices = glob(`**/map.json`, { cwd: base })
			.map(getChoice)
			.reduce(
				(accumulator, currentValue) => accumulator.concat(currentValue),
				[]
			)
			.sort((a, b) => {
				const aTime = accessLookup.get(a.value) || 0;
				const bTime = accessLookup.get(b.value) || 0;

				return bTime - aTime;
			});

		const options = await enquirer.prompt([
			{
				type: 'autocomplete',
				name: 'src',
				message: 'Repo to clone?',
				suggest: (input, choices) =>
					choices.filter(({ value }) => fuzzysearch(input, value)),
				choices
			},
			{
				type: 'input',
				name: 'dest',
				message: 'Destination directory?',
				initial: '.'
			},
			{
				type: 'toggle',
				name: 'cache',
				message: 'Use cached version?'
			}
		]);

		const empty =
			!fs.existsSync(options.dest) || fs.readdirSync(options.dest).length === 0;

		if (!empty) {
			const { force } = await enquirer.prompt([
				{
					type: 'toggle',
					name: 'force',
					message: 'Overwrite existing files?'
				}
			]);

			if (!force) {
				console.error(chalk.magenta(`! Directory not empty — aborting`));
				return;
			}
		}

		run(options.src, options.dest, {
			force: true,
			cache: options.cache
		});
	} else {
		run(src, dest, args);
	}
}

function run(src, dest, args) {
	const d = degit(src, args);

	d.on('info', event => {
		console.error(chalk.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	d.on('warn', event => {
		console.error(
			chalk.magenta(`! ${event.message.replace('options.', '--')}`)
		);
	});

	d.clone(dest).catch(err => {
		console.error(chalk.red(`! ${err.message.replace('options.', '--')}`));
		process.exit(1);
	});
}

main();
