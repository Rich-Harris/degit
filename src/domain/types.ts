import type { Repo } from './repo.js';

export type GitClient = {
	fetchRefs(repo: Repo): Promise<Ref[]>;
	clone(repo: Repo, dest: string, ref?: string, transport?: Repo['transport']): Promise<void>;
};

export const validModes = new Set(['tar', 'git']);

export type FetchFn = (url: string, dest: string, proxy?: string) => Promise<void>;

export type ConstructorOptions = {
	aliases?: Record<string, string>;
	cache?: boolean;
	fetch?: FetchFn;
	files?: string[];
	force?: boolean;
	git?: GitClient;
	mode?: 'tar' | 'git';
	verbose?: boolean;
};

export type InfoCode =
	| 'SUCCESS'
	| 'FILE_DOES_NOT_EXIST'
	| 'FILE_OUTSIDE_DEST'
	| 'NO_FILES_MATCHED'
	| 'REMOVED'
	| 'DEST_NOT_EMPTY'
	| 'DEST_IS_EMPTY'
	| 'USING_CACHE'
	| 'FOUND_MATCH'
	| 'FILE_EXISTS'
	| 'PROXY'
	| 'DOWNLOADING'
	| 'EXTRACTING'
	| 'GLOB_NOT_ALLOWED';

export type DegitErrorCode =
	| 'DEST_NOT_EMPTY'
	| 'MISSING_REF'
	| 'COULD_NOT_DOWNLOAD'
	| 'BAD_SRC'
	| 'UNSUPPORTED_HOST'
	| 'BAD_REF'
	| 'COULD_NOT_FETCH'
	| 'MISSING_SUBDIR'
	| 'MISSING_SRC'
	| 'BAD_DIRECTIVES'
	| 'MISSING_DEST'
	| 'ENOTDIR'
	| 'COULD_NOT_STAT'
	| 'COULD_NOT_RESTORE';

export type EventInfo = {
	code?: InfoCode | DegitErrorCode;
	dest?: string;
	message: string;
	repo?: Repo;
	url?: string;
	original?: unknown;
	recoveryPath?: string;
	ref?: string;
	subdir?: string;
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
			files?: string | string[];
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
			allowGlobs?: boolean;
	  };

export type CloneDirective = Extract<Directive, { action: 'clone' }>;
export type SearchReplaceDirective = Extract<Directive, { action: 'search_replace' }>;
export type RemoveDirective = Extract<Directive, { action: 'remove' }>;

export type DegitAction = CloneDirective;
export type RemoveAction = RemoveDirective;

export type Options = ConstructorOptions;
export type ValidModes = 'tar' | 'git';
export type Info = EventInfo;
export type Action = Directive;
