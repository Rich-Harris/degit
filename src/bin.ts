import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import enquirer from 'enquirer';
import fuzzysearch from 'fuzzysearch';
import mri from 'mri';
import glob from 'tiny-glob/sync.js';
import degit from './index.js';
import { base, tryRequire } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Choice = {
	message: string;
	name: string;
	value: string;
};

type CliArgs = {
	_: string[];
	cache?: boolean;
	force?: boolean;
	help?: boolean;
	mode?: string;
	verbose?: boolean;
};

type PromptResult = {
	cache: boolean;
	dest: string;
	src: string;
};

type ForceResult = {
	force: boolean;
};

type RunArgs = {
	cache?: boolean;
	force?: boolean;
	mode?: string;
	verbose?: boolean;
};

/* eslint-disable security/detect-non-literal-fs-filename */
export async function main(argv: string[]) {
	const args = mri(argv.slice(2), {
		alias: {
			c: 'cache',
			f: 'force',
			m: 'mode',
			v: 'verbose',
		},
		boolean: ['force', 'cache', 'verbose'],
	}) as CliArgs;

	const [src, dest = '.'] = args._;

	if (args.help) {
		const help = fs
			.readFileSync(path.join(__dirname, '..', 'help.md'), 'utf8')
			.replaceAll(/^(\s*)#+ (.+)/gm, (match, indent, title) => indent + chalk.bold(title))
			.replaceAll(/_([^_]+)_/g, (match, value) => chalk.underline(value))
			.replaceAll(/`([^`]+)`/g, (match, value) => chalk.cyan(value));

		process.stdout.write(`\n${help}\n`);
		return;
	}

	if (!src) {
		const accessLookup = new Map<string, number>();

		glob('**/access.json', { cwd: base }).forEach((file) => {
			const [host, user, repo] = file.split(path.sep);
			const json = fs.readFileSync(`${base}/${file}`, 'utf8');
			const logs = JSON.parse(json) as Record<string, string | number>;

			Object.entries(logs).forEach(([ref, timestamp]) => {
				const id = `${host}:${user}/${repo}#${ref}`;
				accessLookup.set(id, new Date(String(timestamp)).getTime());
			});
		});

		const getChoices = (file: string): Choice[] => {
			const [host, user, repo] = file.split(path.sep);
			const entries = Object.entries(tryRequire(`${base}/${file}`) || {});

			return entries.map(([ref, hash]) => ({
				message: `${host}:${user}/${repo}#${ref}`,
				name: String(hash),
				value: `${host}:${user}/${repo}#${ref}`,
			}));
		};

		const choices = glob('**/map.json', { cwd: base })
			.map(getChoices)
			.flat()
			.sort((a, b) => (accessLookup.get(b.value) || 0) - (accessLookup.get(a.value) || 0));

		const sourcePrompt = {
			choices,
			message: 'Repo to clone?',
			name: 'src',
			suggest: (input: string, promptChoices: Choice[]) =>
				promptChoices.filter(({ value }) => fuzzysearch(input, value)),
			type: 'autocomplete',
		} as any;

		const options = await enquirer.prompt<PromptResult>([
			sourcePrompt,
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
		] as any);

		const empty = !fs.existsSync(options.dest) || fs.readdirSync(options.dest).length === 0;

		if (!empty) {
			const { force } = await enquirer.prompt<ForceResult>([
				{
					message: 'Overwrite existing files?',
					name: 'force',
					type: 'toggle',
				},
			] as any);

			if (!force) {
				console.error(chalk.magenta('! Directory not empty — aborting'));
				return;
			}
		}

		run(options.src, options.dest, {
			cache: options.cache,
			force: true,
		});
		return;
	}

	run(src, dest, args);
}

/* eslint-enable security/detect-non-literal-fs-filename */
export function run(src: string, dest: string, args: RunArgs) {
	const d = degit(src, args);

	d.on('info', (event) => {
		console.error(chalk.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	d.on('warn', (event) => {
		console.error(chalk.magenta(`! ${event.message.replace('options.', '--')}`));
	});

	d.clone(dest).catch((error: Error) => {
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
