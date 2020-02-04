import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import mri from 'mri';
import fg from 'fast-glob';
import fuzzysearch from 'fuzzysearch';
import { prompt } from 'enquirer';

// eslint-disable-next-line import/no-unresolved
import degit from 'degit';
import { tryRequire, base } from './utils';

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

		const getChoice = mapJsonPath => {
			const sliced = mapJsonPath.slice(base.length + 1, -'/map.json'.length);
			const [host, user, repo] = sliced.split(path.sep);

			return Object.entries(tryRequire(mapJsonPath)).map(([ref, hash]) => ({
				name: hash,
				message: `${host}/${user}/${repo}#${ref}`,
				value: `${host}/${user}/${repo}#${ref}`
			}));
		};

		const choices = [].concat(...fg.sync(`${base}/**/map.json`).map(getChoice));

		const options = await prompt([
			{
				type: 'autocomplete',
				name: 'src',
				message: 'Search from history',
				suggest: (input, choices) =>
					choices.filter(({ value }) => fuzzysearch(input, value)),
				choices
			},
			{
				type: 'input',
				name: 'dest',
				message: 'Dest? (default ".")',
				initial: '.'
			},
			{
				type: 'toggle',
				name: 'force',
				message: 'Force overriding?'
			},
			{
				type: 'toggle',
				name: 'cache',
				message: 'From cache?'
			}
		]);

		run(options.src, options.dest, {
			force: options.force,
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
