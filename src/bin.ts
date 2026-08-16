import fs from 'node:fs';
import colors from 'yoctocolors';
import enquirer from 'enquirer';
import fuzzysearch from 'fuzzysearch';
import mri from 'mri';
import glob from 'tiny-glob/sync.js';
import { parse } from './domain/repo.js';
import degit from './index.js';
import {
	handleAliasSubcommand,
	handleListSubcommand,
	handleUnaliasSubcommand,
	loadAliases,
	resolveAlias,
} from './aliases.js';
import { base, DegitError, tryReadJson } from './shared/utils.js';

type Choice = {
	message: string;
	name: string;
	value: string;
};

type CliArgs = {
	_: string[];
	cache?: boolean;
	files?: string | string[] | boolean;
	force?: boolean;
	help?: boolean;
	mode?: string;
	'repo-name'?: boolean;
	verbose?: boolean;
	version?: boolean;
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
	aliases?: Record<string, string>;
	cache?: boolean;
	files?: string[];
	force?: boolean;
	mode?: string;
	verbose?: boolean;
};

/* eslint-disable security/detect-non-literal-fs-filename */
function parseCliArgs(argv: string[]) {
	return mri(argv.slice(2), {
		alias: {
			c: 'cache',
			f: 'force',
			F: 'files',
			m: 'mode',
			r: 'repo-name',
			v: 'verbose',
			V: 'version',
		},
		boolean: ['force', 'cache', 'repo-name', 'verbose', 'version'],
		string: ['files', 'mode'],
	}) as CliArgs;
}

function displayHelp() {
	const help = fs
		.readFileSync(new URL('../assets/help.md', import.meta.url), 'utf8')
		.replaceAll(/^(\s*)#+ (.+)/gmu, (_match, indent, title) => indent + colors.bold(title))
		.replaceAll(/_([^_]+)_/gu, (_match, value) => colors.underline(value))
		.replaceAll(/`([^`]+)`/gu, (_match, value) => colors.cyan(value));

	process.stdout.write(`\n${help}\n`);
}

function getVersion() {
	try {
		return (
			JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
				version: string;
			}
		).version;
	} catch (error) {
		throw new DegitError('Could not find package.json', {
			code: 'COULD_NOT_FIND_PACKAGE',
			original: error,
		});
	}
}

function getInteractiveChoices(): Choice[] {
	if (!fs.existsSync(base)) return [];

	const accessLookup = new Map<string, number>();

	glob('**/access.json', { cwd: base }).forEach((file) => {
		const normalizedFile = file.replaceAll('\\', '/');
		const [host, user, repo] = normalizedFile.split('/');
		const logs = (tryReadJson(`${base}/${file}`) as Record<string, string | number>) ?? {};

		Object.entries(logs).forEach(([ref, timestamp]) => {
			const id = `${host}:${user}/${repo}#${ref}`;
			accessLookup.set(id, new Date(String(timestamp)).getTime());
		});
	});

	const getChoices = (file: string): Choice[] => {
		const normalizedFile = file.replaceAll('\\', '/');
		const [host, user, repo] = normalizedFile.split('/');
		const entries = Object.entries(tryReadJson(`${base}/${file}`) ?? {});

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
	} as any;

	return enquirer.prompt<PromptResult>([
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
}

async function confirmOverwrite(): Promise<boolean> {
	const { force } = await enquirer.prompt<ForceResult>([
		{
			message: 'Overwrite existing files?',
			name: 'force',
			type: 'toggle',
		},
	] as any);

	return force;
}

async function handleInteractiveClone() {
	const options = await promptForSource();

	const empty = !fs.existsSync(options.dest) || fs.readdirSync(options.dest).length === 0;

	if (!empty && !(await confirmOverwrite())) {
		console.error(colors.magenta('! Directory not empty — aborting'));
		return;
	}

	run(options.src, options.dest, {
		cache: options.cache,
		force: true,
	});
}

function normalizeFiles(files: string | string[] | boolean | undefined): string[] | undefined {
	if (typeof files !== 'string' && !Array.isArray(files)) {
		return undefined;
	}

	const list = Array.isArray(files) ? files : [files];
	const result = list
		.flatMap((file) => file.split(','))
		.map((file) => file.trim())
		.filter(Boolean);
	return result.length > 0 ? result : undefined;
}

export async function main(argv: string[]) {
	const args = parseCliArgs(argv);

	const [src, positionalDest] = args._;

	if (args.help) {
		displayHelp();
		return;
	}

	if (args.version) {
		process.stdout.write(`${getVersion()}\n`);
		return;
	}

	if (src === 'alias') {
		handleAliasSubcommand(args._);
		return;
	}

	if (src === 'unalias') {
		handleUnaliasSubcommand(args._);
		return;
	}

	if (src === 'ls') {
		handleListSubcommand();
		return;
	}

	if (!src) {
		await handleInteractiveClone();
		return;
	}

	const aliases = loadAliases();
	const resolvedSrc = resolveAlias(aliases, src) ?? src;
	const dest = positionalDest ?? (args['repo-name'] ? parse(resolvedSrc).name : '.');
	const files = normalizeFiles(args.files);
	run(resolvedSrc, dest, { ...args, aliases, files });
}

/* eslint-enable security/detect-non-literal-fs-filename */
export function run(src: string, dest: string, args: RunArgs) {
	const d = degit(src, args as Parameters<typeof degit>[1]);

	d.on('info', (event) => {
		console.log(colors.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	d.on('warn', (event) => {
		console.warn(colors.magenta(`! ${event.message.replace('options.', '--')}`));
	});

	d.clone(dest).catch((error: Error) => {
		console.error(colors.red(`! ${error.message.replace('options.', '--')}`));
		if (args.verbose) {
			const detail = getCloneErrorDetail(error);

			if (detail) {
				console.error(detail);
			}
		}
		process.exit(1);
	});
}

function getCloneErrorDetail(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') {
		return undefined;
	}

	const nestedError =
		'original' in error ? error.original : 'cause' in error ? error.cause : undefined;

	if (!nestedError) {
		return undefined;
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

if (!process.env.VITEST) {
	try {
		await main(process.argv);
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
}
