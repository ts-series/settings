/*

1  CASE FUNCTIONS
2  TYPES AND CONSTANTS
3  FILE ACCESS
4  NORMALIZATION AND MERGING
5  CODE RENDERING
6  MODULE GENERATION
7  BUILD AND WATCH
8  ENTRY POINT

*/

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { watch as watchFs } from "node:fs/promises";
import { basename } from "node:path";
import { argv, exit } from "node:process";
import { parseArgs } from "node:util";

import { toCamelCase, toId, toIdCapitalized, toPascalCase, toSentenceCase, toSnakeCase, toTitleCase } from "@ts-series/case";

import { isPlainObject, Tagged, type Settings, type SettingValue } from "./data.ts";
import { readRaw } from "./settings.ts";
import { yamlPattern } from "./yaml.ts";


// 1  CASE FUNCTIONS

type CaseName = "camel" | "Pascal" | "id" | "Id" | "Title" | "Sentence" | "snake";


const caseFunctions: Record<CaseName, (str: string) => string> = {
	camel: toCamelCase,
	Pascal: toPascalCase,
	id: toId,
	Id: toIdCapitalized,
	Title: toTitleCase,
	Sentence: toSentenceCase,
	snake: toSnakeCase,
};


// 2  TYPES AND CONSTANTS

type KeyCase = CaseName | null;

type Issue = { level: "error" | "missing"; message: string };

type Entry = string | Tagged;

type Leaf = (value: SettingValue, key: string) => string;

interface DirEntry {
	name: string;
	isFile: boolean;
	isDirectory: boolean;
}

interface Config {
	refLang?: string;
	keyLang?: string;
	import?: string;
	outDir?: string;
	keyCase?: KeyCase | Record<string, KeyCase>;
	constCase?: KeyCase;
	deriveMode?: KeyCase;
	selections?: Record<string, string[]>;
	pluralOrder?: Record<string, string[]>;
	ordinalOrder?: Record<string, string[]>;
}

interface Output {
	file: string;
	id: string;
	text: string;
}

interface MergeContext {
	lang: string;
	isKeyLang: boolean;
	mode: KeyCase;
	issues: Issue[];
}

interface RenderContext {
	lang: string;
	config: Config;
	tags: ReadonlySet<string>;
	used: Set<string>;
}


const langPattern = /^[a-z]{2}([_-][A-Z]{2})?$/;

const identifierPattern = /^[A-Za-z_$][\w$]*$/;

const watchDelay = 5000;

const builtinTags = ["plural", "ordinal", "bool"];


// 3  FILE ACCESS

/** Lists a directory in alphabetical order for reproducible output. */
async function* readDirSorted(dir: string): AsyncIterable<DirEntry> {
	const entries = await readdir(dir, { withFileTypes: true });

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		yield { name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() };
	}
}


/** Reads a text file as UTF-8. */
function readText(path: string): Promise<string> {
	return readFile(path, "utf8");
}


/** Reads a text file and returns null when it does not exist. */
async function readTextIfExists(path: string): Promise<string | null> {
	try {
		return await readText(path);
	}
	catch (e) {
		if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		else {
			throw e;
		}
	}
}


/** Reads sgen.json from the directory and requires its outDir. */
async function readConfig(dir: string): Promise<Config> {
	const text = await readTextIfExists(`${dir}/sgen.json`);
	const config: Config = text === null ? {} : JSON.parse(text);

	if (config.outDir === undefined) {
		throw new Error(`Set "outDir" in ${dir}/sgen.json`);
	}
	else {
		return config;
	}
}


// 4  NORMALIZATION AND MERGING

/** Applies a named case function, or returns the text unchanged for null. */
function applyCase(text: string, mode: KeyCase | undefined): string {
	return mode ? caseFunctions[mode](text) : text;
}


/** Resolves the key case for a top-level name from a single value or a table with "*" as default. */
function sectionCase(option: Config["keyCase"], name: string): KeyCase {
	if (typeof option === "object" && option !== null) {
		return Object.hasOwn(option, name) ? option[name] : option["*"] ?? null;
	}
	else {
		return option ?? null;
	}
}


/** Returns the sorted named placeholders of a template as one comparable string. */
function placeholders(text: string): string {
	return [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), m => m[1]))].filter(p => !/^\d+$/.test(p)).sort().join(",");
}


