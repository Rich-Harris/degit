import { defineConfig } from 'vitest/config';

const excludePrivateIntegration =
	!process.env.SSH_PRIVATE_KEY || process.env.SSH_PRIVATE_KEY === ''
		? ['test/integration/private.test.ts']
		: undefined;

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
		exclude: excludePrivateIntegration,
		globals: true,
		include: ['test/**/*.test.ts'],
		testTimeout: 30000,
	},
});
