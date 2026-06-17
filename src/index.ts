import { Degit } from './degit-core.js';
import type { ConstructorOptions } from './degit-types.js';

export type {
	Action,
	DegitAction,
	DegitErrorCode,
	FetchFn,
	Info,
	InfoCode,
	Options,
	RemoveAction,
	ValidModes,
} from './degit-types.js';

export default function degit(src: string, opts: ConstructorOptions = {}) {
	return new Degit(src, opts);
}
