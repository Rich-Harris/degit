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
	isWebUrl: boolean;
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
		isWebUrl: true,
	};
}

function resolveSource(source: string, src: string): ResolvedSource {
	let site = 'github';
	let transport: 'https' | 'ssh' = 'https';
	let isWebUrl = false;
	let remainder = source;

	if (source.startsWith('https://') || source.startsWith('http://')) {
		const parsed = new URL(source);
		site = parsed.hostname.replace(/\.(com|org)$/u, '');
		remainder = parsed.pathname.replace(/^\//u, '');
		isWebUrl = true;
	} else if (source.startsWith('ssh://')) {
		const parsed = new URL(source);
		site = parsed.hostname.replace(/\.(com|org)$/u, '');
		remainder = parsed.pathname.replace(/^\//u, '');
		transport = 'ssh';
		isWebUrl = true;
	} else if (source.startsWith('git@')) {
		const match = /^git@([^:/]+)[:/](.+)$/u.exec(source);
		if (!match) {
			throw new DegitError(`could not parse ${src}`, { code: 'BAD_SRC' });
		}
		site = match[1].replace(/\.(com|org)$/u, '');
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

	return { remainder, site, transport, isWebUrl };
}

function parseWebPath(
	site: GitProvider,
	segments: string[],
): { ref: string; subdir: string[] } | undefined {
	switch (site) {
		case 'github': {
			const i = segments.findIndex(
				(s, idx) => (s === 'tree' || s === 'blob') && idx + 1 < segments.length,
			);
			if (i === -1) return undefined;
			return { ref: segments[i + 1], subdir: segments.slice(i + 2) };
		}
		case 'gitlab': {
			const i = segments.findIndex(
				(s, idx) =>
					s === '-' &&
					(segments[idx + 1] === 'tree' || segments[idx + 1] === 'blob') &&
					idx + 2 < segments.length,
			);
			if (i === -1) return undefined;
			return { ref: segments[i + 2], subdir: segments.slice(i + 3) };
		}
		case 'bitbucket': {
			const i = segments.findIndex((s, idx) => s === 'src' && idx + 1 < segments.length);
			if (i === -1) return undefined;
			return { ref: segments[i + 1], subdir: segments.slice(i + 2) };
		}
		case 'git.sr.ht': {
			const i = segments.findIndex((s, idx) => s === 'tree' && idx + 1 < segments.length);
			if (i === -1) return undefined;
			return { ref: segments[i + 1], subdir: segments.slice(i + 2) };
		}
	}
}

export function parse(src: string): Repo {
	const [source, refValue = 'HEAD'] = src.split('#', 2);
	const { remainder, site, transport, customDomain, isWebUrl } = resolveSource(source, src);

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

	const [user, rawName, ...rest] = remainder.split('/').filter(Boolean);
	if (!user || !rawName) {
		throw new DegitError(`could not parse ${src}`, {
			code: 'BAD_SRC',
		});
	}

	const name = rawName.replace(/\.git$/u, '');

	let ref = refValue;
	let subdirParts = rest;
	if (isWebUrl) {
		const parsed = parseWebPath(site as GitProvider, rest);
		if (parsed) {
			if (refValue === 'HEAD') {
				ref = parsed.ref;
			}
			subdirParts = parsed.subdir;
		}
	}

	const subdir = subdirParts.length > 0 ? `/${subdirParts.join('/')}` : undefined;

	const domain = customDomain ?? provider.domain;
	const url = `https://${domain}/${user}/${name}`;
	const ssh = `ssh://git@${domain}/${user}/${name}`;

	return { mode: 'tar', name, ref, site, ssh, subdir, transport, url, user };
}
