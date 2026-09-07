import assert from 'node:assert';
import { startSpinner } from '../../src/shared/spinner.js';

function withIsTTY<T>(value: boolean, fn: () => T): T {
	const original = process.stdout.isTTY;
	Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
	try {
		return fn();
	} finally {
		Object.defineProperty(process.stdout, 'isTTY', {
			configurable: true,
			value: original,
		});
	}
}

describe('startSpinner', () => {
	it('returns null when stdout is not a TTY', () => {
		withIsTTY(false, () => {
			assert.equal(startSpinner(), null);
		});
	});

	it('starts, clears and stops cleanly when stdout is a TTY', () => {
		withIsTTY(true, () => {
			const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
			try {
				const spinner = startSpinner();
				assert.ok(spinner);
				spinner.clear();
				spinner.stop();
				spinner.stop();
				assert.ok(
					writeSpy.mock.calls.some((call) => String(call[0]).includes('\u001b[K')),
					'expected the spinner to erase its line',
				);
			} finally {
				writeSpy.mockRestore();
			}
		});
	});
});
