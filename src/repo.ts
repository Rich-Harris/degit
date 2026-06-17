import { DegitError } from './utils.js';

type Provider = {
	domain: string;
	archiveUrl(repo: Repo, hash: string): string;
};

export type Repo = {
	mode: 'tar' | 'git';
	name: string;
	ref: string;
	site: string;
	transport: 'https' | 'ssh';
	ssh: string;
	subdir?: string;
	url: string;
	user: string;
};

const supported = new Set(['github', 'gitlab', 'bitbucket', 'git.sr.ht']);

export function getProvider(site: string): Provider | undefined {
	switch (site) {
		case 'github':
			return {
				domain: 'github.com',
				archiveUrl(repo, hash) {
					return `${repo.url}/archive/${hash}.tar.gz`;
				},
			};
		case 'gitlab':
			return {
				domain: 'gitlab.com',
				archiveUrl(repo, hash) {
					return `${repo.url}/repository/archive.tar.gz?ref=${hash}`;
				},
			};
		case 'bitbucket':
			return {
				domain: 'bitbucket.org',
				archiveUrl(repo, hash) {
					return `${repo.url}/get/${hash}.tar.gz`;
				},
			};
		case 'git.sr.ht':
			return {
				domain: 'git.sr.ht',
				archiveUrl(repo, hash) {
					return `${repo.url}/archive/${hash}.tar.gz`;
				},
			};
		default:
			return undefined;
	}
}

function resolveSource(
	source: string,
	src: string,
): { remainder: string; site: string; transport: 'https' | 'ssh' } {
	let site = 'github';
	let transport: 'https' | 'ssh' = 'https';
	let remainder = source;

	if (source.startsWith('https://') || source.startsWith('http://')) {
		const parsed = new URL(source);
		site = parsed.hostname.replace(/\.(com|org)$/, '');
		remainder = parsed.pathname.replace(/^\//, '');
	} else if (source.startsWith('ssh://')) {
		const parsed = new URL(source);
		site = parsed.hostname.replace(/\.(com|org)$/, '');
		remainder = parsed.pathname.replace(/^\//, '');
		transport = 'ssh';
	} else if (source.startsWith('git@')) {
		const match = /^git@([^:/]+)[:/](.+)$/.exec(source);
		if (!match) {
			throw new DegitError(`could not parse ${src}`, {
				code: 'BAD_SRC',
			});
		}

		site = match[1].replace(/\.(com|org)$/, '');
		remainder = match[2];
		transport = 'ssh';
	} else if (source.startsWith('git.sr.ht/')) {
		site = 'git.sr.ht';
		remainder = source.slice('git.sr.ht/'.length);
	} else {
		const colonIndex = source.indexOf(':');
		const slashIndex = source.indexOf('/');
		if (colonIndex !== -1 && (slashIndex === -1 || colonIndex < slashIndex)) {
			site = source.slice(0, colonIndex);
			remainder = source.slice(colonIndex + 1);
		}
	}

	return { remainder, site, transport };
}

export function parse(src: string): Repo {
	const [source, refValue = 'HEAD'] = src.split('#', 2);
	const { remainder, site, transport } = resolveSource(source, src);

	if (!supported.has(site)) {
		throw new DegitError(`degit supports GitHub, GitLab, Sourcehut and BitBucket`, {
			code: 'UNSUPPORTED_HOST',
		});
	}

	const provider = getProvider(site);
	if (!provider) {
		throw new DegitError(`degit supports GitHub, GitLab, Sourcehut and BitBucket`, {
			code: 'UNSUPPORTED_HOST',
		});
	}

	const [user, rawName, ...subdirParts] = remainder.split('/').filter(Boolean);
	if (!user || !rawName) {
		throw new DegitError(`could not parse ${src}`, {
			code: 'BAD_SRC',
		});
	}

	const name = rawName.replace(/\.git$/, '');
	const subdir = subdirParts.length > 0 ? `/${subdirParts.join('/')}` : undefined;

	const domain = provider.domain;
	const url = `https://${domain}/${user}/${name}`;
	const ssh = `ssh://git@${domain}/${user}/${name}`;

	return { mode: 'tar', name, ref: refValue, site, ssh, subdir, transport, url, user };
}
