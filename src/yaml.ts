
import {
	isPlainObject,
	Tagged,
	type Settings,
	type SettingValue
} from "./data.ts";


//

export const yamlPattern = /\.ya?ml$/;


/** Returns the key unchanged. */
const identity = (key: string): string => key;


/**
 * Minimal YAML-subset parser: scalars, inline/block lists, pipe arrays, quoted strings, nested maps and optional tags.
 * @param input YAML text.
 * @param toCase Transformer applied to every key except "_".
 * @param typedScalars Parses null, booleans and numbers instead of keeping strings.
 * @param keepTags Wraps tagged values into Tagged instead of dropping the tags.
 * @returns The parsed map, or an empty map if the top level is not a map.
 */
export function parseYaml(
	input: string,
	toCase: (key: string) => string = identity,
	typedScalars = true,
	keepTags = false,
): Settings {
	const [result] = parseBlock(
		input.replace(/^\uFEFF/, "").split(/\r?\n/), 0, 0, toCase, typedScalars, keepTags);
	return isPlainObject(result) ? result : {};
}


// FUNCTIONS IMPLEMENTING THE PARSER

/** Recursively parses lines at a given indent level into either a list or a map. */
function parseBlock(
	lines: string[],
	start: number,
	baseIndent: number,
	toCase: (key: string) => string,
	typed: boolean,
	keep: boolean,
): [SettingValue, number] {
	let i = start;
	while (i < lines.length && isBlank(lines[i])) {
		i++;
	}
	const indent = i < lines.length ? indentOf(lines[i]) : -1;
	if (indent < baseIndent) {
		return [{}, i];
	}
	else if (/^-(\s|$)/.test(lines[i].trimStart())) {
		return parseList(lines, i, indent, toCase, typed, keep);
	}
	else {
		return parseMap(lines, i, indent, toCase, typed, keep);
	}
}


/** Parses a contiguous run of "- value" entries at the given indent. */
function parseList(
	lines: string[],
	start: number,
	indent: number,
	toCase: (key: string) => string,
	typed: boolean,
	keep: boolean,
): [SettingValue[], number] {
	const result: SettingValue[] = [];
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		if (isBlank(line)) {
			i++;
		}
		else if (indentOf(line) < indent || !line.trimStart().startsWith("-")) {
			break;
		}
		else {
			const [tag, itemText] = splitTag(stripComment(line.trimStart().slice(1)).trim());
			if (itemText) {
				result.push(applyTag(tag, parseScalar(itemText, typed), keep));
				i++;
			}
			else {
				const [sub, next] = parseBlock(lines, i + 1, indent + 1, toCase, typed, keep);
				result.push(applyTag(tag, sub, keep));
				i = next;
			}
		}
	}
	return [result, i];
}


/** Parses a contiguous run of "key: value" entries at the given indent, leaving the key "_" untransformed. */
function parseMap(
	lines: string[],
	start: number,
	indent: number,
	toCase: (key: string) => string,
	typed: boolean,
	keep: boolean,
): [Settings, number] {
	const result: Settings = {};
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		const tr = line.trimStart();
		const colon = tr.indexOf(":");
		if (isBlank(line)) {
			i++;
		}
		else if (indentOf(line) < indent || colon === -1) {
			break;
		}
		else {
			const key = tr.slice(0, colon).trim();
			const name = key === "_" ? key : toCase(key);
			const [tag, rest] = splitTag(stripComment(tr.slice(colon + 1)).trim());
			if (!key) {
				i++;
			}
			else if (rest) {
				result[name] = applyTag(tag, parseScalar(rest, typed), keep);
				i++;
			}
			else {
				const [sub, next] = parseBlock(lines, i + 1, indent + 1, toCase, typed, keep);
				result[name] = applyTag(tag, sub, keep);
				i = next;
			}
		}
	}
	return [result, i];
}


/** Splits a leading "!tag" from a value text and returns the tag name or null together with the remaining text. */
function splitTag(text: string): [string | null, string] {
	const match = /^!(\S+)\s*(.*)$/.exec(text);
	return match ? [match[1], match[2]] : [null, text];
}


/** Wraps a value into Tagged when tags are kept and a tag is present, otherwise returns the value unchanged. */
function applyTag(tag: string | null, value: SettingValue, keep: boolean): SettingValue {
	return keep && tag !== null ? new Tagged(tag, value) : value;
}


/** Counts leading whitespace characters. */
function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}


/** True for empty lines or full-line comments. */
function isBlank(line: string): boolean {
	const t = line.trim();
	return !t || t.startsWith("#");
}


/** Strips trailing "# ..." comments, requiring whitespace before "#" so values like "#abc" survive. */
function stripComment(s: string): string {
	return s.replace(/(^|\s)#.*$/, "");
}


/** Parses a scalar: null/bool/number when typed, plus quoted strings, inline arrays, and unescaped-pipe arrays. */
function parseScalar(s: string, typed: boolean): SettingValue {
	const t = s.trim();
	if (typed && t === "null") {
		return null;
	}
	else if (typed && t === "true") {
		return true;
	}
	else if (typed && t === "false") {
		return false;
	}
	else if (typed && /^-?\d+(\.\d+)?$/.test(t)) {
		return Number(t);
	}
	else if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	else if (t.startsWith("[") && t.endsWith("]")) {
		const inner = t.slice(1, -1).trim();
		return inner ? inner.split(",").map(x => parseScalar(x, typed)) : [];
	}
	else {
		const parts = t.split(/(?<!\\)\|/).map(p => p.replace(/\\\|/g, "|").trim());
		return parts.length > 1 ? parts.map(p => parseScalar(p, typed)) : parts[0];
	}
}