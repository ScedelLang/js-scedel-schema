import fs from 'node:fs';
import path from 'node:path';
import { ParserService } from '@scedel/parser';
import { SchemaRepository } from './schema-repository.js';
import { parseTypeExpression } from './type-expression.js';

export class SchemaBuildError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SchemaBuildError';
    this.source = options.source ?? null;
    this.includeChain = options.includeChain ?? [];
    this.code = options.code ?? 'InvalidExpression';
    this.category = options.category ?? 'SemanticError';
    this.cause = options.cause;
  }
}

export class RepositoryBuilder {
  static SUPPORTED_RFC_VERSIONS = ['0.14.2'];

  constructor(parser = new ParserService()) {
    this.parser = parser;
  }

  buildFromFile(schemaPath) {
    const rootPath = path.resolve(schemaPath);
    const context = {
      loaded: new Map(),
      order: [],
      warnings: [],
    };

    this.#loadDocument(rootPath, [], context);
    return this.#composeRepository(context);
  }

  buildFromString(source, sourceName = 'inline.scedel', baseUri = null) {
    const resolvedSource = baseUri ? path.resolve(baseUri) : sourceName;

    const ast = this.parser.parseString(source, sourceName);
    const context = {
      loaded: new Map([[resolvedSource, { path: resolvedSource, ast, includes: [] }]]),
      order: [resolvedSource],
      warnings: [],
    };

    if (baseUri) {
      this.#loadIncludesForAst(resolvedSource, ast, [resolvedSource], context);
    }

    return this.#composeRepository(context);
  }

  #loadDocument(filePath, stack, context) {
    const absolutePath = path.resolve(filePath);

    if (stack.includes(absolutePath)) {
      throw new SchemaBuildError('Include cycle detected.', {
        source: absolutePath,
        includeChain: [...stack, absolutePath],
        code: 'CyclicInclude',
        category: 'IncludeResolutionError',
      });
    }

    if (context.loaded.has(absolutePath)) {
      return;
    }

    let source;
    try {
      source = fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      throw new SchemaBuildError(`Unable to read schema file: ${absolutePath}`, {
        source: absolutePath,
        includeChain: [...stack, absolutePath],
        code: 'IncludeNotFound',
        category: 'IncludeResolutionError',
        cause: error,
      });
    }

    let ast;
    try {
      ast = this.parser.parseString(source, absolutePath);
    } catch (error) {
      throw new SchemaBuildError(`Failed to parse schema file: ${absolutePath}`, {
        source: absolutePath,
        includeChain: [...stack, absolutePath],
        code: error?.code ?? 'InvalidExpression',
        category: error?.category ?? 'ParseError',
        cause: error,
      });
    }

    const entry = { path: absolutePath, ast, includes: [] };
    context.loaded.set(absolutePath, entry);

    this.#loadIncludesForAst(absolutePath, ast, [...stack, absolutePath], context);

    if (!context.order.includes(absolutePath)) {
      context.order.push(absolutePath);
    }
  }

  #loadIncludesForAst(currentPath, ast, stack, context) {
    const seenInFile = new Set();

    for (const includeNode of ast.includes) {
      const resolvedInclude = this.#resolveIncludePath(currentPath, includeNode.path);
      const entry = context.loaded.get(currentPath);
      if (entry) {
        entry.includes.push(resolvedInclude);
      }

      if (seenInFile.has(resolvedInclude)) {
        context.warnings.push({
          code: 'DIRECT_DUPLICATE_INCLUDE',
          message: `Duplicate include "${includeNode.path}" in ${currentPath}`,
          source: currentPath,
        });
        continue;
      }

      seenInFile.add(resolvedInclude);
      this.#loadDocument(resolvedInclude, stack, context);
    }
  }

  #resolveIncludePath(currentPath, includePath) {
    if (includePath.startsWith('file://')) {
      return path.resolve(includePath.slice('file://'.length));
    }

    if (path.isAbsolute(includePath)) {
      return path.resolve(includePath);
    }

    return path.resolve(path.dirname(currentPath), includePath);
  }

  #composeRepository(context) {
    const types = new Map();
    const validators = new Map();
    const targetedAnnotations = [];
    let effectiveVersion = null;

    for (const sourcePath of context.order) {
      const doc = context.loaded.get(sourcePath);
      if (!doc) {
        continue;
      }

      if (doc.ast.version) {
        const version = `${doc.ast.version.major}.${doc.ast.version.minor}.${doc.ast.version.patch ?? 0}`;
        if (effectiveVersion === null || compareVersion(version, effectiveVersion) > 0) {
          effectiveVersion = version;
        }
      }

      for (const statement of doc.ast.statements) {
        if (statement.kind === 'typeDeclaration') {
          if (types.has(statement.name)) {
            throw new SchemaBuildError(`Duplicate type declaration: ${statement.name}`, {
              source: sourcePath,
              code: 'TypeRedeclared',
              category: 'SemanticError',
            });
          }

          const expr = parseTypeExpression(statement.typeExpr);
          const annotationMap = toAnnotationMap(statement.annotations);
          const fieldAnnotations = collectFieldAnnotations(expr);

          types.set(statement.name, {
            kind: 'type',
            isBuiltin: false,
            name: statement.name,
            expr,
            exprText: statement.typeExpr,
            annotations: annotationMap,
            fieldAnnotations,
            origins: [sourcePath],
          });
          continue;
        }

        if (statement.kind === 'validatorDeclaration') {
          const key = validatorKey(statement.targetType, statement.name);
          if (validators.has(key)) {
            throw new SchemaBuildError(`Duplicate validator declaration: ${statement.targetType}(${statement.name})`, {
              source: sourcePath,
              code: 'ValidatorRedeclared',
              category: 'SemanticError',
            });
          }

          validators.set(key, {
            kind: 'validator',
            isBuiltin: false,
            targetType: statement.targetType,
            name: statement.name,
            params: statement.params,
            body: statement.body,
            annotations: toAnnotationMap(statement.annotations),
            origins: [sourcePath],
          });
          continue;
        }

        if (statement.kind === 'targetedAnnotation') {
          targetedAnnotations.push({
            source: sourcePath,
            annotation: statement.annotation,
            target: statement.target,
          });
        }
      }
    }

    for (const annotationStatement of targetedAnnotations) {
      applyTargetedAnnotation(annotationStatement, types, context.warnings);
    }

    const documents = context.order.map((sourcePath) => {
      const entry = context.loaded.get(sourcePath);
      return {
        path: sourcePath,
        includes: entry ? [...new Set(entry.includes)] : [],
      };
    });

    return new SchemaRepository({
      types,
      validators,
      documents,
      warnings: context.warnings,
      effectiveVersion: effectiveVersion ?? '1.0.0',
    });
  }
}

