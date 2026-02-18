export class SchemaInfoRenderer {
  render(repository, schemaPath = '', showBuiltins = false) {
    const lines = [];

    if (schemaPath) {
      lines.push(`Schema: ${schemaPath}`);
    }

    lines.push(`Version: ${repository.effectiveVersion()}`);
    lines.push('');

    const documents = repository.documents();
    lines.push(`Documents: ${documents.length}`);
    for (const document of documents) {
      lines.push(`- ${document.path}`);
      if (document.includes.length > 0) {
        lines.push(`  includes: ${document.includes.join(', ')}`);
      }
    }

    lines.push('');

    const types = showBuiltins
      ? repository.types()
      : repository.customTypes();

    lines.push(`Types: ${types.length}`);
    for (const type of types) {
      const prefix = type.isBuiltin ? '[builtin] ' : '';
      lines.push(`- ${prefix}${type.name}: ${type.exprText ?? type.expr.raw ?? type.expr.kind}`);
    }

    lines.push('');

    const validators = showBuiltins
      ? repository.validators()
      : repository.validators().filter((validator) => !validator.isBuiltin);

    lines.push(`Validators: ${validators.length}`);
    for (const validator of validators) {
      lines.push(`- ${validator.targetType}(${validator.name})`);
    }

    const warnings = repository.warnings();
    if (warnings.length > 0) {
      lines.push('');
      lines.push(`Warnings: ${warnings.length}`);
      for (const warning of warnings) {
        lines.push(`- [${warning.code}] ${warning.message}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}
