declare module 'sander' {
	export function rimrafSync(path: string): void;
	export function copydirSync(path: string): { to: (toPath: string) => void };
}

declare module 'tiny-glob/sync.js' {
	const glob: (pattern: string, options?: { cwd?: string }) => string[];
	export default glob;
}
