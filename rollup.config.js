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
		name: '[name].js',
		format: 'cjs',
		sourcemap: true
	},
	external: Object.keys(pkg.dependencies || {}).concat(builtinModules),
	plugins: [resolve(), commonjs()]
};
