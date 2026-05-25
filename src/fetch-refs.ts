import { DegitError, exec } from './utils.js';
import { getProvider, type Repo } from './repo.js';

type ExecResult = {
	stderr: string;
	stdout: string;
};

type ExecFn = (command: string, args?: string[]) => Promise<ExecResult>;

export async function fetchRefs(repo: Repo, runExec: ExecFn = exec) {
	try {
		const provider = getProvider(repo.site);
		const remote = new URL(repo.url);

		if (!provider || remote.protocol !== 'https:' || remote.hostname !== provider.domain) {
			throw new DegitError(`could not fetch remote ${repo.url}`, {
				code: 'COULD_NOT_FETCH',
				url: repo.url,
			});
		}

		const { stdout } = await runExec('git', ['ls-remote', '--', repo.url]);

		return stdout
			.split('\n')
			.filter(Boolean)
			.map((row) => {
				const [hash, ref] = row.split('\t');

				if (ref === 'HEAD') {
					return {
						hash,
						type: 'HEAD',
					};
				}

				const match = /refs\/(\w+)\/(.+)/.exec(ref);
				if (!match) {
					throw new DegitError(`could not parse ${ref}`, {
						code: 'BAD_REF',
					});
				}

				return {
					hash,
					name: match[2],
					type: match[1] === 'heads' ? 'branch' : match[1] === 'refs' ? 'ref' : match[1],
				};
			});
	} catch (error) {
		throw new DegitError(`could not fetch remote ${repo.url}`, {
			code: 'COULD_NOT_FETCH',
			original: error,
			url: repo.url,
		});
	}
}
