const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
	test: {
		coverage: {
			all: true,
			include: ['src/**/*.js'],
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			reportsDirectory: './coverage',
			thresholds: {
				autoUpdate: false,
				branches: 50,
				functions: 50,
				lines: 40,
				statements: 40,
			},
		},
		environment: 'node',
		globals: true,
		include: ['test/**/*.test.js'],
		testTimeout: 30000,
	},
});
