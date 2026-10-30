/*

1  AUXILIARY DATA TYPES FOR TRANSLATIONS
2  TRANSLATION LOADING
3  MESSAGE FUNCTION FACTORIES
4  INTERNALS

*/

import {
	isPlainObject,
	Tagged,
	transformKeys,
	type Settings,
	type SettingValue,
	type ToCaseOption
} from "./data.ts";

import { readRaw } from "./settings.ts";


// 1  AUXILIARY DATA TYPES FOR TRANSLATIONS

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export type PluralAdapter = (n: number) => PluralCategory;


export type MessageArgs = Record<string, string | number>;

export type MessageFn
	= (...args: any[]) => string;


export type InterpolationFn
	= (first?: MessageArgs | string | number, ...rest: (string | number)[]) => string;

export type PluralFn
	= (n: number, args?: MessageArgs) => string;


export type SelectForm = string | MessageFn;

export type PluralForms = Partial<Record<PluralCategory, string>> & Record<string, string>;

export type BoolForms = { true: SelectForm; false: SelectForm };


type RestArgs<F>
	= F extends (...args: infer A) => string ? A : [args?: MessageArgs];


export type SelectFn<F extends Record<string, SelectForm> = Record<string, SelectForm>>
	= <K extends keyof F & string>(key: K, ...rest: RestArgs<F[K]>) => string;

export type BoolFn<F extends BoolForms = BoolForms>
	= (value: boolean, ...rest: RestArgs<F["true"] | F["false"]>) => string;


export type TranslationValue =
	| string
	| string[]
	| MessageFn
	| Translations;


export interface Translations {
	[key: string]: TranslationValue;
}


export interface TranslationOptions<Lang extends string> {
	readFile: (path: string) => Promise<string>;
	readDir: (path: string) => AsyncIterable<{ name: string; isDirectory: boolean }>;
	dir: string;
	langs: readonly Lang[];
	referenceLang: Lang;
	keyLang?: Lang;
	fallback?: Lang | null;
	placeholder?: string;
	deriveValue?: (key: string) => string;
	toCase?: ToCaseOption;
	selections?: Record<string, readonly string[]>;
	pluralAdapters?: Partial<Record<Lang, PluralAdapter>>;
	pluralOrder?: Partial<Record<Lang, readonly PluralCategory[]>>;
	ordinalOrder?: Partial<Record<Lang, readonly PluralCategory[]>>;
}


interface Rules {
	lang: string;
	plural: PluralAdapter;
	ordinal: PluralAdapter;
	pluralOrder?: readonly PluralCategory[];
	ordinalOrder?: readonly PluralCategory[];
	selections: Record<string, readonly string[]>;
	tags: ReadonlySet<string>;
}


// 2  TRANSLATION LOADING

/**
 * Builds the default CLDR-backed plural adapter for a language.
 * @param lang Language tag.
 * @param type Cardinal for counts, ordinal for rankings.
 * @returns A function mapping a number to its plural category.
 */
export function defaultPluralAdapter(lang: string, type: Intl.PluralRuleType = "cardinal"): PluralAdapter {
	const rules = new Intl.PluralRules(lang, { type });
	return n => rules.select(n) as PluralCategory;
}


/**
 * Loads YAML translation files from a directory tree, completes missing values from the reference language and returns one nested object per language.
 * Tagged values become functions: !plural and !ordinal select by number, !bool by boolean and every declared selection by key.
 * Forms of !bool and declared selections may be tagged themselves, so the arguments of the call follow the nesting from outside to inside.
 * @param options Directories, languages, fallback rules, custom selections and plural settings.
 * @returns One translation tree per language.
 */
export async function loadTranslations<Lang extends string, T extends Translations = Translations>(
	options: TranslationOptions<Lang>,
): Promise<Record<Lang, T>> {
	const keyLang = options.keyLang ?? "en" as Lang;
	const fallback = options.fallback === undefined ? keyLang : options.fallback;
	const derive = options.deriveValue ?? (s => s);
	const placeholder = options.placeholder ?? "<?>";
	const selections = options.selections ?? {};
	const tags = new Set(["plural", "ordinal", "bool", ...Object.keys(selections)]);
	const loaded = {} as Record<Lang, Settings>;

	for (const lang of options.langs) {
		loaded[lang] = await readRaw(options.readFile, options.readDir, `${options.dir}${lang}`, false, true);
	}

	const order = [...options.langs].sort((a, b) => Number(b === keyLang) - Number(a === keyLang));
	for (const lang of order) {
		if (lang !== options.referenceLang) {
			complete(
				loaded[options.referenceLang],
				loaded[lang],
				fallback === null ? undefined : loaded[fallback],
				"",
				(leaf, fbValue) => lang === keyLang ? derive(leaf) : fallback === null ? placeholder : fbValue ?? derive(leaf),
			);
		}
	}

	const result = {} as Record<Lang, T>;
	for (const lang of options.langs) {
		const rules: Rules = {
			lang,
			plural: options.pluralAdapters?.[lang] ?? defaultPluralAdapter(lang),
			ordinal: defaultPluralAdapter(lang, "ordinal"),
			pluralOrder: options.pluralOrder?.[lang],
			ordinalOrder: options.ordinalOrder?.[lang],
			selections,
			tags,
		};
		const built = build(loaded[lang], rules);
		result[lang] = (options.toCase ? transformKeys(built as unknown as Settings, options.toCase) : built) as unknown as T;
	}
	return result;
}


