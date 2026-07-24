import { readdirSync } from 'node:fs';
import path from 'node:path';

const ignoredDocDirs = new Set(['node_modules', '.git', 'dist', 'coverage', '.devin']);
const allowedDocs = new Set([
	'.github/PULL_REQUEST_TEMPLATE.md',
	'AGENTS.md',
	'LICENSE.md',
	'README.md',
	'assets/help.md',
	'docs/ARCHITECTURE.md',
	'docs/CHANGELOG.md',
	'docs/CODE_OF_CONDUCT.md',
	'docs/CONTRIBUTING.md',
	'docs/SECURITY.md',
]);
const docsAnchorFile = path.resolve('src/index.ts');
let docViolations;

function* walkDocs(dir, prefix = '') {
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const filePath = prefix ? `${prefix}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			if (!ignoredDocDirs.has(entry.name)) {
				yield* walkDocs(`${dir}/${entry.name}`, filePath);
			}
		} else {
			yield filePath;
		}
	}
}

function getDocViolations() {
	if (docViolations) {
		return docViolations;
	}

	const violations = [];
	for (const file of walkDocs('.')) {
		if (allowedDocs.has(file)) continue;
		if (file.endsWith('.md') || file.startsWith('docs/')) {
			violations.push(file);
		}
	}

	docViolations = violations;
	return violations;
}

const plugin = {
	meta: {
		name: 'oxlint-repo-guidelines',
	},
	rules: {
		'no-more-docs': {
			create(context) {
				const filename = path.resolve(context.physicalFilename ?? context.filename ?? '');
				if (filename !== docsAnchorFile) {
					return {};
				}

				return {
					Program(node) {
						const violations = getDocViolations();
						if (violations.length > 0) {
							context.report({
								message: `New docs/markdown files are not allowed: ${violations.join(', ')}`,
								node,
							});
						}
					},
				};
			},
		},
	},
};

export default plugin;
