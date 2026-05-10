import { builtinModules } from 'module';
import { defineConfig } from 'tsdown';
import pkg from './package.json';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		bin: 'src/bin.ts'
	},
	outDir: 'dist',
	format: 'cjs',
	sourcemap: true,
	fixedExtension: false,
	external: [
		...Object.keys(pkg.dependencies || {}),
		...Object.keys(pkg.devDependencies || {}),
		...builtinModules
	]
});