/** Renames all keys below the top-level sections with the key case, drops tags without a known meaning and reports collisions. */
function normalize(tree: Settings, keyCase: Config["keyCase"], lang: string, issues: Issue[], tags: ReadonlySet<string>): Settings {
	const data: Settings = {};

	/** Renames the keys of one subtree and unwraps tagged values whose tag is unknown. */
	function rename(node: Settings, mode: KeyCase, path: string): Settings {
		const result: Settings = {};

		for (const [key, value] of Object.entries(node)) {
			const name = key === "_" ? key : applyCase(key, mode);
			const entry = value instanceof Tagged && !tags.has(value.tag) ? value.value : value;

			if (Object.hasOwn(result, name)) {
				issues.push({ level: "error", message: `${lang}: "${path}.${key}" collides with another key as "${name}"` });
			}
			else {
				result[name] = isPlainObject(entry) ? rename(entry, mode, `${path}.${key}`) : entry;
			}
		}
		return result;
	}

	for (const [section, value] of Object.entries(tree)) {
		data[section] = isPlainObject(value) ? rename(value, sectionCase(keyCase, section), section) : value;
	}
	return data;
}


/** Fills leaves missing in target from the reference, derives or falls back values, and records extra keys, structural mismatches, tag differences and placeholder differences. */
function merge(
	ref: Settings,
	target: Settings,
	fb: Settings | undefined,
	ctx: MergeContext,
	path: string,
	parent: string,
): void {
	for (const key of Object.keys(target)) {
		if (!Object.hasOwn(ref, key)) {
			ctx.issues.push({ level: "error", message: `${ctx.lang}: extra "${path ? `${path}.${key}` : key}"` });
		}
	}

	for (const [key, value] of Object.entries(ref)) {
		const child = path ? `${path}.${key}` : key;
		const other = target[key];
		const nested = isPlainObject(value);

		if (nested && (other === undefined || isPlainObject(other))) {
			const sub: Settings = isPlainObject(other) ? other : {};
			const fbSub = fb?.[key];

			target[key] = sub;
			merge(value, sub, isPlainObject(fbSub) ? fbSub : undefined, ctx, child, key);
		}
		else if (other === undefined) {
			const fbValue = fb?.[key];

			target[key] = ctx.isKeyLang || fbValue === undefined ? applyCase(key === "_" ? parent : key, ctx.mode) : fbValue;
			if (!ctx.isKeyLang) {
				ctx.issues.push({ level: "missing", message: `${ctx.lang}: missing "${child}"` });
			}
		}
		else if (nested || isPlainObject(other)) {
			ctx.issues.push({ level: "error", message: `${ctx.lang}: "${child}" differs in structure from the reference` });
		}
		else if ((value instanceof Tagged ? value.tag : null) !== (other instanceof Tagged ? other.tag : null)) {
			ctx.issues.push({ level: "error", message: `${ctx.lang}: "${child}" differs in tag from the reference` });
		}
		else if (typeof value === "string" && typeof other === "string" && placeholders(value) !== placeholders(other)) {
			ctx.issues.push({ level: "error", message: `${ctx.lang}: "${child}" has different placeholders than the reference` });
		}
	}
}


// 5  CODE RENDERING

/** Renders an object key as a bare identifier or a quoted string. */
function propertyName(key: string): string {
	return identifierPattern.test(key) ? key : JSON.stringify(key);
}


/** Picks the key order of a shorthand list: custom order, n=2 → [one,other], n=3 → [zero,one,other], else error. */
function resolveOrder(n: number, custom: readonly string[] | undefined, lang: string, key: string): readonly string[] {
	if (custom) {
		if (custom.length !== n) {
			throw new Error(`Shorthand "${key}" in "${lang}" has ${n} forms, the order specifies ${custom.length}`);
		}
		else {
			return custom;
		}
	}
	else if (n === 2) {
		return ["one", "other"];
	}
	else if (n === 3) {
		return ["zero", "one", "other"];
	}
	else {
		throw new Error(`Shorthand "${key}" in "${lang}" has ${n} forms; set an order with ${n} entries for this language`);
	}
}


