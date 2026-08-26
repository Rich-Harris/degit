import { Degit } from './core/orchestrator.js';
import type { ConstructorOptions } from './domain/types.js';

export type {
	Action,
	CloneDirective,
	DegitAction,
	DegitErrorCode,
	FetchFn,
	Info,
	InfoCode,
	Options,
	RemoveAction,
	RemoveDirective,
	SearchReplaceDirective,
	ValidModes,
} from './domain/types.js';

export default function degit(src?: string, opts: ConstructorOptions = {}) {
	return new Degit(src, opts);
}
