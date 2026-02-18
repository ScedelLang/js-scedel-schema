# @scedel/schema

Pure JS schema repository builder for SCEDel.

## RFC support

- Target RFC: `0.14.2`

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
