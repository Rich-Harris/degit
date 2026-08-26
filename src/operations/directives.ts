import fs from 'node:fs';
import colors from 'yoctocolors';
import {
	DegitError,
	copyToStash,
	removeStashedFromDest,
	unstashFiles,
	validateDestination,
} from '../shared/utils.js';
import { removeFiles } from './filesystem.js';
import { searchReplaceFiles } from './search-replace.js';
import type { GitClient } from '../domain/types.js';
import type {
	CloneDirective,
	ConstructorOptions,
	Directive,
	EventInfo,
	FetchFn,
} from '../domain/types.js';
type ChildDegit = {
	clone(dest: string): Promise<void>;
	on(eventName: 'info' | 'warn', listener: (event: EventInfo) => void): ChildDegit;
};
export type DirectiveContext = {
	aliases?: Record<string, string>;
	cache?: boolean;
	fetch: FetchFn;
	getGitClient(): Promise<GitClient>;
	getStagingDir(): Promise<string>;
	hasStashed: boolean;
	info(info: EventInfo): void;
	stagingDir?: string;
	verbose?: boolean;
	warn(info: EventInfo): void;
};
// eslint-disable-next-line max-lines-per-function
async function cloneDirective(
	context: DirectiveContext,
	dest: string,
	action: CloneDirective,
	files: string[] | undefined,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
) {
	if (typeof action.src !== 'string' || action.src === '') {
		throw new DegitError('clone directive requires a non-empty source', { code: 'BAD_SRC' });
	}
	const destIsDir = validateDestination(dest, true);
	let dir: string | undefined;
	if (destIsDir) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const destHasContents = fs.readdirSync(dest).length > 0;
		if (destHasContents || context.hasStashed) {
			dir = await context.getStagingDir();
			if (context.hasStashed === false) {
				const toRemove = copyToStash(dir, dest);
				context.hasStashed = true;
				removeStashedFromDest(toRemove);
			}
		}
	}

	if (action.cache !== undefined && typeof action.cache !== 'boolean') {
		context.warn({ message: 'clone action cache must be a boolean, ignoring' });
	}
	if (action.verbose !== undefined && typeof action.verbose !== 'boolean') {
		context.warn({ message: 'clone action verbose must be a boolean, ignoring' });
	}

	const child = createChild(action.src, {
		aliases: context.aliases,
		cache: typeof action.cache === 'boolean' ? action.cache : context.cache,
		fetch: context.fetch,
		files,
		force: true,
		git: await context.getGitClient(),
		verbose: typeof action.verbose === 'boolean' ? action.verbose : context.verbose,
	});

	child.on('info', context.info);
	child.on('warn', context.warn);

	try {
		await child.clone(dest);
	} catch (error) {
		if (!destIsDir) {
			fs.rmSync(dest, { force: true, recursive: true });
		}
		throw error;
	}

	if (context.hasStashed && dir) {
		const result = tryUnstash(dir, dest);
		if (result.ok === true) {
			context.hasStashed = false;
		} else {
			throw new DegitError(`could not restore stashed files: ${result.message}`, {
				code: 'COULD_NOT_RESTORE',
				original: result.original,
			});
		}
	}
}

function getDirectiveFiles(files: unknown): string[] | undefined {
	if (typeof files === 'string' && files !== '') return [files];
	if (
		Array.isArray(files) &&
		files.length > 0 &&
		files.every((file) => typeof file === 'string' && file !== '')
	) {
		return files;
	}
	return undefined;
}
// eslint-disable-next-line max-lines-per-function
async function runDirective(
	context: DirectiveContext,
	directive: Directive,
	dest: string,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
) {
	const action =
		typeof directive === 'object' && directive !== null
			? (directive as { action?: unknown }).action
			: undefined;

	if (typeof action !== 'string') {
		context.warn({
			message: `unknown directive action ${colors.bold(String(action))}, skipping`,
		});
		return;
	}

	if (directive.action === 'clone') {
		const files = getDirectiveFiles(directive.files);
		if (directive.files !== undefined && files === undefined) {
			context.warn({
				message: 'clone action requires a string or array of strings for files, skipping',
			});
			return;
		}
		await cloneDirective(context, dest, directive, files, createChild);
		return;
	}

	if (directive.action === 'search_replace') {
		validateDestination(dest, false);
		const files = getDirectiveFiles(directive.files);
		if (files === undefined) {
			context.warn({
				message:
					'search_replace action requires a string or array of strings for files, skipping',
			});
			return;
		}
		if (typeof directive.pattern !== 'string' || directive.pattern === '') {
			context.warn({
				message: 'search_replace action requires a non-empty pattern, skipping',
			});
			return;
		}
		if (typeof directive.replacement !== 'string' || directive.replacement === '') {
			context.warn({
				message:
					'search_replace action requires a non-empty replacement environment variable name, skipping',
			});
			return;
		}
		searchReplaceFiles(dest, { ...directive, files }, context.info, context.warn);
		return;
	}

	if (directive.action === 'remove') {
		validateDestination(dest, false);
		const files = getDirectiveFiles(directive.files);
		if (files === undefined) {
			context.warn({
				message: 'remove action requires a string or array of strings for files, skipping',
			});
			return;
		}
		if (directive.allowGlobs !== undefined && typeof directive.allowGlobs !== 'boolean') {
			context.warn({ message: 'remove action allowGlobs must be a boolean, ignoring' });
		}
		removeFiles(
			dest,
			{
				...directive,
				files,
				allowGlobs:
					typeof directive.allowGlobs === 'boolean' ? directive.allowGlobs : undefined,
			},
			context.info,
			context.warn,
		);
		return;
	}

	context.warn({
		message: `unknown directive action ${colors.bold(action)}, skipping`,
	});
}

type UnstashResult = { ok: true } | { ok: false; message: string; original: unknown };

function tryUnstash(dir: string | undefined, dest: string, keepCloneOutput = true): UnstashResult {
	if (!dir) {
		return { ok: true };
	}
	try {
		unstashFiles(dir, dest, keepCloneOutput);
		return { ok: true };
	} catch (unstashError) {
		const message = unstashError instanceof Error ? unstashError.message : String(unstashError);
		return { ok: false, message, original: unstashError };
	}
}

export async function applyDirectives(
	context: DirectiveContext,
	directives: Directive[],
	dest: string,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
) {
	try {
		for (const directive of directives) {
			// oxlint-disable-next-line eslint/no-await-in-loop
			await runDirective(context, directive, dest, createChild);
		}
	} catch (error) {
		if (
			context.hasStashed &&
			!(error instanceof DegitError && error.code === 'COULD_NOT_RESTORE')
		) {
			const result = tryUnstash(context.stagingDir, dest, false);
			if (result.ok === true) {
				context.hasStashed = false;
			} else {
				context.warn({
					message: `could not restore stashed files: ${result.message}`,
					original: result.original,
				});
			}
		}
		throw error;
	}
}
