import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			all: true,
			include: ['src/**/*.ts'],
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
		include: ['test/**/*.test.ts'],
		testTimeout: 30000,
	},
});
