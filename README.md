# Settings.ts

This platform-agnostic settings and translation loader for TypeScript maintains configurations as plain YAML files, allowing them to be loaded at runtime or pre-generated into fully typed modules using the bundled `sgen` CLI tool. All runtime access is injected, so the library runs unchanged on Deno (JSR) and Node (npm).


## Highlights

- Fast loading of configurations from YAML files as JS objects
- No dependencies; instead, a minimal, custom YAML parser is used.
- Translations with interpolation, pluralization, ordinals, selections and language fallbacks
- Tags such as `!plural` make a value a message function and stay valid YAML, so editors highlight them
- Translations of a language such as English can be derived from the keys used in the reference language
- Additional functionality for utilizing environment variables and application directories
- `sgen` generates typed modules ahead of time, eliminating the need for runtime file access or parsing


## Installation

```bash
pnpm install @ts-series/settings
```


## Quick start

Translations live in one directory per language, the file name is the first key:

```yaml
title: Your cart
greeting: Hello {name}!
items: !plural One item | {n} items
```

```ts
import { loadTranslations } from "@ts-series/settings";

const translations = await loadTranslations({
	readFile,
	readDir,
	dir: "./locales/",
	langs: ["en", "de"],
	referenceLang: "en",
});

translations.en.cart.greeting({ name: "Rico" });
translations.de.cart.items(3);
```

Settings work the same way: `loadSettings(readFile, readDir, "./config")` returns the whole directory tree as one nested object.


## Messages

| Value | Result |
|---|---|
| `Hello {name}!` | Interpolation, called with an object or positional arguments. |
| `!plural` | Picks a form by count, `{n}` stands for the count. |
| `!ordinal` | Picks a form by rank, for example `1st`, `2nd`, `3rd`. |
| `!bool` | Picks a form by boolean, written as `true \| false`. |
| Custom tag | Picks a form by key, for example a `!gender` declared in the options. |

Forms can be written in any style, so a short phrase stays on one line and a long one gets a map:

```yaml
items: !plural One item | {n} items
rooms: !plural
  zero: No rooms
  one: One room
  other: "{n} rooms"
```

Selections can contain plurals. The arguments of the call follow the nesting from the outside to the inside:

```yaml
unread: !gender
  female: !plural One message for Mrs {name} | {n} messages for Mrs {name}
  male: !plural One message for Mr {name} | {n} messages for Mr {name}
```

```ts
translations.en.inbox.unread("female", 3, { name: "Anna" });
```


## sgen: pre-generated modules

Loading YAML at startup is convenient, but it costs file access, parsing and type safety. `sgen` reads the same directories once at build time and writes TypeScript modules with everything already resolved, one per language or, for settings, one per top-level file or directory:

- Translations and settings become `as const` objects with full autocompletion
- Selection keys are typed, so a wrong key fails at compile time
- Missing keys, extra keys, differing tags and placeholder mismatches are reported before the code runs
- Fallbacks and derived values are already applied
- Only modules whose content changed are rewritten
- Watch mode regenerates the modules while you edit the YAML files

The target directory is set in `sgen.json` next to the YAML files:

```json
{
	"refLang": "en",
	"outDir": "../src/generated"
}
```

```bash
sgen ./locales
sgen ./locales --strict
sgen ./locales --watch
```

Each module exports a single identifier, so combining them is up to you and only the languages you import end up in your bundle:

```ts
import { de } from "./generated/de.ts";
import { en } from "./generated/en.ts";

const translations = { de, en };
```

Ready-made binaries for Linux, macOS and Windows are attached to the [GitHub releases](https://github.com/ts-series/settings/releases) and need no Deno installation. With Deno, `sgen` can also be installed from JSR:

```bash
deno install -g -A jsr:@ts-series/sgen
```


## Documentation

The full API, all options and the YAML format are described in [REFERENCE.md](https://github.com/ts-series/settings/blob/main/REFERENCE.md).


## License

This software is dual-licensed under the [0BSD](https://opensource.org/license/0bsd) and the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), with the choice of license left to the user.
