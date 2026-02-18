import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepositoryBuilder, SchemaBuildError } from '../src/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, '../../..');
const examplePath = path.join(workspaceRoot, 'example.scedel');

test('RepositoryBuilder builds repository from example.scedel', () => {
  const repository = new RepositoryBuilder().buildFromFile(examplePath);

  assert.equal(repository.effectiveVersion(), '1.0.0');
  assert.equal(repository.customTypes().length, 6);

  const post = repository.getType('Post');
  assert.ok(post);
  assert.equal(post.annotations['php.codegen.namespace'], 'App\\Entities');
  assert.equal(post.fieldAnnotations.internalNote['js.ignore'], 'true');

  const rangeValidator = repository.getValidator('Int', 'range');
  assert.ok(rangeValidator);
  assert.equal(rangeValidator.isBuiltin, false);
  assert.equal(rangeValidator.params.length, 2);
});

test('RepositoryBuilder root type resolution handles ambiguity', () => {
  const repository = new RepositoryBuilder().buildFromFile(examplePath);

  assert.equal(repository.resolveRootType('Post'), 'Post');

  assert.throws(
    () => repository.resolveRootType(),
    (error) => {
      assert.equal(error.message.includes('ambiguous'), true);
      return true;
    },
  );
});

test('RepositoryBuilder detects include cycles', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scedel-cycle-'));
  const aPath = path.join(tempDir, 'a.scedel');
  const bPath = path.join(tempDir, 'b.scedel');

  fs.writeFileSync(aPath, 'include "./b.scedel"\ntype A = String\n', 'utf8');
  fs.writeFileSync(bPath, 'include "./a.scedel"\ntype B = String\n', 'utf8');

  assert.throws(
    () => new RepositoryBuilder().buildFromFile(aPath),
    (error) => {
      assert.ok(error instanceof SchemaBuildError);
      assert.equal(error.code, 'CyclicInclude');
      return true;
    },
  );
});

test('RepositoryBuilder declares supported RFC version', () => {
  assert.ok(RepositoryBuilder.SUPPORTED_RFC_VERSIONS.includes('0.14.2'));
});