// 3  MESSAGE FUNCTION FACTORIES

type Placeholders<S extends string>
	= S extends `${string}{${infer K}}${infer Rest}` ? K | Placeholders<Rest> : never;


export type Interpolation<S extends string, K extends string = Placeholders<S>>
	= [Extract<K, `${number}`>] extends [never]
		? { (args: Record<K, string | number>): string; (...args: (string | number)[]): string }
		: (...args: (string | number)[]) => string;


/**
 * Creates a typed translation function whose placeholders are derived from the template literal.
 * @param template Text with {name} or {1} placeholders.
 * @returns A function substituting the placeholders.
 */
export function interpolation<const S extends string>(template: S): Interpolation<S> {
	return makeInterpolation(template) as unknown as Interpolation<S>;
}


/**
 * Creates a plural translation function for the given language from category forms.
 * @param lang Language tag used for the CLDR plural rules.
 * @param forms Texts by plural category or exact number, {n} stands for the count.
 * @returns A function selecting the form for a count.
 */
export function plural(lang: string, forms: PluralForms): PluralFn {
	return makePlural(forms, defaultPluralAdapter(lang));
}


/**
 * Creates an ordinal translation function for the given language from category forms.
 * @param lang Language tag used for the CLDR ordinal rules.
 * @param forms Texts by plural category or exact number, {n} stands for the rank.
 * @returns A function selecting the form for a rank.
 */
export function ordinal(lang: string, forms: PluralForms): PluralFn {
	return makePlural(forms, defaultPluralAdapter(lang, "ordinal"));
}


/**
 * Creates a selection function that picks a form by key; an unknown key is not handled and fails.
 * @param forms Texts with {name} placeholders or message functions by key.
 * @returns A function taking a key followed by the arguments of the chosen form.
 */
export function select<const F extends Record<string, SelectForm>>(forms: F): SelectFn<F> {
	return ((key: string, ...rest: unknown[]) => dispatch(forms[key], rest)) as SelectFn<F>;
}


/**
 * Creates a function that picks a form by a boolean.
 * @param forms Texts with {name} placeholders or message functions for true and false.
 * @returns A function taking a boolean followed by the arguments of the chosen form.
 */
export function bool<const F extends BoolForms>(forms: F): BoolFn<F> {
	return ((value: boolean, ...rest: unknown[]) => dispatch(value ? forms.true : forms.false, rest)) as BoolFn<F>;
}


// 4  INTERNALS

/** Fills leaves missing in target from the reference structure, treating tagged values as leaves and using the parent key for "_". */
function complete(
	ref: Settings,
	target: Settings,
	fb: Settings | undefined,
	parent: string,
	missing: (leaf: string, fbValue: SettingValue | undefined) => SettingValue,
): void {
	for (const [key, value] of Object.entries(ref)) {
		if (isPlainObject(value)) {
			const existing = target[key];
			const next = isPlainObject(existing) ? existing : {};
			const fbSub = fb?.[key];
			target[key] = next;
			complete(value, next, isPlainObject(fbSub) ? fbSub : undefined, key, missing);
		}
		else if (target[key] === undefined) {
			target[key] = missing(key === "_" ? parent : key, fb?.[key]);
		}
	}
}


/** Converts a completed Settings tree into nested translation values, ignoring tags without a known meaning. */
function build(node: Settings, rules: Rules): Translations {
	const result: Translations = {};
	for (const [key, entry] of Object.entries(node)) {
		const value = entry instanceof Tagged && !rules.tags.has(entry.tag) ? entry.value : entry;
		if (isPlainObject(value)) {
			result[key] = build(value, rules);
		}
		else if (Array.isArray(value)) {
			result[key] = value.filter((v): v is string => typeof v === "string");
		}
		else {
			result[key] = interpret(value, rules, key);
		}
	}
	return result;
}


/** Converts one leaf into a string, interpolation, plural, ordinal, boolean or selection function based on its tag. */
function interpret(value: SettingValue, rules: Rules, key: string): TranslationValue {
	if (!(value instanceof Tagged)) {
		const text = String(value);
		return text.includes("{") ? makeInterpolation(text) : text;
	}
	else if (value.tag === "plural") {
		return makePlural(toTexts(toEntries(value.value, rules.pluralOrder, false, rules.lang, key), rules.lang, key), rules.plural);
	}
	else if (value.tag === "ordinal") {
		return makePlural(toTexts(toEntries(value.value, rules.ordinalOrder, false, rules.lang, key), rules.lang, key), rules.ordinal);
	}
	else if (value.tag === "bool") {
		return bool(toMessages(toEntries(value.value, ["true", "false"], true, rules.lang, key), rules, key) as BoolForms);
	}
	else {
		return select(toMessages(toEntries(value.value, rules.selections[value.tag], true, rules.lang, key), rules, key));
	}
}


