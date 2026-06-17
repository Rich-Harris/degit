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
} from '../domain/types.js';

type ChildDegit = {
	clone(dest: string): Promise<void>;
	on(eventName: 'info' | 'warn', listener: (event: EventInfo) => void): ChildDegit;
};

type DirectiveContext = {
	fetch: FetchFn;
	getGitClient(): Promise<GitClient>;
	hasStashed: boolean;
	remove(dest: string, action: RemoveDirective): void;
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
