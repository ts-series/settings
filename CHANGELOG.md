# Changelog

## 2.0: First Public Release

Major additions to translations: interpolation, pluralization and selection. Translation files can now be nested to any depth, and the YAML parser was improved to represent nested objects reliably.

The parser understands tags such as `!plural`, `!ordinal`, `!bool` and custom selections, which turn values into message functions. Selections can be nested to combine, for example, gender and plural in one entry.

Added `sgen`, a tool for statically pre-generating TypeScript modules from YAML files, one per language or top-level entry, giving full type safety wherever values do not have to change at runtime.


## 1.0: Internal Version

Loaded settings and simple key-value translations from YAML files.