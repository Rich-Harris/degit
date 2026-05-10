import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import mri from 'mri';
import glob from 'tiny-glob/sync.js';
import fuzzysearch from 'fuzzysearch';
import enquirer from 'enquirer';
import degit from './index';
import { tryRequire, base } from './utils';

type Argv = {
	_?: string[];
	help?: boolean;
	force?: boolean;
	cache?: boolean;
	verbose?: boolean;
	mode?: string;
};

const args = mri(process.argv.slice(2), {
	alias: {
		f: 'force',
		c: 'cache',
		v: 'verbose',
		m: 'mode'
	},
	boolean: ['force', 'cache', 'verbose']
}) as Argv;

const positionalArgs = (args._ ?? []) as Array<string | undefined>;
const src = positionalArgs[0];
const dest = positionalArgs[1] || '.';

async function main(): Promise<void> {
	if (args.help) {
		const help = fs
			.readFileSync(path.join(__dirname, 'help.md'), 'utf-8')
			.replace(
				/^(\s*)#+ (.+)/gm,
				(_match, s, heading) => s + chalk.bold(heading)
			)
			.replace(/_([^_]+)_/g, (_match, value) => chalk.underline(value))
			.replace(/`([^`]+)`/g, (_match, value) => chalk.cyan(value));

		process.stdout.write(`\n${help}\n`);
	} else if (!src) {
		const accessLookup = new Map<string, number>();

		glob(`**/access.json`, { cwd: base }).forEach(file => {
			const [host, user, repo] = file.split(path.sep);
			const json = fs.readFileSync(`${base}/${file}`, 'utf-8');
			const logs = JSON.parse(json);

			Object.entries(logs).forEach(([ref, timestamp]) => {
				const id = `${host}:${user}/${repo}#${ref}`;
				accessLookup.set(id, new Date(timestamp as string).getTime());
			});
		});

		const getChoice = (file: string) => {
			const [host, user, repo] = file.split(path.sep);
			const map = tryRequire(`${base}/${file}`) as Record<string, string> | false;
			if (!map) return [];

			return Object.entries(map).map(
				([ref, hash]) => ({
					name: hash,
					message: `${host}:${user}/${repo}#${ref}`,
					value: `${host}:${user}/${repo}#${ref}`
				})
			);
		};

		const choices = glob(`**/map.json`, { cwd: base })
			.map(getChoice)
			.flat()
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
					suggest: (input, options) =>
						options.filter(({ value }) => fuzzysearch(input, value)),
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
			]) as { src: string; dest: string; cache: boolean };

		const empty =
			!fs.existsSync(options.dest) || fs.readdirSync(options.dest).length === 0;

		if (!empty) {
			const { force } = await enquirer.prompt([
				{
					type: 'toggle',
					name: 'force',
					message: 'Overwrite existing files?'
				}
			]) as { force: boolean };

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

function run(src: string, dest: string, args: Argv): void {
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
