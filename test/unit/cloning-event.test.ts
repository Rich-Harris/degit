import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import degit from '../../src/index.js';
import type { ConstructorOptions, EventInfo } from '../../src/domain/types.js';
import { gitRefs, providerCases, refsHash } from './index-support.js';
import { createMockGit } from '../helpers.js';

const { suiteCache, suiteTmp } = vi.hoisted(() => ({
	suiteCache: '.tmp/cloning-event-suite-cache',
	suiteTmp: '.tmp/cloning-event-suite',
}));

vi.mock('../../src/shared/utils.js', async (importActual) => ({
	...(await importActual<typeof import('../../src/shared/utils.js')>()),
	base: path.join(process.cwd(), suiteCache),
}));

const test = providerCases[0];

async function cloneCapturingEvents(
	dest: string,
	options: ConstructorOptions,
): Promise<EventInfo[]> {
	const events: EventInfo[] = [];
	const emitter = degit(test.publicSrc, options);
	emitter.on('info', (event) => events.push(event));
	emitter.on('warn', (event) => events.push(event));
	await emitter.clone(dest);
	return events;
}

describe('cloning progress event', () => {
	beforeEach(() => fs.rmSync(suiteTmp, { force: true, recursive: true }));
	afterEach(() => fs.rmSync(suiteTmp, { force: true, recursive: true }));

	it('emits CLONING once before the fetch when cloning in git mode', async () => {
		const dest = `${suiteTmp}/git-mode`;
		const gitMock = createMockGit({
			[`fetchRefs ${test.url}`]: gitRefs,
			[`clone ${test.url} ${dest} ${refsHash}`]: '',
		});

		const events = await cloneCapturingEvents(dest, { git: gitMock.fn, mode: 'git' });

		const cloningEvents = events.filter((event) => event.code === 'CLONING');
		assert.equal(cloningEvents.length, 1);
		const message = cloningEvents[0].message;
		for (const part of ['cloning', `${test.user}/${test.name}`, 'HEAD', dest]) {
			assert.ok(message.includes(part), `start message missing "${part}": ${message}`);
		}
		const codes = events.map((event) => event.code);
		assert.ok(codes.indexOf('CLONING') < codes.indexOf('SUCCESS'));
	});

	it('emits CLONING exactly once when tar download falls back to git', async () => {
		const dest = `${suiteTmp}/fallback`;
		const gitMock = createMockGit({
			[`fetchRefs ${test.url}`]: gitRefs,
			[`clone ${test.url} ${dest} HEAD`]: '',
		});
		const fetch = () => Promise.reject(new Error('archive unavailable'));

		const events = await cloneCapturingEvents(dest, { fetch, git: gitMock.fn });

		assert.equal(events.filter((event) => event.code === 'CLONING').length, 1);
		assert.ok(events.some((event) => event.code === 'SUCCESS'));
	});
});
