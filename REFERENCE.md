# Settings.ts — Reference

## Table of Contents

1. [YAML Format](#1-yaml-format)
2. [Settings](#2-settings)
   1. [loadSettings()](#21-loadsettings)
   2. [Case Transformation](#22-case-transformation)
   3. [Lower-Level Functions](#23-lower-level-functions)
   4. [Types](#24-types)
3. [Translations](#3-translations)
   1. [loadTranslations()](#31-loadtranslations)
   2. [Directory Layout and Completion](#32-directory-layout-and-completion)
   3. [Strings, Interpolation and Lists](#33-strings-interpolation-and-lists)
   4. [Plurals and Ordinals](#34-plurals-and-ordinals)
   5. [Booleans and Selections](#35-booleans-and-selections)
   6. [Nesting](#36-nesting)
   7. [Message Function Factories](#37-message-function-factories)
4. [Environment and Directories](#4-environment-and-directories)
   1. [readEnv()](#41-readenv)
   2. [getAppDirs()](#42-getappdirs)
5. [sgen](#5-sgen)
   1. [Usage](#51-usage)
   2. [Modes](#52-modes)
   3. [sgen.json](#53-sgenjson)
   4. [Case Names](#54-case-names)
   5. [Generated Output](#55-generated-output)
   6. [Validation](#56-validation)


## 1. YAML Format

Settings.ts parses a small subset of YAML. Files ending in `.yaml` or `.yml` are read, everything else is ignored, as are all entries whose name starts with a dot.

```yaml
name: Example
port: 8080
debug: false
timeout: null
tags: [a, b, c]
paths:
  - ./src
  - ./lib
server:
  host: localhost
  limits:
    rate: 1.5
```

| Syntax | Result |
|---|---|
| `key: value` | Scalar. |
| Indented block below `key:` | Nested map, or list if the entries start with `- `. |
| `- value` | List entry. A bare `-` followed by an indented block nests a map or list. |
| `[a, b, c]` | Inline list. Entries are split at every comma and parsed as scalars. |
| `a \| b \| c` | Pipe list, parsed like an inline list. Use `\|` for a literal pipe. |
| `"text"` or `'text'` | String without the quotes. Quoting applies to the whole value and also prevents pipe splitting. No escape sequences. |
| `null`, `true`, `false` | `null` and booleans, unless typed scalars are disabled. |
| `-12`, `3.5` | Numbers, unless typed scalars are disabled. |
| `!name value` | Tagged value, see below. |
| `# text` | Comment. At the end of a line it must be preceded by whitespace, so values like `#abc` survive. |

Without typed scalars, every scalar stays a string.

Comments are stripped before quotes are evaluated, so a ` #` inside a quoted string ends the value. A leading byte order mark and Windows line endings are handled. The key `_` is the default key and is never renamed by case transformation.

### Tags

A value can start with a tag, a `!` followed by a name. It works in front of scalars, inline lists, pipe lists and blocks, in maps as well as in lists:

```yaml
items: !plural One item | {n} items
message: !gender
  female: She wrote to you
  male: He wrote to you
```

Tags are valid YAML, so editors highlight them. The parser always recognizes them. By default they are dropped and only the value remains, with `keepTags` the value is wrapped into a `Tagged` instance. Settings ignore tags unless asked otherwise, translations give them a meaning, see [Translations](#3-translations).

A value that should start with a literal `!` has to be quoted.

Not supported: anchors, multi-document streams, multi-line strings and colons inside keys. Colons inside values are fine.


## 2. Settings

### 2.1 `loadSettings()`

Reads a directory tree of YAML files into one nested object. Each file becomes a key named after the file without its extension, each directory becomes a nested map:

```ts
const settings = await loadSettings(Deno.readTextFile, Deno.readDir, "./config");
```

Signature:

```ts
loadSettings(
	readFile: (path: string) => Promise<string>,
	readDir: (dir: string) => AsyncIterable<{ name: string; isDirectory: boolean }>,
	dir: string,
	toCase?: ToCaseOption,
	typedScalars?: boolean,
	keepTags?: boolean
): Promise<Settings>
```

| Parameter | Description |
|---|---|
| `readFile` | Returns the text content of a file. |
| `readDir` | Lists the entries of a directory. `Deno.readDir` fits unchanged. |
| `dir` | Root directory. Child paths are joined with `/`. |
| `toCase` | Optional key transformation, see [Case Transformation](#22-case-transformation). |
| `typedScalars` | Defaults to `true`. |
| `keepTags` | Defaults to `false`. Wraps tagged values into `Tagged`. |

A missing directory yields an empty object. All other errors are rethrown.

Node adapter for `readDir`:

```ts
async function* readDir(dir: string) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		yield { name: entry.name, isDirectory: entry.isDirectory() };
	}
}
```

### 2.2 Case Transformation

`ToCaseOption` is one of:

| Form | Behavior |
|---|---|
| Function | Applied to all keys below every top-level section. |
| `null` | No transformation. |
| `Record<string, CaseTransformer>` | Transformer per top-level section, `"*"` as default for all other sections. `null` as a value disables the transformation for that section. |

```ts
const settings = await loadSettings(Deno.readTextFile, Deno.readDir, "./config", {
	database: key => key.toUpperCase(),
	raw: null,
	"*": key => key.toLowerCase()
});
```

Top-level section names (file and directory names) are never renamed. Nested maps are renamed recursively, also inside tagged values, and the key `_` is skipped.

### 2.3 Lower-Level Functions

| Function | Description |
|---|---|
| `readRaw(readFile, readDir, dir, typedScalars?, keepTags?)` | Same traversal as `loadSettings()`, without case transformation and without the missing-directory handling. |
| `parseYaml(input, toCase?, typedScalars?, keepTags?)` | Parses one YAML string. `toCase` is a plain `(key) => string` function. Returns an empty object if the top level is not a map. |
| `transformKeys(settings, toCase)` | Applies a `ToCaseOption` to an existing `Settings` object. |
| `isPlainObject(v)` | Type guard for plain objects. Arrays and `Tagged` instances are not plain objects. |
| `yamlPattern` | `/\.ya?ml$/`, the file name test used by the loaders. |

`parseYaml()` needs no file access, so it turns YAML text into an object anywhere:

```ts
const settings = parseYaml(text);
```

### 2.4 Types

```ts
type SettingValue = string | number | boolean | null | SettingValue[] | Settings | Tagged;

interface Settings {
	[key: string]: SettingValue;
}

class Tagged {
	constructor(readonly tag: string, readonly value: SettingValue);
}

type CaseTransformer = ((key: string) => string) | null;
```

`tag` is the name without the `!`. Because `Tagged` is a class, it is never mistaken for a nested map.


## 3. Translations

Translations are settings with tags. A string, a list or a map under a tag becomes a message function, everything else stays data.

### 3.1 `loadTranslations()`

Loads one YAML tree per language, completes missing entries and returns one nested object per language:

```ts
const translations = await loadTranslations({
	readFile: Deno.readTextFile,
	readDir: Deno.readDir,
	dir: "./locales/",
	langs: ["en", "de"],
	referenceLang: "de"
});

translations.en.cart.greeting({ name: "Rico" });
```

Signature:

```ts
loadTranslations<Lang extends string, T extends Translations = Translations>(
	options: TranslationOptions<Lang>
): Promise<Record<Lang, T>>
```

| Option | Type | Description |
|---|---|---|
| `readFile` | `(path: string) => Promise<string>` | See [loadSettings()](#21-loadsettings). |
| `readDir` | `(path: string) => AsyncIterable<{ name: string; isDirectory: boolean }>` | See [loadSettings()](#21-loadsettings). |
| `dir` | `string` | Root directory. The language is appended directly, so it needs a trailing slash. |
| `langs` | `readonly Lang[]` | Languages to load, one subdirectory each. |
| `referenceLang` | `Lang` | Language whose structure defines the expected keys. |
| `keyLang` | `Lang` | Optional. Language whose values equal the keys. Defaults to `"en"`. |
| `fallback` | `Lang \| null` | Optional. Language used to fill missing entries. Defaults to `keyLang`. `null` disables the fallback. |
| `placeholder` | `string` | Optional. Value for missing entries when `fallback` is `null`. Defaults to `"<?>"`. |
| `deriveValue` | `(key: string) => string` | Optional. Derives a value from a key. Defaults to the key itself. |
| `toCase` | `ToCaseOption` | Optional. Applied to the finished result per language, see [Case Transformation](#22-case-transformation). |
| `selections` | `Record<string, readonly string[]>` | Optional. Declares custom selection tags with their keys, see [Booleans and Selections](#35-booleans-and-selections). |
| `pluralAdapters` | `Partial<Record<Lang, PluralAdapter>>` | Optional. Replaces the default `Intl.PluralRules` selection per language. |
| `pluralOrder` | `Partial<Record<Lang, readonly PluralCategory[]>>` | Optional. Category order of the `!plural` shorthand per language. |
| `ordinalOrder` | `Partial<Record<Lang, readonly PluralCategory[]>>` | Optional. Category order of the `!ordinal` shorthand per language. |

Translation files are always read without typed scalars, every value is text.

### 3.2 Directory Layout and Completion

```
locales/
  en/
    cart.yaml
    errors.yaml
  de/
    cart.yaml
    errors.yaml
```

The file name is the first key, so `errors.yaml` is available as `translations.en.errors`. Directories nest further.

The reference language defines which entries must exist. For every other language, a missing entry is filled in the following order:

| Language | Value |
|---|---|
| `keyLang` | `deriveValue(key)`. |
| Any other, `fallback` set | The value of the fallback language, or `deriveValue(key)` if that has none either. |
| Any other, `fallback` is `null` | `placeholder`. |

For the key `_`, the name of the parent key is used. The key language is completed first, so it is complete when it serves as fallback. The reference language itself is not completed, and entries that exist only in other languages are kept.

A tagged value counts as one entry. A language that lacks it receives a plain string from the rules above, so tagged entries should exist in every language.

### 3.3 Strings, Interpolation and Lists

| YAML value | Result |
|---|---|
| String without `{` | `string`. |
| String with `{name}` | Interpolation function. |
| List without tag | `string[]`. Non-string entries are dropped. |
| Map | Nested translations. |
| Value with a known tag | Message function, see the following sections. |
| Value with an unknown tag | The tag is ignored and the value is read as without it. |

```ts
type MessageFn = (...args: any[]) => string;

type TranslationValue = string | string[] | MessageFn | Translations;
```

Named placeholders take an object, numbered placeholders take positional arguments:

```yaml
greeting: "Hello {name}!"
move: "Move {1} to {2}"
```

```ts
translations.en.greeting({ name: "Rico" });
translations.en.move("a", "b");
```

Named placeholders called positionally are numbered after the highest numbered placeholder, in order of first appearance. Unresolved placeholders stay in the text as `{name}`. Quotes keep the line valid YAML, because a value starting with `{` would be a flow map there.

A pipe list without a tag is a plain list, `a | b | c` yields `["a", "b", "c"]`.

### 3.4 Plurals and Ordinals

`!plural` picks a form by a count, `!ordinal` by a rank. Both turn the value into a function `(n, args?)`:

```yaml
items: !plural One item | {n} items
rooms: !plural
  zero: No rooms
  one: One room
  other: "{n} rooms"
```

```ts
translations.en.cart.items(3);
translations.en.cart.items(3, { name: "Rico" });
```

Any list or map style is allowed under the tag: pipe list, inline list, block list and map. A single string counts as the `other` form.

Selection order for a call with `n`:

1. A form whose key equals `n` exactly, for example `5: five items`.
2. The `zero` form if `n` is `0`.
3. The CLDR category of `n`, from `Intl.PluralRules` or the language's `pluralAdapters` entry. For `!ordinal` the ordinal rules apply.
4. The `other` form, or an empty string.

`{n}` is replaced by the number, other placeholders by `args`.

The shorthand with a list or pipe list needs no category names:

```yaml
items: !plural One item | {n} items
rooms: !plural No rooms | One room | {n} rooms
```

| Forms | Categories |
|---|---|
| 2 | `one`, `other` |
| 3 | `zero`, `one`, `other` |
| Other | `pluralOrder` or `ordinalOrder` for the language is required. |

An error is thrown if a shorthand has another number of forms and no matching order. An order whose length differs from the list is an error as well. English ordinals have four forms:

```ts
ordinalOrder: { en: ["one", "two", "few", "other"] }
```

```yaml
rank: !ordinal {n}st | {n}nd | {n}rd | {n}th
```

A pipe list is one value, so its parts cannot be quoted separately. Forms that must be valid YAML for other tools go into the map or block list style, where each form can be quoted.

```ts
type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type PluralAdapter = (n: number) => PluralCategory;
```

### 3.5 Booleans and Selections

`!bool` picks a form by a boolean. Its forms are `true` and `false`, in this order in the shorthand:

```yaml
done: !bool Done | Open
```

```ts
translations.en.task.done(true);
```

Custom selections pick a form by a key that the caller passes. The tag and its keys are declared in the options. The order of the keys defines the shorthand:

```ts
selections: { gender: ["female", "male", "other"] }
```

```yaml
message: !gender She wrote to you | He wrote to you | The person wrote to you
```

```ts
translations.en.inbox.message("female");
```

The map style names the keys, and keys outside the declaration are an error:

```yaml
message: !gender
  female: "{name} wrote to you"
  male: "{name} wrote to you"
  other: "{name} wrote to you"
```

```ts
translations.en.inbox.message("female", { name: "Anna" });
```

A key that does not exist is not handled, the call fails. With `sgen` the key is typed and a wrong one does not compile. The names `plural`, `ordinal` and `bool` are reserved.

```ts
type SelectFn = (key: string, ...rest: unknown[]) => string;

type BoolFn = (value: boolean, ...rest: unknown[]) => string;
```

### 3.6 Nesting

The forms of `!bool` and of custom selections can be tagged themselves. The arguments of the call then follow the nesting from the outside to the inside, and the placeholder values come last:

```yaml
unread: !gender
  female: !plural One message for Mrs {name} | {n} messages for Mrs {name}
  male: !plural One message for Mr {name} | {n} messages for Mr {name}
```

```ts
translations.en.inbox.unread("female", 3, { name: "Anna" });
```

Selections and booleans can contain each other and plurals. The forms of `!plural` and `!ordinal` have to be text, so a count is always the innermost choice. Anything else is an error.

### 3.7 Message Function Factories

The factories behind the tags are exported and usable without YAML:

| Function | Description |
|---|---|
| `interpolation(template)` | Creates an interpolation function. Placeholder names are derived from the template type. Templates with numbered placeholders accept positional arguments only. |
| `plural(lang, forms)` | Creates a plural function from a map of categories or exact numbers to texts. |
| `ordinal(lang, forms)` | The same for ordinal rules. |
| `select(forms)` | Creates a selection function from a map of keys to texts or message functions. The key is typed from the map. |
| `bool(forms)` | Creates a boolean function from `{ true, false }`, each a text or message function. |
| `defaultPluralAdapter(lang, type?)` | Builds the `Intl.PluralRules` adapter for a language. `type` is `"cardinal"` by default or `"ordinal"`. |

```ts
const items = plural("en", { one: "One item", other: "{n} items" });
const message = select({ female: "She wrote", male: "He wrote" });
```

The plural and ordinal rules of all languages come from `Intl.PluralRules`.


## 4. Environment and Directories

Neither function touches the runtime itself, the environment record and the operating system name are passed in.

### 4.1 `readEnv()`

Reads all variables starting with a prefix into a typed object:

```ts
const env = readEnv(Deno.env.toObject(), "MYAPP_", { debug: false, port: 8080 }, key => key.toLowerCase());
```

Signature:

```ts
readEnv<T extends Record<string, string | number | boolean>>(
	env: Record<string, string | undefined>,
	prefix: string,
	defaultEnv: T,
	toCase?: (key: string) => string
): T
```

The prefix is removed, `toCase` is applied to the remaining name and the value is parsed. Parsed variables override the defaults. The key case must match the keys of `defaultEnv`, so `MYAPP_DEBUG` needs a lowercase `toCase` to replace `debug`.

`parseEnvValue(value)` is exported as well: `"true"` and `"false"` become booleans, numeric text becomes a number, everything else stays a string.

### 4.2 `getAppDirs()`

Resolves OS-appropriate directories for an application name:

```ts
const dirs = getAppDirs(Deno.env.toObject(), Deno.build.os, "MyApp");
```

Signature:

```ts
getAppDirs(env: Record<string, string | undefined>, os: string, name: string): AppDirs
```

```ts
interface AppDirs {
	cache: string;
	config: string;
	data: string;
}
```

| OS | `cache` | `config` | `data` |
|---|---|---|---|
| Windows | `%LOCALAPPDATA%\name\Cache` | `%APPDATA%\name\Config` | `%APPDATA%\name\Data` |
| macOS | `~/Library/Caches/name` | `~/Library/Application Support/name` | `~/Library/Application Support/name` |
| Other | `$XDG_CACHE_HOME/name` | `$XDG_CONFIG_HOME/name` | `$XDG_DATA_HOME/name` |

The OS name is matched case-insensitively: anything starting with `win` is Windows and `darwin` is macOS. This covers `Deno.build.os` and `process.platform`. The home directory comes from `HOME`, then `USERPROFILE`. Missing Windows variables fall back to `AppData\Roaming` and `AppData\Local` below the home directory, missing XDG variables to `~/.cache`, `~/.config` and `~/.local/share`.


## 5. sgen

`sgen` generates TypeScript modules from the same directories the loaders read, so nothing is read or parsed at runtime. Each top-level entry becomes one module with a single exported identifier. It is available as a standalone binary and from JSR, where it needs Deno with read and write permission.

### 5.1 Usage

```bash
sgen [dir] [--strict] [--watch]
```

| Argument | Description |
|---|---|
| `dir` | Directory to process. Defaults to `.`. |
| `--strict` | Treat missing entries as errors. |
| `--watch` | Build once, then rebuild five seconds after the last change of a YAML file or `sgen.json`. Errors are reported without ending the process. |

| Exit code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Errors found, or warnings with `--strict`. The modules are written anyway. |
| `2` | Fatal error, for example a missing `outDir`, an unknown reference language or an invalid shorthand. |

### 5.2 Modes

The mode follows from the directory content. If there are no YAML files directly in `dir` and every subdirectory is named like a language (`en`, `de`, `pt_BR`, `pt-BR`), `sgen` runs in translation mode with one language per subdirectory. Otherwise it runs in settings mode. Hidden entries are ignored.

| Mode | Module per | Exported identifier |
|---|---|---|
| Translations | Language | The language code, with `-` replaced by `_`. |
| Settings | Top-level file or directory | The name, in the case of `constCase`. |

Files and directories below a top-level directory become properties of its module. Settings mode reads with typed scalars, translation mode without.

### 5.3 `sgen.json`

File in `dir`. Only `outDir` is required.

| Field | Type | Description |
|---|---|---|
| `outDir` | `string` | Directory for the generated modules, relative to `dir`. It should not lie inside `dir`. |
| `refLang` | `string` | Reference language. Defaults to the first language other than `keyLang` in alphabetical order. |
| `keyLang` | `string` | Language whose values equal the keys. Defaults to `"en"`. |
| `import` | `string` | Module the generated code imports its factories from. Defaults to `"@ts-series/settings"`. |
| `keyCase` | `Case \| Record<string, Case>` | Case applied to all keys below the top-level sections, or per section with `"*"` as default. Defaults to unchanged. |
| `constCase` | `Case` | Settings mode only. Case of the exported identifiers. Defaults to `"camel"`. |
| `deriveMode` | `Case` | Case applied to values derived from keys for missing entries. Defaults to unchanged. |
| `selections` | `Record<string, string[]>` | Custom selection tags with their keys, as in [Booleans and Selections](#35-booleans-and-selections). |
| `pluralOrder` | `Record<string, string[]>` | Category order of the `!plural` shorthand per language. |
| `ordinalOrder` | `Record<string, string[]>` | Category order of the `!ordinal` shorthand per language. |

`Case` is one of the names below, or `null` for unchanged.

```json
{
	"outDir": "../src/generated",
	"refLang": "de",
	"keyCase": { "errors": "camel", "*": null },
	"selections": { "gender": ["female", "male", "other"] },
	"ordinalOrder": { "en": ["one", "two", "few", "other"] }
}
```

### 5.4 Case Names

| Name | `user-name` | `EUR_rate` |
|---|---|---|
| `camel` | `userName` | `eurRate` |
| `Pascal` | `UserName` | `EurRate` |
| `id` | `userName` | `EURRate` |
| `Id` | `UserName` | `EURRate` |
| `Title` | `User Name` | `Eur Rate` |
| `Sentence` | `User name` | `Eur rate` |
| `snake` | `user_name` | `eur_rate` |

Words are split at separators and at lowercase-to-uppercase boundaries. `id` and `Id` keep existing uppercase letters, which suits identifiers like currency codes.

### 5.5 Generated Output

Translation mode writes `de.ts`, `en.ts` and so on into `outDir`:

```ts
import { interpolation, plural, select } from "@ts-series/settings";


export const de = {
	cart: {
		greeting: interpolation("Hallo {name}!"),
		items: plural("de", { one: "Ein Artikel", other: "{n} Artikel" }),
	},
	inbox: {
		unread: select({ female: plural("de", { one: "Eine Nachricht", other: "{n} Nachrichten" }), male: plural("de", { one: "Eine Nachricht", other: "{n} Nachrichten" }) }),
	},
} as const;
```

Each module imports only the factories it uses and no import line is written if there are none. Plain strings stay literals and lists become string arrays. Shorthands are resolved at generation time into explicit maps, and an exact-number key stays an exact-number key. The arguments of nested calls are typed from the nesting, so `unread("female", 3, { name })` is checked by the compiler.

Combining the languages is left to the application:

```ts
import { de } from "./generated/de.ts";
import { en } from "./generated/en.ts";

const translations = { de, en };
```

Settings mode writes one module per top-level file or directory, without imports:

```ts
export const server = {
	host: "localhost",
	port: 8080,
} as const;
```

An identifier that is invalid or appears twice aborts the build. So does a file and a directory with the same name, and so does an unknown key or a wrong number of forms in a tagged value. A module is only written when its content changed. Modules of entries that no longer exist stay in `outDir` and have to be removed by hand.

### 5.6 Validation

In translation mode, every language is compared to the reference language:

| Level | Message | Cause |
|---|---|---|
| error | `extra "path"` | Entry that does not exist in the reference language. |
| error | `"path" collides with another key` | Two keys become equal after `keyCase`. |
| error | `"path" differs in structure` | Map in one language, value in the other. |
| error | `"path" differs in tag` | A tag differs from the reference language. Only the outermost tag of an entry is compared. |
| error | `"path" has different placeholders` | Named placeholders differ from the reference. Numbered placeholders are not compared. |
| missing | `missing "path"` | Entry missing in a language other than `keyLang`. An error with `--strict`, otherwise a warning. |

Missing entries are filled before generation. In `keyLang` they are derived from the key. In other languages the value of `keyLang` is used if available, otherwise the derived key. A derived value is a plain string, so a tagged entry should exist in `keyLang` as well.