import child_process from 'node:child_process';
import path from 'node:path';

const releaseMode = process.env.DEGIT_TEST_MODE === 'release';

function formatFailure(
	source: string,
	dest: string,
	result: child_process.SpawnSyncReturns<string>,
) {
	const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
	const details = output ? `\n${output}` : '';

	return new Error(`degit ${source} -> ${dest} failed${details}`);
}

function getReleaseCommand() {
	if (process.env.DEGIT_TEST_BIN) {
		return process.env.DEGIT_TEST_BIN;
	}

	const prefixResult = child_process.spawnSync('npm', ['prefix', '-g'], {
		encoding: 'utf8',
		env: process.env,
	});

	if (prefixResult.error) {
		throw prefixResult.error;
	}

	if (prefixResult.status !== 0) {
		throw new Error(
			`unable to resolve global npm prefix${prefixResult.stderr ? `: ${prefixResult.stderr.trim()}` : ''}`,
		);
	}

	const prefix = prefixResult.stdout.trim();
	const command = process.platform === 'win32' ? 'degit.cmd' : 'degit';
	const binDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
	return path.join(binDir, command);
}

function createReleaseRunner() {
	const command = getReleaseCommand();

	return {
		async clone(source: string, dest: string) {
			const result = child_process.spawnSync(command, [source, dest], {
				encoding: 'utf8',
				env: process.env,
			});

			if (result.error) {
				throw result.error;
			}

			if (result.status !== 0) {
				throw formatFailure(source, dest, result);
			}
		},
	};
}

function createSourceRunner() {
	return {
		clone: async (source: string, dest: string) => {
			const { default: degit } = await import('../../src/index.js');
			await degit(source).clone(dest);
		},
	};
}

export function createIntegrationRunner() {
	return releaseMode ? createReleaseRunner() : createSourceRunner();
}
