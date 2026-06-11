import child_process from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const releaseMode = process.env.DEGIT_TEST_MODE === 'release';
const releasePrefix = fs.mkdtempSync(path.join(os.tmpdir(), 'degit-release-'));

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
		return {
			args: [],
			command: process.env.DEGIT_TEST_BIN,
			cwd: process.cwd(),
		};
	}

	return process.platform === 'win32'
		? {
				args: [
					'exec',
					'--yes',
					'--prefix',
					releasePrefix,
					'--package=degit@latest',
					'--',
					'degit',
				],
				command: 'npm.cmd',
			}
		: {
				args: [
					'exec',
					'--yes',
					'--prefix',
					releasePrefix,
					'--package=degit@latest',
					'--',
					'degit',
				],
				command: 'npm',
			};
}

function createReleaseRunner() {
	const { command, args } = getReleaseCommand();

	return {
		clone(source: string, dest: string) {
			const result = child_process.spawnSync(command, [...args, source, dest], {
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
