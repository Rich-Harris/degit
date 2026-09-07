import colors from 'yoctocolors';

const frames = [
	'\u280b',
	'\u2819',
	'\u2839',
	'\u2838',
	'\u283c',
	'\u2834',
	'\u2826',
	'\u2827',
	'\u2807',
	'\u280f',
];

export function startSpinner() {
	if (!process.stdout.isTTY) {
		return null;
	}

	let spinning = true;
	let index = 0;
	const timer = setInterval(() => {
		if (!spinning) {
			return;
		}
		process.stdout.write(`\r${colors.cyan(frames[index++ % frames.length])}`);
	}, 80);
	timer.unref();

	return {
		clear: () => {
			if (spinning) {
				process.stdout.write('\r\u001b[K');
			}
		},
		stop: () => {
			if (!spinning) {
				return;
			}
			spinning = false;
			clearInterval(timer);
			process.stdout.write('\r\u001b[K');
		},
	};
}
