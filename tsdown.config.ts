import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		bin: 'src/bin.ts',
		index: 'src/index.ts',
	},
	dts: true,
	format: ['esm'],
	outDir: 'dist',
	outExtensions: () => ({
		js: '.js',
	}),
	platform: 'node',
	sourcemap: true,
	target: 'node20',
});
