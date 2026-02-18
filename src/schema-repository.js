import { parseTypeExpression } from './type-expression.js';

export class SchemaRepository {
  constructor({
    types,
    validators,
    documents,
    warnings,
    effectiveVersion,
    builtinTypes,
    builtinValidators,
  }) {
    this._customTypes = new Map(types);
    this._customValidators = new Map(validators);
    this._documents = [...documents];
    this._warnings = [...warnings];
    this._effectiveVersion = effectiveVersion ?? '1.0.0';

    this._builtinTypes = builtinTypes ?? defaultBuiltinTypes();
    this._builtinValidators = builtinValidators ?? defaultBuiltinValidators();

    this._allTypes = new Map([...this._builtinTypes.entries(), ...this._customTypes.entries()]);
    this._allValidators = new Map([...this._builtinValidators.entries(), ...this._customValidators.entries()]);
  }

  getType(name) {
    return this._allTypes.get(name) ?? null;
  }

  types() {
    return [...this._allTypes.values()];
  }

  customTypes() {
    return [...this._customTypes.values()];
  }

  getValidator(targetType, name) {
    return this._allValidators.get(validatorKey(targetType, name)) ?? null;
  }

  validators() {
    return [...this._allValidators.values()];
  }

  validatorsForType(targetType) {
    return this.validators().filter((validator) => validator.targetType === targetType);
  }

  documents() {
    return [...this._documents];
  }

  warnings() {
    return [...this._warnings];
  }

  effectiveVersion() {
    return this._effectiveVersion;
  }

  supportedRfcVersions() {
    return ['0.14.2'];
  }

  resolveRootType(preferredType = null) {
    if (preferredType) {
      const exists = this.getType(preferredType);
      if (!exists) {
        throw new Error(`Root type "${preferredType}" does not exist.`);
      }
      return preferredType;
    }

    if (this._customTypes.has('Root')) {
      return 'Root';
    }

    if (this._customTypes.size === 1) {
      return [...this._customTypes.keys()][0];
    }

    const names = [...this._customTypes.keys()].sort();
    throw new Error(
      `Root type is ambiguous. Provide --type. Available types: ${names.length > 0 ? names.join(', ') : '(none)'}.`,
    );
  }

  static isBuiltinTypeName(name, repository = null) {
    if (repository instanceof SchemaRepository) {
      const type = repository.getType(name);
      return Boolean(type?.isBuiltin);
    }

    return defaultBuiltinTypes().has(name);
  }

  static isBuiltinValidatorName(targetType, name, repository = null) {
    if (repository instanceof SchemaRepository) {
      const validator = repository.getValidator(targetType, name);
      return Boolean(validator?.isBuiltin);
    }

    return defaultBuiltinValidators().has(validatorKey(targetType, name));
  }
}

function validatorKey(targetType, name) {
  return `${targetType}:${name}`;
}

function defaultBuiltinTypes() {
  return new Map([
    ['Int', createBuiltinType('Int', (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)],
    ['Uint', createBuiltinType('Uint', (value) => Number.isInteger(value) && value >= 0 && value <= 4294967295)],
    ['Short', createBuiltinType('Short', (value) => Number.isInteger(value) && value >= -32768 && value <= 32767)],
    ['Ushort', createBuiltinType('Ushort', (value) => Number.isInteger(value) && value >= 0 && value <= 65535)],
    ['Long', createBuiltinType('Long', (value) => Number.isInteger(value))],
    ['Ulong', createBuiltinType('Ulong', (value) => Number.isInteger(value) && value >= 0)],
    ['Byte', createBuiltinType('Byte', (value) => Number.isInteger(value) && value >= -128 && value <= 127)],
    ['Ubyte', createBuiltinType('Ubyte', (value) => Number.isInteger(value) && value >= 0 && value <= 255)],
    ['Float', createBuiltinType('Float', (value) => typeof value === 'number' && Number.isFinite(value))],
    ['Double', createBuiltinType('Double', (value) => typeof value === 'number' && Number.isFinite(value))],
    ['Decimal', createBuiltinType('Decimal', (value) => typeof value === 'number' && Number.isFinite(value))],
    ['String', createBuiltinType('String', (value) => typeof value === 'string')],
    ['Url', createBuiltinType('Url', (value) => typeof value === 'string' && /^https?:\/\//i.test(value))],
    ['Email', createBuiltinType('Email', (value) => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))],
    ['Uuid', createBuiltinType('Uuid', (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))],
    ['Base64', createBuiltinType('Base64', (value) => typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))],
    ['Date', createBuiltinType('Date', (value) => typeof value === 'string')],
    ['DateTime', createBuiltinType('DateTime', (value) => typeof value === 'string')],
    ['Time', createBuiltinType('Time', (value) => typeof value === 'string')],
    ['Duration', createBuiltinType('Duration', (value) => typeof value === 'string' || typeof value === 'number')],
    ['Ip', createBuiltinType('Ip', (value) => typeof value === 'string')],
    ['IpV4', createBuiltinType('IpV4', (value) => typeof value === 'string' && /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value))],
    ['IpV6', createBuiltinType('IpV6', (value) => typeof value === 'string' && value.includes(':'))],
    ['Bool', createBuiltinType('Bool', (value) => typeof value === 'boolean')],
    ['True', createBuiltinType('True', (value) => value === true)],
    ['False', createBuiltinType('False', (value) => value === false)],
    ['Null', createBuiltinType('Null', (value) => value === null)],
    ['Binary', createBuiltinType('Binary', (value) => typeof value === 'string')],
    ['Any', createBuiltinType('Any', () => true)],
    ['Array', createBuiltinType('Array', (value) => Array.isArray(value))],
  ]);
}

