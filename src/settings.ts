
import {
	transformKeys,
	type Settings,
	type ToCaseOption
} from "./data.ts";

import { parseYaml, yamlPattern } from "./yaml.ts";


//

/**
 * Reads all YAML files from a directory tree, with optional case transformation, typed-scalar parsing and tag retention.
 * @param readFile Returns the text content of a file.
 * @param readDir Lists the entries of a directory.
 * @param dir Root directory.
 * @param toCase Transformer applied to all keys below each top-level section.
 * @param typedScalars Parses null, booleans and numbers instead of keeping strings.
 * @param keepTags Wraps tagged values into Tagged instead of dropping the tags.
 * @returns The settings tree, or an empty map if the directory does not exist.
 */
export async function loadSettings(
	readFile: (path: string) => Promise<string>,
	readDir: (dir: string) => AsyncIterable<{ name: string; isDirectory: boolean }>,
	dir: string,
	toCase?: ToCaseOption,
	typedScalars = true,
	keepTags = false,
): Promise<Settings> {
	try {
		const raw = await readRaw(readFile, readDir, dir, typedScalars, keepTags);
		return toCase ? transformKeys(raw, toCase) : raw;
	}
	catch (e) {
		if (e instanceof Error && (e as any).code === "ENOENT") {
			return {};
		}
		else {
			throw e;
		}
	}
}


/**
 * Recursively walks a directory tree, parsing each visible YAML file.
 * @param readFile Returns the text content of a file.
 * @param readDir Lists the entries of a directory.
 * @param dir Root directory.
 * @param typedScalars Parses null, booleans and numbers instead of keeping strings.
 * @param keepTags Wraps tagged values into Tagged instead of dropping the tags.
 * @returns The settings tree without case transformation.
 */
export async function readRaw(
	readFile: (path: string) => Promise<string>,
	readDir: (dir: string) => AsyncIterable<{ name: string; isDirectory: boolean }>,
	dir: string,
	typedScalars = true,
	keepTags = false,
): Promise<Settings> {
	const result: Settings = {};
	for await (const e of readDir(dir)) {
		if (e.name.startsWith(".")) {
			continue;
		}
		else if (e.isDirectory) {
			result[e.name] = await readRaw(readFile, readDir, `${dir}/${e.name}`, typedScalars, keepTags);
		}
		else if (yamlPattern.test(e.name)) {
			const text = await readFile(`${dir}/${e.name}`);
			result[e.name.replace(yamlPattern, "")] = parseYaml(text, undefined, typedScalars, keepTags);
		}
	}
	return result;
}
