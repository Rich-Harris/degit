import type { Repo } from './repo.js';

export type GitClient = {
	fetchRefs(repo: Repo): Promise<Ref[]>;
	clone(repo: Repo, dest: string, ref?: string, transport?: Repo['transport']): Promise<void>;
};

export const validModes = new Set(['tar', 'git']);

export type FetchFn = (url: string, dest: string, proxy?: string) => Promise<void>;

export type ConstructorOptions = {
	cache?: boolean;
	fetch?: FetchFn;
	force?: boolean;
	git?: GitClient;
	mode?: 'tar' | 'git';
	platform?: NodeJS.Platform;
	verbose?: boolean;
};

export type InfoCode =
	| 'SUCCESS'
	| 'FILE_DOES_NOT_EXIST'
	| 'FILE_OUTSIDE_DEST'
	| 'REMOVED'
	| 'DEST_NOT_EMPTY'
	| 'DEST_IS_EMPTY'
	| 'USING_CACHE'
	| 'FOUND_MATCH'
	| 'FILE_EXISTS'
	| 'PROXY'
	| 'DOWNLOADING'
	| 'EXTRACTING';

export type DegitErrorCode =
	| 'DEST_NOT_EMPTY'
	| 'MISSING_REF'
	| 'COULD_NOT_DOWNLOAD'
	| 'BAD_SRC'
	| 'UNSUPPORTED_HOST'
	| 'BAD_REF'
	| 'COULD_NOT_FETCH';

export type EventInfo = {
	code?: InfoCode | DegitErrorCode;
	dest?: string;
	message: string;
	repo?: Repo;
	url?: string;
	original?: unknown;
	ref?: string;
};

export type Ref = {
	hash: string;
	name?: string;
	type?: string;
};

export type Directive =
	| {
			action: 'clone';
			cache?: boolean;
			src: string;
			verbose?: boolean;
	  }
	| {
			action: 'search_replace';
			files: string | string[];
			pattern: string;
			replacement: string;
	  }
	| {
			action: 'remove';
			files: string | string[];
	  };

export type CloneDirective = Extract<Directive, { action: 'clone' }>;
export type SearchReplaceDirective = Extract<Directive, { action: 'search_replace' }>;
export type RemoveDirective = Extract<Directive, { action: 'remove' }>;

export type Options = ConstructorOptions;
export type ValidModes = 'tar' | 'git';
export type Info = EventInfo;
export type Action = Directive;
export type DegitAction = CloneDirective;
export type RemoveAction = RemoveDirective;
