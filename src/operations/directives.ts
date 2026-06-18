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

function attachChildLoggers(child: ChildDegit): void {
	child.on('info', (event) => {
		process.stdout.write(`${colors.cyan(`> ${event.message.replace('options.', '--')}`)}\n`);
	});

	child.on('warn', (event) => {
		process.stderr.write(`${colors.magenta(`! ${event.message.replace('options.', '--')}`)}\n`);
	});
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function cloneDirective(
	context: DirectiveContext,
	dir: string,
	dest: string,
	action: CloneDirective,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
): Promise<void> {
	if (context.hasStashed === false) {
		stashFiles(dir, dest);
		context.hasStashed = true;
	}

	return context.getGitClient().then((git) => {
		const child = createChild(action.src, {
			cache: action.cache,
			fetch: context.fetch,
			force: true,
			git,
			verbose: action.verbose,
		});

		attachChildLoggers(child);

		return child.clone(dest).catch((error) => {
			process.stderr.write(`${colors.red(`! ${getErrorMessage(error)}`)}\n`);
			process.exitCode = 1;
		});
	});
}

function runDirective(
	context: DirectiveContext,
	directive: Directive,
	dir: string,
	dest: string,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
): Promise<void> {
	if (directive.action === 'clone') {
		return cloneDirective(context, dir, dest, directive, createChild);
	}

	context.remove(dest, directive);
	return Promise.resolve();
}

export function applyDirectives(
	context: DirectiveContext,
	directives: Directive[],
	dir: string,
	dest: string,
	createChild: (src: string, opts: ConstructorOptions) => ChildDegit,
): Promise<void> {
	let chain = Promise.resolve();

	for (const directive of directives) {
		chain = chain.then(() => runDirective(context, directive, dir, dest, createChild));
	}

	return chain.then(() => {
		if (context.hasStashed) {
			unstashFiles(dir, dest);
		}
	});
}
