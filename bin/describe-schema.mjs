#!/usr/bin/env node
import path from 'node:path';
import { RepositoryBuilder, SchemaInfoRenderer } from '../src/index.js';

const args = process.argv.slice(2);

let showBuiltins = false;
const positionals = [];

for (const arg of args) {
  if (arg === '--show-builtins') {
    showBuiltins = true;
    continue;
  }

  if (arg.startsWith('--')) {
    console.error('Usage:');
    console.error('  describe-schema [--show-builtins] <schema.scedel>');
    process.exit(2);
  }

  positionals.push(arg);
}

if (positionals.length !== 1) {
  console.error('Usage:');
  console.error('  describe-schema [--show-builtins] <schema.scedel>');
  process.exit(2);
}

const schemaPath = path.resolve(positionals[0]);

try {
  const repository = new RepositoryBuilder().buildFromFile(schemaPath);
  const output = new SchemaInfoRenderer().render(repository, schemaPath, showBuiltins);
  process.stdout.write(output);
} catch (error) {
  console.error('Failed to describe schema:');
  console.error(`- ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
