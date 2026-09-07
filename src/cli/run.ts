import colors from 'yoctocolors';
import degit from '../index.js';
import { startSpinner } from '../shared/spinner.js';

type RunArgs = {
	aliases?: Record<string, string>;
	cache?: boolean;
	files?: string[];
	force?: boolean;
	interactive?: boolean;
	mode?: string;
	verbose?: boolean;
};

export function run(src: string, dest: string, args: RunArgs) {
	const { interactive, ...degitArgs } = args;
	const d = degit(src, degitArgs as Parameters<typeof degit>[1]);
	const spinner = interactive ? startSpinner() : null;

	d.on('info', (event) => {
		if (event.code === 'SUCCESS') {
			spinner?.stop();
		} else {
			spinner?.clear();
		}
		console.log(colors.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	d.on('warn', (event) => {
		spinner?.clear();
		console.warn(colors.magenta(`! ${event.message.replace('options.', '--')}`));
	});

	d.clone(dest)
		.then(() => spinner?.stop())
		.catch((error: Error) => {
			spinner?.stop();
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
