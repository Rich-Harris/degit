import fs from 'node:fs';
import path from 'node:path';
import colors from 'yoctocolors';
import { stashFiles, unstashFiles } from '../shared/utils.js';
import type { GitClient } from '../domain/types.js';
import type {
	CloneDirective,
	ConstructorOptions,
	Directive,
	EventInfo,
	FetchFn,
	RemoveDirective,
	SearchReplaceDirective,
} from '../domain/types.js';

type ChildDegit = {
	clone(dest: string): Promise<void>;
	on(eventName: 'info' | 'warn', listener: (event: EventInfo) => void): ChildDegit;
};

type DirectiveContext = {
	fetch: FetchFn;
	getGitClient(): Promise<GitClient>;
	hasStashed: boolean;
	info(info: EventInfo): void;
	remove(dest: string, action: RemoveDirective): void;
	warn(info: EventInfo): void;
};

function attachChildLoggers(child: ChildDegit) {
	child.on('info', (event) => {
		console.log(colors.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	child.on('warn', (event) => {
		console.warn(colors.magenta(`! ${event.message.replace('options.', '--')}`));
	});
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

async function cloneDirective(
	context: DirectiveContext,
	dir: string,
	dest: string,
	action: CloneDirective,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
) {
	if (context.hasStashed === false) {
		stashFiles(dir, dest);
		context.hasStashed = true;
	}

	const child = createChild(action.src, {
		cache: action.cache,
		fetch: context.fetch,
		force: true,
		git: await context.getGitClient(),
		verbose: action.verbose,
	});

	attachChildLoggers(child);

	try {
		await child.clone(dest);
	} catch (error) {
		console.error(colors.red(`! ${getErrorMessage(error)}`));
		process.exit(1);
	}
}

async function runDirective(
	context: DirectiveContext,
	directive: Directive,
	dir: string,
	dest: string,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
) {
	if (directive.action === 'clone') {
		await cloneDirective(context, dir, dest, directive, createChild);
		return;
	}

	if (directive.action === 'search_replace') {
		searchReplaceFiles(dest, directive, context.info, context.warn);
		return;
	}

	context.remove(dest, directive);
}

export async function applyDirectives(
	context: DirectiveContext,
	directives: Directive[],
	dir: string,
	dest: string,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
) {
	await directives.reduce(
		(previous, directive) =>
			previous.then(() => runDirective(context, directive, dir, dest, createChild)),
		Promise.resolve(),
	);

	if (context.hasStashed) {
		unstashFiles(dir, dest);
	}
}

function searchReplaceFiles(
	dest: string,
	action: SearchReplaceDirective,
	info: (info: EventInfo) => void,
	warn: (info: EventInfo) => void,
) {
	/* eslint-disable security/detect-non-literal-regexp, security/detect-non-literal-fs-filename */
	const files = Array.isArray(action.files) ? action.files : [action.files];
	const root = path.resolve(dest);
	const replacement = process.env[action.replacement];

	if (replacement === undefined) {
		warn({
			message: `action wants to search_replace using env var ${colors.bold(action.replacement)} but it is not defined, skipping`,
		});
		return;
	}

	const pattern = new RegExp(action.pattern, 'g');
	const replacedFiles = files.flatMap((file) =>
		replaceFile(root, file, pattern, replacement, warn),
	);

	if (replacedFiles.length > 0) {
		info({
			message: `replaced content in ${colors.bold(String(replacedFiles.length))} files: ${replacedFiles.map((file) => colors.bold(file)).join(', ')}`,
		});
	}
}

function replaceFile(
	root: string,
	file: string,
	pattern: RegExp,
	replacement: string,
	warn: (info: EventInfo) => void,
) {
	const filePath = path.resolve(root, file);
	const relativePath = path.relative(root, filePath);

	if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it is outside the destination, skipping`,
		});
		return [];
	}

	if (!fs.existsSync(filePath)) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it does not exist`,
		});
		return [];
	}

	if (fs.lstatSync(filePath).isDirectory()) {
		warn({
			message: `action wants to search_replace ${colors.bold(file)} but it is a directory, skipping`,
		});
		return [];
	}

	const content = fs.readFileSync(filePath, 'utf8');
	const nextContent = content.replace(pattern, () => replacement);

	if (nextContent === content) {
		return [];
	}

	fs.writeFileSync(filePath, nextContent);
	return [file];
}

/* eslint-enable security/detect-non-literal-regexp, security/detect-non-literal-fs-filename */
