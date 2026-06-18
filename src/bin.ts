import fs from 'node:fs';
import path from 'node:path';
import colors from 'yoctocolors';
import enquirer from 'enquirer';
import fuzzysearch from 'fuzzysearch';
import mri from 'mri';
import glob from 'tiny-glob/sync.js';
import degit from './index.js';
import { base, tryRequire } from './shared/utils.js';

const dirname = import.meta.dirname;

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

type EnquirerPrompt = Parameters<typeof enquirer.prompt>[0];

function getCloneErrorDetail(error: unknown): string | null {
	if (!error || typeof error !== 'object') {
		return null;
	}

	const nestedError =
		'original' in error ? error.original : 'cause' in error ? error.cause : null;

	if (!nestedError) {
		return null;
	}

	if (nestedError instanceof Error) {
		return nestedError.stack || nestedError.message;
	}

	if (typeof nestedError === 'string') {
		return nestedError;
	}

	try {
		return JSON.stringify(nestedError);
	} catch {
		return String(nestedError);
	}
}

/* eslint-disable security/detect-non-literal-fs-filename */
function parseCliArgs(argv: string[]): CliArgs {
	return mri(argv.slice(2), {
		alias: {
			c: 'cache',
			f: 'force',
			m: 'mode',
			v: 'verbose',
		},
		boolean: ['force', 'cache', 'verbose'],
	}) as CliArgs;
}

function displayHelp(): void {
	const help = fs
		.readFileSync(path.join(dirname, '..', 'assets', 'help.md'), 'utf8')
		.replaceAll(/^(\s*)#+ (.+)/gm, (_match, indent, title) => indent + colors.bold(title))
		.replaceAll(/_([^_]+)_/g, (_match, value) => colors.underline(value))
		.replaceAll(/`([^`]+)`/g, (_match, value) => colors.cyan(value));

	process.stdout.write(`\n${help}\n`);
}

function getInteractiveChoices(): Choice[] {
	const accessLookup = new Map<string, number>();

	for (const file of glob('**/access.json', { cwd: base })) {
		const normalizedFile = file.replaceAll('\\', '/');
		const [host, user, repo] = normalizedFile.split('/');
		const json = fs.readFileSync(`${base}/${file}`, 'utf8');
		const logs = JSON.parse(json) as Record<string, string | number>;

		for (const [ref, timestamp] of Object.entries(logs)) {
			const id = `${host}:${user}/${repo}#${ref}`;
			accessLookup.set(id, new Date(String(timestamp)).getTime());
		}
	}

	const getChoices = (file: string): Choice[] => {
		const normalizedFile = file.replaceAll('\\', '/');
		const [host, user, repo] = normalizedFile.split('/');
		const entries = Object.entries(tryRequire(`${base}/${file}`) || {});

		return entries.map(([ref, hash]) => ({
			message: `${host}:${user}/${repo}#${ref}`,
			name: String(hash),
			value: `${host}:${user}/${repo}#${ref}`,
		}));
	};

	return glob('**/map.json', { cwd: base })
		.flatMap((file) => getChoices(file))
		.toSorted((a, b) => (accessLookup.get(b.value) || 0) - (accessLookup.get(a.value) || 0));
}

function promptForSource(): Promise<PromptResult> {
	const sourcePrompt = {
		choices: getInteractiveChoices(),
		message: 'Repo to clone?',
		name: 'src',
		suggest: (input: string, promptChoices: Choice[]) =>
			promptChoices.filter(({ value }) => fuzzysearch(input, value)),
		type: 'autocomplete',
	} as EnquirerPrompt;

	return Promise.resolve(
		enquirer.prompt<PromptResult>([
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
		] as EnquirerPrompt),
	);
}

function confirmOverwrite(): Promise<boolean> {
	return Promise.resolve(
		enquirer.prompt<ForceResult>([
			{
				message: 'Overwrite existing files?',
				name: 'force',
				type: 'toggle',
			},
		] as EnquirerPrompt),
	).then(({ force }) => force);
}

export function run(src: string, dest: string, args: RunArgs): void {
	const d = degit(src, args as Parameters<typeof degit>[1]);

	d.on('info', (event) => {
		process.stdout.write(`${colors.cyan(`> ${event.message.replace('options.', '--')}`)}\n`);
	});

	d.on('warn', (event) => {
		process.stderr.write(`${colors.magenta(`! ${event.message.replace('options.', '--')}`)}\n`);
	});

	d.clone(dest).catch((error: Error) => {
		process.stderr.write(`${colors.red(`! ${error.message.replace('options.', '--')}`)}\n`);
		if (args.verbose) {
			const detail = getCloneErrorDetail(error);

			if (detail) {
				process.stderr.write(`${detail}\n`);
			}
		}
		process.exitCode = 1;
	});
}

export function main(argv: string[]): Promise<void> {
	const args = parseCliArgs(argv);
	const [src, dest = '.'] = args._;

	if (args.help) {
		displayHelp();
		return Promise.resolve();
	}

	if (!src) {
		return promptForSource().then((options) => {
			const empty = !fs.existsSync(options.dest) || fs.readdirSync(options.dest).length === 0;

			if (!empty) {
				return confirmOverwrite().then((force) => {
					if (!force) {
						process.stderr.write(
							`${colors.magenta('! Directory not empty — aborting')}\n`,
						);
						return;
					}

					run(options.src, options.dest, { cache: options.cache, force: true });
				});
			}

			run(options.src, options.dest, { cache: options.cache, force: true });
		});
	}

	run(src, dest, args);
	return Promise.resolve();
}

/* eslint-enable security/detect-non-literal-fs-filename */

if (!process.env.VITEST) {
	try {
		await main(process.argv);
	} catch (error) {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	}
}