function defaultBuiltinValidators() {
  const validators = new Map();

  const rangeTypes = ['Int', 'Uint', 'Short', 'Ushort', 'Long', 'Ulong', 'Byte', 'Ubyte', 'Float', 'Double', 'Decimal'];
  for (const typeName of rangeTypes) {
    validators.set(validatorKey(typeName, 'min'), createBuiltinValidator(typeName, 'min', true, (value, arg) => value >= numberArg(arg)));
    validators.set(validatorKey(typeName, 'max'), createBuiltinValidator(typeName, 'max', true, (value, arg) => value <= numberArg(arg)));
    validators.set(validatorKey(typeName, 'less'), createBuiltinValidator(typeName, 'less', true, (value, arg) => value < numberArg(arg)));
    validators.set(validatorKey(typeName, 'greater'), createBuiltinValidator(typeName, 'greater', true, (value, arg) => value > numberArg(arg)));
    validators.set(validatorKey(typeName, 'odd'), createBuiltinValidator(typeName, 'odd', false, (value) => Number.isInteger(value) ? Math.abs(value % 2) === 1 : null));
    validators.set(validatorKey(typeName, 'even'), createBuiltinValidator(typeName, 'even', false, (value) => Number.isInteger(value) ? value % 2 === 0 : null));
  }

  validators.set(validatorKey('Array', 'min'), createBuiltinValidator('Array', 'min', true, (value, arg) => Array.isArray(value) && value.length >= numberArg(arg)));
  validators.set(validatorKey('Array', 'max'), createBuiltinValidator('Array', 'max', true, (value, arg) => Array.isArray(value) && value.length <= numberArg(arg)));

  validators.set(validatorKey('String', 'min'), createBuiltinValidator('String', 'min', true, (value, arg) => typeof value === 'string' && value.length >= numberArg(arg)));
  validators.set(validatorKey('String', 'max'), createBuiltinValidator('String', 'max', true, (value, arg) => typeof value === 'string' && value.length <= numberArg(arg)));
  validators.set(validatorKey('String', 'regex'), createBuiltinValidator('String', 'regex', true, (value, arg) => {
    if (typeof value !== 'string') {
      return false;
    }

    const source = String(arg ?? '').replace(/^\//, '').replace(/\/$/, '');
    return new RegExp(source).test(value);
  }));

  return validators;
}

function createBuiltinType(name, matcher) {
  return {
    kind: 'builtinType',
    isBuiltin: true,
    name,
    expr: parseTypeExpression(name),
    annotations: new Map(),
    fieldAnnotations: new Map(),
    origins: [],
    matches: matcher,
  };
}

function createBuiltinValidator(targetType, name, requiresArgument, evaluator) {
  return {
    kind: 'builtinValidator',
    isBuiltin: true,
    targetType,
    name,
    requiresArgument,
    params: [],
    body: null,
    annotations: new Map(),
    origins: [],
    evaluate: evaluator,
  };
}

function numberArg(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
