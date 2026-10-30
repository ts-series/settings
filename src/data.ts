// AUXILIARY DATA TYPES AND FUNCTIONS

export type SettingValue =
	| string
	| number
	| boolean
	| null
	| SettingValue[]
	| Settings
	| Tagged;


export interface Settings {
	[key: string]: SettingValue;
}


export type CaseTransformer = ((key: string) => string) | null;


export type ToCaseOption =
	| CaseTransformer
	| (Record<string, CaseTransformer> & { "*"?: (key: string) => string });


export class Tagged {
	/** Creates a value carrying the given tag. */
	constructor(
		readonly tag: string,
		readonly value: SettingValue,
	) {}
}


/** Type guard: true for plain objects, excluding arrays and class instances such as Tagged. */
export function isPlainObject(v: unknown): v is Settings {
	const proto = typeof v === "object" && v !== null ? Object.getPrototypeOf(v) : undefined;
	return proto === Object.prototype || proto === null;
}


// KEY TRANSFORMATION

/** Returns the key unchanged. */
const identity = (key: string): string => key;


/** Resolves the case transformer applicable to a given top-level section. */
function resolveToCase(toCase: ToCaseOption | undefined, section: string): (key: string) => string {
	if (toCase == null) {
		return identity;
	}
	else if (typeof toCase === "function") {
		return toCase;
	}
	else {
		const fn = toCase[section];
		return fn === null ? identity : fn ?? toCase["*"] ?? identity;
	}
}


/** Renames every key via keyFn except the default key "_", recursing into nested maps and tagged values. */
function renameKeys(obj: Settings, keyFn: (k: string) => string): Settings {
	const result: Settings = {};
	for (const [k, v] of Object.entries(obj)) {
		const inner = v instanceof Tagged ? v.value : v;
		const renamed = isPlainObject(inner) ? renameKeys(inner, keyFn) : inner;
		result[k === "_" ? k : keyFn(k)] = v instanceof Tagged ? new Tagged(v.tag, renamed) : renamed;
	}
	return result;
}


/** Applies a case transformer to all keys below each top-level section, recursing into nested maps. */
export function transformKeys(settings: Settings, toCase: ToCaseOption): Settings {
	const result: Settings = {};
	for (const [section, entries] of Object.entries(settings)) {
		result[section] = isPlainObject(entries) ? renameKeys(entries, resolveToCase(toCase, section)) : entries;
	}
	return result;
}
