const testCallNames = new Set(['describe', 'it', 'test']);
const allowedTestModifiers = new Set(['concurrent', 'each', 'failing', 'only', 'skip', 'todo']);

function getTestCallName(node) {
	if (!node) {
		return null;
	}

	if (node.type === 'Identifier') {
		return testCallNames.has(node.name) ? node.name : null;
	}

	if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
		const objectName = getTestCallName(node.object);
		return objectName && allowedTestModifiers.has(node.property.name) ? objectName : null;
	}

	return null;
}

function normalizeFilename(context) {
	return String(context.filename ?? context.physicalFilename ?? '').replaceAll('\\', '/');
}

function hasWhen(titleNode, context) {
	return /\bwhen\b/iu.test(context.sourceCode.getText(titleNode));
}

const plugin = {
	meta: {
		name: 'oxlint-test-guidelines',
	},
	rules: {
		'file-name': {
			create(context) {
				let hasTestCalls = false;
				let programNode;
				const filename = normalizeFilename(context);

				return {
					CallExpression(node) {
						if (getTestCallName(node.callee)) {
							hasTestCalls = true;
						}
					},
					Program(node) {
						programNode = node;
					},
					'Program:exit'() {
						if (hasTestCalls && !filename.endsWith('.test.ts')) {
							context.report({
								message:
									'Test files with describe or test blocks must end with .test.ts',
								node: programNode,
							});
						}
					},
				};
			},
		},
		'one-describe-per-file': {
			create(context) {
				let describeCount = 0;
				let hasTestLikeCall = false;
				let programNode;

				return {
					CallExpression(node) {
						const callName = getTestCallName(node.callee);
						if (!callName) {
							return;
						}

						if (callName === 'describe') {
							describeCount++;
							return;
						}

						if (callName === 'it' || callName === 'test') {
							hasTestLikeCall = true;
						}
					},
					Program(node) {
						programNode = node;
					},
					'Program:exit'() {
						if ((describeCount > 0 || hasTestLikeCall) && describeCount !== 1) {
							context.report({
								message: 'Test files must contain exactly one describe block',
								node: programNode,
							});
						}
					},
				};
			},
		},
		'title-when': {
			create(context) {
				return {
					CallExpression(node) {
						const callName = getTestCallName(node.callee);
						if (callName !== 'it' && callName !== 'test') {
							return;
						}

						const titleNode = node.arguments[0];
						if (!titleNode || !hasWhen(titleNode, context)) {
							context.report({
								message: 'Test titles must include the word when',
								node: titleNode ?? node,
							});
						}
					},
				};
			},
		},
	},
};

export default plugin;
