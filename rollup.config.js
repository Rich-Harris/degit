import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { builtinModules } from 'module';
import pkg from './package.json';

export default {
	input: {
		index: 'src/index.js',
		bin: 'src/bin.js'
	},
	output: {
		dir: 'dist',
		entryFileNames: '[name].js',
		chunkFileNames: '[name]-[hash].js',
		format: 'cjs',
		exports: 'auto',
		sourcemap: true
	},
	external: Object.keys(pkg.dependencies || {}).concat(builtinModules),
	plugins: [resolve(), commonjs()]
};
