import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/* eslint-disable security/detect-child-process, security/detect-non-literal-fs-filename */

const CODE = /^src\//u;
const DOCS_REQUIRED_TYPES = new Set(['feat', 'fix', 'perf', 'revert']);
const SKIP_ALL = '[skip-docs]';
const DOC_SETS = [
	{
		examples: 'docs/*.md, README.md, assets/help.md',
		name: 'human-facing',
		patterns: [/^docs\/.+\.md$/u, /^README\.md$/u, /^assets\/help\.md$/u],
		skip: '[skip-human-docs]',
	},
	{
		examples: 'AGENTS.md, llms.txt, skills/*/SKILL.md',
		name: 'agent-facing',
		patterns: [/^AGENTS\.md$/u, /^llms\.txt$/u, /^skills\/.+\/SKILL\.md$/u],
		skip: '[skip-agent-docs]',
	},
];

function evaluate(message, staged) {
	const firstLine = message.split('\n', 1)[0].trim();
	if (firstLine.startsWith('Merge ')) return [];
	const head = firstLine.slice(0, Math.max(firstLine.indexOf(':'), 0));
	const type = head.split('(')[0].replace(/!$/u, '').trim().toLowerCase();
	if (type !== '' && !DOCS_REQUIRED_TYPES.has(type)) return [];
	if (!staged.some((file) => CODE.test(file))) return [];
	const lower = message.toLowerCase();
	if (lower.includes(SKIP_ALL)) return [];
	return DOC_SETS.filter(
		(set) =>
			!lower.includes(set.skip) &&
			!staged.some((file) => set.patterns.some((pattern) => pattern.test(file))),
	);
}

if (process.argv[2] === '--self-check') {
	const cases = [
		['feat: x', ['src/a.ts', 'docs/USAGE.md', 'AGENTS.md'], 0],
		['feat: x', ['src/a.ts'], 2],
		['feat: x [skip-docs]', ['src/a.ts'], 0],
		['feat: x [skip-agent-docs]', ['src/a.ts', 'docs/USAGE.md'], 0],
		['feat: x [skip-human-docs]', ['src/a.ts', 'AGENTS.md'], 0],
		['feat: x [skip-agent-docs]', ['src/a.ts'], 1],
		['chore: x', ['src/a.ts'], 0],
		['feat: x', ['test/unit/a.test.ts'], 0],
		['Merge branch main', ['src/a.ts'], 0],
		['feat!: x', ['src/a.ts', 'docs/USAGE.md', 'skills/degit/SKILL.md'], 0],
		['fix(cli): x', ['src/a.ts', 'llms.txt'], 1],
	];
	for (const [message, staged, missing] of cases) {
		assert.strictEqual(evaluate(message, staged).length, missing, message);
	}
	console.log('verify-docs self-check ok');
	process.exit(0);
}

const message = fs.readFileSync(process.argv[2], 'utf8');
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
	.split('\n')
	.filter(Boolean);
const missing = evaluate(message, staged);

if (missing.length === 0) {
	process.exit(0);
}

console.error(
	`docs check failed: "${message.split('\n', 1)[0]}" changes src/ but no docs are staged for:`,
);
for (const set of missing) {
	console.error(`  ${set.name}: ${set.examples} (or use ${set.skip})`);
}
console.error(`skip both: ${SKIP_ALL} — or commit --no-verify`);
process.exit(1);
