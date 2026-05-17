const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
	test: {
		globals: true,
		environment: 'node',
		testTimeout: 30000,
		include: ['test/**/*.test.js'],
		coverage: {
			provider: 'v8',
			reportsDirectory: './coverage',
			reporter: ['text', 'json-summary', 'html'],
			all: true,
			include: ['src/**/*.js'],
			thresholds: {
				autoUpdate: false,
				lines: 40,
				branches: 50,
				functions: 50,
				statements: 40
			},
		}
	}
});
