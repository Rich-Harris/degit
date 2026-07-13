import { DegitError } from '../shared/utils.js';

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

type ArchiveContext = Pick<Repo, 'url' | 'name'>;

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'git.sr.ht';

type Provider = {
	domain: string;
	archiveUrl(repo: ArchiveContext, hash: string): string;
};

const supported = new Set(['github', 'gitlab', 'bitbucket', 'git.sr.ht']);

export const providerArchiveTemplates: Record<
	GitProvider,
	(repo: ArchiveContext, hash: string) => string
> = {
	github: (repo, hash) => `${repo.url}/archive/${hash}.tar.gz`,
	gitlab: (repo, hash) => `${repo.url}/-/archive/${hash}/${repo.name}-${hash}.tar.gz`,
	bitbucket: (repo, hash) => `${repo.url}/get/${hash}.tar.gz`,
	'git.sr.ht': (repo, hash) => `${repo.url}/archive/${hash}.tar.gz`,
};

export function getProvider(site: string): Provider | undefined {
	switch (site) {
		case 'github':
			return {
				domain: 'github.com',
				archiveUrl: providerArchiveTemplates.github,
			};
		case 'gitlab':
			return {
				domain: 'gitlab.com',
				archiveUrl: providerArchiveTemplates.gitlab,
			};
		case 'bitbucket':
			return {
				domain: 'bitbucket.org',
				archiveUrl: providerArchiveTemplates.bitbucket,
			};
		case 'git.sr.ht':
			return {
				domain: 'git.sr.ht',
				archiveUrl: providerArchiveTemplates['git.sr.ht'],
			};
		default:
			return undefined;
	}
}

type ResolvedSource = {
	remainder: string;
	site: string;
	transport: 'https' | 'ssh';
	customDomain?: string;
};

function parseGitlabUrl(source: string, src: string): ResolvedSource {
	const path = source.slice('gitlab://'.length);
	const slashIndex = path.indexOf('/');
	if (slashIndex === -1) {
		throw new DegitError(`could not parse ${src}`, { code: 'BAD_SRC' });
	}
	return {
		customDomain: path.slice(0, slashIndex),
		remainder: path.slice(slashIndex + 1),
		site: 'gitlab',
		transport: 'https',
	};
}

function resolveSource(source: string, src: string): ResolvedSource {
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
			throw new DegitError(`could not parse ${src}`, { code: 'BAD_SRC' });
		}
		site = match[1].replace(/\.(com|org)$/, '');
		remainder = match[2];
		transport = 'ssh';
	} else if (source.startsWith('git.sr.ht/')) {
		site = 'git.sr.ht';
		remainder = source.slice('git.sr.ht/'.length);
	} else if (source.startsWith('gitlab://')) {
		return parseGitlabUrl(source, src);
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
	const { remainder, site, transport, customDomain } = resolveSource(source, src);

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

	const domain = customDomain ?? provider.domain;
	const url = `https://${domain}/${user}/${name}`;
	const ssh = `ssh://git@${domain}/${user}/${name}`;

	return { mode: 'tar', name, ref: refValue, site, ssh, subdir, transport, url, user };
}