/** Resolves the entries of a tagged value from a string, a shorthand list or a map, rejecting keys outside a closed order. */
function resolveEntries(value: SettingValue, order: readonly string[] | undefined, closed: boolean, lang: string, key: string): Record<string, Entry> {
	if (typeof value === "string" && !closed) {
		return { other: value };
	}
	else if (Array.isArray(value)) {
		const cats = resolveOrder(value.length, order, lang, key);

		return Object.fromEntries(value.flatMap((v, i) => typeof v === "string" || v instanceof Tagged ? [[cats[i], v] as [string, Entry]] : []));
	}
	else if (isPlainObject(value)) {
		const entries = Object.fromEntries(Object.entries(value).filter((e): e is [string, Entry] => typeof e[1] === "string" || e[1] instanceof Tagged));
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


/** Renders one form of a tagged value as a string literal or, where nesting is allowed, as a nested factory call. */
function renderForm(entry: Entry, key: string, textOnly: boolean, ctx: RenderContext): string {
	const inner = entry instanceof Tagged && !ctx.tags.has(entry.tag) ? entry.value : entry;

	if (typeof inner === "string") {
		return JSON.stringify(inner);
	}
	else if (inner instanceof Tagged && !textOnly) {
		return renderTranslation(inner, key, ctx);
	}
	else {
		throw new Error(`"${key}" in "${ctx.lang}" must be text${textOnly ? ", plural and ordinal forms cannot be tagged" : " or a tagged value"}`);
	}
}


/** Renders a translation leaf as a string literal, interpolation call, list or factory call for its tag, and records the factories in use. */
function renderTranslation(value: SettingValue, key: string, ctx: RenderContext): string {
	if (value instanceof Tagged && !ctx.tags.has(value.tag)) {
		return renderTranslation(value.value, key, ctx);
	}
	else if (value instanceof Tagged) {
		const tag = value.tag;
		const counted = tag === "plural" || tag === "ordinal";
		const order = tag === "plural"
			? ctx.config.pluralOrder?.[ctx.lang]
			: tag === "ordinal"
				? ctx.config.ordinalOrder?.[ctx.lang]
				: tag === "bool" ? ["true", "false"] : ctx.config.selections?.[tag];
		const entries = resolveEntries(value.value, order, !counted, ctx.lang, key);
		const forms = Object.entries(entries).map(([k, v]) => `${propertyName(k)}: ${renderForm(v, `${key}.${k}`, counted, ctx)}`);
		const factory = builtinTags.includes(tag) ? tag : "select";

		ctx.used.add(factory);
		return `${factory}(${counted ? `${JSON.stringify(ctx.lang)}, ` : ""}{ ${forms.join(", ")} })`;
	}
	else if (Array.isArray(value)) {
		return JSON.stringify(value.filter(v => typeof v === "string"));
	}
	else if (typeof value === "string" && value.includes("{")) {
		ctx.used.add("interpolation");
		return `interpolation(${JSON.stringify(value)})`;
	}
	else {
		return JSON.stringify(String(value));
	}
}


/** Renders a normalized subtree as an object literal, treating tagged values as leaves. */
function renderTree(node: Settings, leaf: Leaf, depth: number): string {
	const pad = "\t".repeat(depth + 1);
	const lines = Object.entries(node).map(([key, value]) => {
		const rendered = isPlainObject(value) ? renderTree(value, leaf, depth + 1) : leaf(value, key);

		return `${pad}${propertyName(key)}: ${rendered},`;
	});

	return lines.length > 0 ? `{\n${lines.join("\n")}\n${"\t".repeat(depth)}}` : "{}";
}


/** Renders the import line for the factories a module uses, or nothing when it uses none. */
function renderImports(used: ReadonlySet<string>, config: Config): string {
	return used.size > 0 ? `import { ${[...used].sort().join(", ")} } from ${JSON.stringify(config.import ?? "@ts-series/settings")};\n\n\n` : "";
}


// 6  MODULE GENERATION

/** Records the identifier of a module and rejects invalid and duplicate ones. */
function claimId(id: string, name: string, ids: Set<string>): void {
	if (!identifierPattern.test(id) || ids.has(id)) {
		throw new Error(`"${name}" yields the invalid or duplicate identifier "${id}"`);
	}
	else {
		ids.add(id);
	}
}


/** Normalizes keys, completes all languages against the reference language and renders one module per language. */
function generateTranslations(parsed: Map<string, Settings>, config: Config, issues: Issue[]): Output[] {
	const keyLang = config.keyLang ?? "en";
	const refLang = config.refLang ?? [...parsed.keys()].find(l => l !== keyLang) ?? keyLang;
	const tags = new Set([...builtinTags, ...Object.keys(config.selections ?? {})]);
	const trees = new Map([...parsed].map(([lang, tree]) => [lang, normalize(tree, config.keyCase, lang, issues, tags)] as [string, Settings]));
	const ref = trees.get(refLang);

	if (!ref) {
		throw new Error(`Reference language "${refLang}" not found`);
	}

	const order = [...new Set([keyLang, ...trees.keys()])].filter(l => l !== refLang && trees.has(l));

	for (const lang of order) {
		const isKeyLang = lang === keyLang;
		const ctx: MergeContext = { lang, isKeyLang, mode: config.deriveMode ?? null, issues };

		merge(ref, trees.get(lang)!, isKeyLang ? undefined : trees.get(keyLang), ctx, "", "");
	}

	const ids = new Set<string>();

	return [...trees].map(([lang, tree]) => {
		const id = lang.replace("-", "_");
		const used = new Set<string>();
		const ctx: RenderContext = { lang, config, tags, used };
		const leaf: Leaf = (value, key) => renderTranslation(value, key, ctx);

		claimId(id, lang, ids);

		const body = renderTree(tree, leaf, 0);

		return { file: lang, id, text: `${renderImports(used, config)}export const ${id} = ${body} as const;\n` };
	});
}


/** Normalizes keys and renders one module per top-level file or directory of a settings tree. */
function generateSettings(tree: Settings, config: Config, issues: Issue[]): Output[] {
	const constCase = config.constCase === undefined ? "camel" : config.constCase;
	const data = normalize(tree, config.keyCase, "settings", issues, new Set());
	const leaf: Leaf = value => JSON.stringify(value);
	const ids = new Set<string>();

	return Object.entries(data).map(([name, value]) => {
		const id = applyCase(name, constCase);

		claimId(id, name, ids);
		return { file: name, id, text: `export const ${id} = ${renderTree(value as Settings, leaf, 0)} as const;\n` };
	});
}


// 7  BUILD AND WATCH

/** Reads all inputs, generates the modules, writes only those whose content changed and returns the exit code and the written paths. */
async function build(dir: string, strict: boolean): Promise<{ code: number; written: string[] }> {
	const config = await readConfig(dir);
	const listing = await Array.fromAsync(readDirSorted(dir));
	const entries = listing.filter(e => !e.name.startsWith("."));
	const dirs = entries.filter(e => e.isDirectory).map(e => e.name);
	const hasFiles = entries.some(e => e.isFile && yamlPattern.test(e.name));
	const issues: Issue[] = [];
	let outputs: Output[];

	if (!hasFiles && dirs.length > 0 && dirs.every(n => langPattern.test(n))) {
		const results = await Promise.all(dirs.map(lang => readRaw(readText, readDirSorted, `${dir}/${lang}`, false, true)));
		const trees = new Map(dirs.map((lang, i) => [lang, results[i]] as [string, Settings]));

		outputs = generateTranslations(trees, config, issues);
	}
	else {
		const stems = entries.filter(e => e.isDirectory || yamlPattern.test(e.name)).map(e => e.isDirectory ? e.name : e.name.replace(yamlPattern, ""));
		const clash = stems.find((s, i) => stems.indexOf(s) !== i);

		if (clash === undefined) {
			const data = await readRaw(readText, readDirSorted, dir);

			outputs = generateSettings(data, config, issues);
		}
		else {
			throw new Error(`"${clash}" exists more than once as file or directory`);
		}
	}

	const outDir = `${dir}/${config.outDir}`;
	const fatal = issues.filter(i => i.level === "error" || strict);
	const written: string[] = [];

	await mkdir(outDir, { recursive: true });

	for (const output of outputs) {
		const path = `${outDir}/${output.file}.ts`;
		const previous = await readTextIfExists(path);

		if (output.text !== previous) {
			await writeFile(path, output.text);
			written.push(path);
		}
	}

	for (const issue of issues) {
		console.error(`${fatal.includes(issue) ? "error" : "warning"}: ${issue.message}`);
	}
	return { code: fatal.length > 0 ? 1 : 0, written };
}


/** Runs one build, reports every written module and reports a thrown error without ending the process. */
async function buildSafe(dir: string, strict: boolean): Promise<void> {
	try {
		const result = await build(dir, strict);

		for (const path of result.written) {
			console.log(`Rebuild ${path}`);
		}
	}
	catch (e) {
		console.error(e instanceof Error ? e.message : e);
	}
}


/** Builds once, then rebuilds five seconds after the last change of a YAML file or sgen.json. */
async function watch(dir: string, strict: boolean): Promise<void> {
	const pending = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let queue = buildSafe(dir, strict);

	console.log(`Initialize...`);

	for await (const event of watchFs(dir, { recursive: true })) {
		const name = event.filename;

		if (name !== null && (yamlPattern.test(basename(name)) || basename(name) === "sgen.json")) {
			if (!pending.has(name)) {
				pending.add(name);
				console.log(`Read ${name}`);
			}

			clearTimeout(timer);
			timer = setTimeout(() => {
				pending.clear();
				queue = queue.then(() => buildSafe(dir, strict));
			}, watchDelay);
		}
	}
}


// 8  ENTRY POINT

/** Parses the arguments and runs a single build or the watch loop. */
async function main(): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv.slice(2),
		options: {
			strict: { type: "boolean", default: false },
			watch: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const dir = positionals[0] ?? ".";

	if (values.watch) {
		await watch(dir, values.strict);
		return 0;
	}
	else {
		const result = await build(dir, values.strict);

		return result.code;
	}
}


try {
	exit(await main());
}
catch (e) {
	console.error(e instanceof Error ? e.message : e);
	exit(2);
}