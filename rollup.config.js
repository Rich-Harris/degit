import commonjs from 'rollup-plugin-commonjs';
import typescript from 'rollup-plugin-typescript';
import pkg from './package.json';

export default [
	/* index.js */
	{
		input: 'src/index.js',
		output: {
			file: 'index.js',
			format: 'cjs',
			sourcemap: true
		},
		external: Object.keys(pkg.dependencies).concat(['fs', 'path', 'os']),
		plugins: [
			// commonjs()
		]
	},

	/* bin.js */
	{
		input: 'src/bin.js',
		output: {
			file: 'bin.js',
			format: 'cjs',
			banner: '#!/usr/bin/env node',
			paths: {
				degit: './index.js'
			},
			sourcemap: true
		},
		external: Object.keys(pkg.dependencies).concat(['fs', 'path', 'os'])
	}
];
