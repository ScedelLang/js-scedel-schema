# @scedel/schema

<img src="https://raw.githubusercontent.com/ScedelLang/grammar/5f1e7572f328d657c726a2fcaeaf53d9f6863d6a/logo.svg" width="250px" alt="logo" />

Pure JS schema repository builder for Scedel.

## RFC support

- [Target RFC: `0.14.2`](https://github.com/ScedelLang/grammar/blob/main/RFC-Scedel-0.14.2.md)

## What it provides

- Recursive include loading (include-first DFS)
- Include cycle detection
- Typed schema repository for downstream tools

## Usage

```js
import { RepositoryBuilder } from '@scedel/schema';

const repository = new RepositoryBuilder().buildFromFile('/absolute/path/schema.scedel');
const type = repository.getType('Post');
const validator = repository.getValidator('String', 'noAds');
```

## CLI

```bash
node js/scedel-schema/bin/describe-schema.mjs /absolute/path/schema.scedel
node js/scedel-schema/bin/describe-schema.mjs --show-builtins /absolute/path/schema.scedel
```