function compareVersion(left, right) {
  const l = String(left).split('.').map((item) => Number(item || 0));
  const r = String(right).split('.').map((item) => Number(item || 0));

  for (let i = 0; i < 3; i++) {
    const li = l[i] ?? 0;
    const ri = r[i] ?? 0;
    if (li !== ri) {
      return li - ri;
    }
  }

  return 0;
}

function validatorKey(targetType, name) {
  return `${targetType}:${name}`;
}

function toAnnotationMap(annotations) {
  const map = {};
  for (const annotation of annotations ?? []) {
    map[annotation.key] = annotation.value;
  }
  return map;
}

function collectFieldAnnotations(typeExpr, prefix = '', result = {}) {
  if (!typeExpr || typeof typeExpr !== 'object') {
    return result;
  }

  if (typeExpr.kind === 'record') {
    for (const field of typeExpr.fields) {
      const pathKey = prefix ? `${prefix}.${field.name}` : field.name;
      if (field.annotations.length > 0) {
        const annotationMap = {};
        for (const annotation of field.annotations) {
          annotationMap[annotation.key] = annotation.value ?? 'true';
        }
        result[pathKey] = annotationMap;
      }

      collectFieldAnnotations(field.type, pathKey, result);
    }
    return result;
  }

  if (typeExpr.kind === 'array') {
    collectFieldAnnotations(typeExpr.itemType, prefix, result);
    return result;
  }

  if (typeExpr.kind === 'nullable') {
    collectFieldAnnotations(typeExpr.inner, prefix, result);
    return result;
  }

  if (typeExpr.kind === 'union' || typeExpr.kind === 'intersection') {
    for (const member of typeExpr.members) {
      collectFieldAnnotations(member, prefix, result);
    }
    return result;
  }

  if (typeExpr.kind === 'conditional') {
    collectFieldAnnotations(typeExpr.thenType, prefix, result);
    collectFieldAnnotations(typeExpr.elseType, prefix, result);
  }

  return result;
}

function applyTargetedAnnotation(statement, types, warnings) {
  const { target, annotation } = statement;

  if (target.kind === 'type') {
    const type = types.get(target.typeName);
    if (!type) {
      warnings.push({
        code: 'UNKNOWN_ANNOTATION_TARGET',
        message: `Type target does not exist: ${target.typeName}`,
        source: statement.source,
      });
      return;
    }

    type.annotations[annotation.key] = annotation.value ?? 'true';
    return;
  }

  if (target.kind === 'fieldPath') {
    const type = types.get(target.typeName);
    if (!type) {
      warnings.push({
        code: 'UNKNOWN_ANNOTATION_TARGET',
        message: `Field target type does not exist: ${target.raw}`,
        source: statement.source,
      });
      return;
    }

    const fieldPath = target.path.join('.');
    const annotations = type.fieldAnnotations[fieldPath] ?? {};
    annotations[annotation.key] = annotation.value ?? 'true';
    type.fieldAnnotations[fieldPath] = annotations;
    return;
  }

  if (target.kind === 'fieldSet') {
    const type = types.get(target.typeName);
    if (!type) {
      warnings.push({
        code: 'UNKNOWN_ANNOTATION_TARGET',
        message: `Field set target type does not exist: ${target.raw}`,
        source: statement.source,
      });
      return;
    }

    for (const fieldName of target.fields) {
      const annotations = type.fieldAnnotations[fieldName] ?? {};
      annotations[annotation.key] = annotation.value ?? 'true';
      type.fieldAnnotations[fieldName] = annotations;
    }
  }
}
