import { DegitError } from '../shared/utils.js';

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'git.sr.ht';

export type Repo = {
	mode: 'tar' | 'git';
	name: string;
	ref: string;
	site: GitProvider;
	transport: 'https' | 'ssh';
	ssh: string;
	subdir?: string;
	url: string;
	user: string;
};

type ArchiveContext = Pick<Repo, 'url' | 'name'>;

const providerDomains = new Map<GitProvider, string>([
	['github', 'github.com'],
	['gitlab', 'gitlab.com'],
	['bitbucket', 'bitbucket.org'],
	['git.sr.ht', 'git.sr.ht'],
]);

export const providerArchiveTemplates: Record<
	GitProvider,
	(repo: ArchiveContext, hash: string) => string
> = {
	github: (repo, hash) => `${repo.url}/archive/${hash}.tar.gz`,
	gitlab: (repo, hash) => `${repo.url}/-/archive/${hash}/${repo.name}-${hash}.tar.gz`,
	bitbucket: (repo, hash) => `${repo.url}/get/${hash}.tar.gz`,
	'git.sr.ht': (repo, hash) => `${repo.url}/archive/${hash}.tar.gz`,
};

function isGitProvider(site: string): site is GitProvider {
	return Object.hasOwn(providerArchiveTemplates, site);
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
	const decodedSrc = decodeURIComponent(src);
	const [source, refValue = 'HEAD'] = decodedSrc.split('#', 2);
	const { remainder, site, transport, customDomain, isWebUrl } = resolveSource(
		source,
		decodedSrc,
	);

	if (!isGitProvider(site)) {
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
		const parsed = parseWebPath(site, rest);
		if (parsed) {
			if (refValue === 'HEAD') {
				ref = parsed.ref;
			}
			subdirParts = parsed.subdir;
		}
	}

	const subdir = subdirParts.length > 0 ? `/${subdirParts.join('/')}` : undefined;

	const domain = customDomain ?? providerDomains.get(site)!;
	const url = `https://${domain}/${user}/${name}`;
	const ssh = `ssh://git@${domain}/${user}/${name}`;

	return { mode: 'tar', name, ref, site, ssh, subdir, transport, url, user };
}

export function generateGitlabRepoCandidates(resolvedSrc: string, baseRepo: Repo): Repo[] {
	if (baseRepo.site !== 'gitlab') {
		return [baseRepo];
	}
	const [sourcePart] = resolvedSrc.split('#', 2);
	const withoutDotGit = sourcePart.replace(/\.git$/u, '');
	const { remainder, isWebUrl } = resolveSource(withoutDotGit, resolvedSrc);
	const domain = new URL(baseRepo.url).hostname;
	let projectPath = remainder;
	let hasMarker = false;
	if (isWebUrl) {
		const segments = remainder.split('/').filter(Boolean);
		const markerIndex = segments.findIndex(
			(segment, index) =>
				segment === '-' &&
				(segments[index + 1] === 'tree' || segments[index + 1] === 'blob'),
		);
		if (markerIndex === -1) {
			projectPath = remainder;
		} else {
			projectPath = segments.slice(0, markerIndex).join('/');
			hasMarker = true;
		}
	}
	const segments = projectPath.split('/').filter(Boolean);
	const candidates: Repo[] = [];
	for (let index = 2; index <= segments.length; index += 1) {
		const user = segments.slice(0, index - 1).join('/');
		const name = segments[index - 1];
		const tail = segments.slice(index).join('/');
		const subdir = hasMarker ? baseRepo.subdir : tail ? `/${tail}` : undefined;
		candidates.push({
			...baseRepo,
			user,
			name,
			subdir,
			url: `https://${domain}/${user}/${name}`,
			ssh: `ssh://git@${domain}/${user}/${name}`,
		});
	}
	return candidates;
}
