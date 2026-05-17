import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { builtinModules } from 'node:module';
import pkg from './package.json';

export default {
	external: Object.keys(pkg.dependencies || {}).concat(builtinModules),
	input: {
		bin: 'src/bin.js',
		index: 'src/index.js',
	},
	output: {
		chunkFileNames: '[name]-[hash].js',
		dir: 'dist',
		entryFileNames: '[name].js',
		exports: 'auto',
		format: 'cjs',
		sourcemap: true,
	},
	plugins: [resolve(), commonjs()],
};