/** Resolves the entries of a tagged value from a string, a shorthand list or a map, rejecting keys outside the order when it is closed. */
function toEntries(
	value: SettingValue,
	order: readonly string[] | undefined,
	closed: boolean,
	lang: string,
	key: string,
): Record<string, string | Tagged> {
	if (typeof value === "string" && !closed) {
		return { other: value };
	}
	else if (Array.isArray(value)) {
		const cats = resolveOrder(value.length, order, lang, key);
		return Object.fromEntries(value.flatMap((v, i) => typeof v === "string" || v instanceof Tagged ? [[cats[i], v] as [string, string | Tagged]] : []));
	}
	else if (isPlainObject(value)) {
		const entries = Object.fromEntries(Object.entries(value).filter((e): e is [string, string | Tagged] => typeof e[1] === "string" || e[1] instanceof Tagged));
		const unknown = closed ? Object.keys(entries).filter(k => !order?.includes(k)) : [];
		if (unknown.length > 0) {
			throw new Error(`"${key}" in "${lang}" has unknown keys: ${unknown.join(", ")}`);
		}
		else {
			return entries;
		}
	}
	else {
		throw new Error(`"${key}" in "${lang}" must be a list or a map`);
	}
}


/** Reduces entries to plain texts, because plural and ordinal forms cannot contain tagged values. */
function toTexts(entries: Record<string, string | Tagged>, lang: string, key: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(entries)) {
		if (typeof v === "string") {
			result[k] = v;
		}
		else {
			throw new Error(`"${key}.${k}" in "${lang}" must be text, plural and ordinal forms cannot be tagged`);
		}
	}
	return result;
}


/** Converts entries into texts or message functions, building tagged forms recursively and unwrapping tags without a known meaning. */
function toMessages(entries: Record<string, string | Tagged>, rules: Rules, key: string): Record<string, SelectForm> {
	const result: Record<string, SelectForm> = {};
	for (const [k, v] of Object.entries(entries)) {
		const inner = v instanceof Tagged && !rules.tags.has(v.tag) ? v.value : v;
		if (inner instanceof Tagged) {
			result[k] = interpret(inner, rules, `${key}.${k}`) as MessageFn;
		}
		else if (typeof inner === "string") {
			result[k] = inner;
		}
		else {
			throw new Error(`"${key}.${k}" in "${rules.lang}" must be text or a tagged value`);
		}
	}
	return result;
}


/** Picks the key order of a shorthand: custom order, n=2 → [one,other], n=3 → [zero,one,other], else error. */
function resolveOrder(
	n: number,
	custom: readonly string[] | undefined,
	lang: string,
	key: string,
): readonly string[] {
	if (custom) {
		if (custom.length !== n) {
			throw new Error(`Shorthand "${key}" in "${lang}" has ${n} forms, the order specifies ${custom.length}`);
		}
		return custom;
	}
	else if (n === 2) {
		return ["one", "other"];
	}
	else if (n === 3) {
		return ["zero", "one", "other"];
	}
	else {
		throw new Error(`Shorthand "${key}" in "${lang}" has ${n} forms; specify an order for this language`);
	}
}


/** Applies a chosen form to the remaining call arguments: a text takes the placeholder values, a message function takes all of them. */
function dispatch(form: SelectForm, rest: unknown[]): string {
	return typeof form === "function" ? form(...rest) : substitute(form, rest[0] as MessageArgs | undefined);
}


/** Replaces {name} placeholders from args and {n} from the given count, leaving unresolved ones in place. */
function substitute(text: string, args: MessageArgs | undefined, n?: number): string {
	return text.replace(/\{(\w+)\}/g, (_, k) => String(args?.[k] ?? (k === "n" && n !== undefined ? n : `{${k}}`)));
}


/** Wraps a template into a function substituting {name} from an object arg, or {1}, {2}, ... and named placeholders from positional args. */
function makeInterpolation(template: string): InterpolationFn {
	const keys = [...new Set(Array.from(template.matchAll(/\{(\w+)\}/g), m => m[1]))];
	let next = Math.max(0, ...keys.filter(k => /^\d+$/.test(k)).map(Number));
	const positions = new Map(keys.map(k => [k, /^\d+$/.test(k) ? Number(k) : ++next] as [string, number]));

	return (first, ...rest) => {
		if (isPlainObject(first)) {
			return template.replace(/\{(\w+)\}/g, (_, k) => String(first[k] ?? `{${k}}`));
		}
		else {
			const positional = first === undefined ? [] : [first, ...rest];
			return template.replace(/\{(\w+)\}/g, (_, k) => String(positional[positions.get(k)! - 1] ?? `{${k}}`));
		}
	};
}


/** Wraps a category-to-string map into a plural-dispatch function; exact-number keys take priority over CLDR categories, {n} is the count and other placeholders come from args. */
function makePlural(forms: PluralForms, adapter: PluralAdapter): PluralFn {
	return (n, args) => {
		const form = forms[n] ?? (n === 0 ? forms.zero : undefined) ?? forms[adapter(n)] ?? forms.other ?? "";
		return substitute(form, args, n);
	};
}
