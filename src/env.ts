// APP DIRECTORIES

export interface AppDirs {
	cache: string;
	config: string;
	data: string;
}


const windowsPattern = /^win/i;
const macPattern = /^darwin$/i;

/** Resolves OS-appropriate cache, config and data directories from an env record, matching the OS name case-insensitively by group. */
export function getAppDirs(env: Record<string, string | undefined>, os: string, name: string): AppDirs {
	const home = env.HOME ?? env.USERPROFILE ?? "";

	if (windowsPattern.test(os)) {
		const appData = env.APPDATA ?? `${home}\\AppData\\Roaming`;
		const localAppData = env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
		return {
			cache: `${localAppData}\\${name}\\Cache`,
			config: `${appData}\\${name}\\Config`,
			data: `${appData}\\${name}\\Data`
		};
	}
	else if (macPattern.test(os)) {
		return {
			cache: `${home}/Library/Caches/${name}`,
			config: `${home}/Library/Application Support/${name}`,
			data: `${home}/Library/Application Support/${name}`
		};
	}
	else {
		return {
			cache: `${env.XDG_CACHE_HOME || `${home}/.cache`}/${name}`,
			config: `${env.XDG_CONFIG_HOME || `${home}/.config`}/${name}`,
			data: `${env.XDG_DATA_HOME || `${home}/.local/share`}/${name}`
		};
	}
}


// ENVIRONMENT VARIABLES

export function parseEnvValue(value: string): string | number | boolean {
	if (value === "true")
		return true;
	else if (value === "false")
		return false;
	else if (!isNaN(Number(value)) && value !== "")
		return Number(value);
	else
		return value;
}


/** Reads all env variables matching a prefix, strips the prefix, applies the given case converter to keys, reads values as JS primitives and falls back to the given defaults. */
export function readEnv<T extends Record<string, string | number | boolean>>(
	env: Record<string, string | undefined>,
	prefix: string,
	defaultEnv: T,
	toCase: (key: string) => string = (key => key)
): T {
	const parsed = Object.fromEntries(
		Object.entries(env)
			.filter((entry): entry is [string, string] => entry[0].startsWith(prefix) && entry[1] !== undefined)
			.map(([k, v]) => [toCase(k.slice(prefix.length)), parseEnvValue(v)])
	);
	return { ...defaultEnv, ...parsed };
}
