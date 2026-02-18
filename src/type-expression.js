export function parseTypeExpression(source) {
  return parseUnion(source.trim());
}

export function parseConstraintList(source) {
  const chunk = source.trim();
  if (chunk === '') {
    return [];
  }

  return splitTopLevel(chunk, ',').map((part) => parseConstraint(part.trim()));
}

function parseUnion(source) {
  const parts = splitTopLevel(source, '|');
  if (parts.length > 1) {
    return {
      kind: 'union',
      members: parts.map((member) => parseIntersection(member.trim())),
      raw: source,
    };
  }

  return parseIntersection(source);
}

function parseIntersection(source) {
  const parts = splitTopLevel(source, '&');
  if (parts.length > 1) {
    return {
      kind: 'intersection',
      members: parts.map((member) => parsePostfix(member.trim())),
      raw: source,
    };
  }

  return parsePostfix(source);
}

function parsePostfix(source) {
  let current = source.trim();
  const arrayConstraints = [];
  let nullable = false;

  if (endsWithTopLevelNullable(current)) {
    nullable = true;
    current = current.slice(0, -1).trim();
  }

  while (current.endsWith(']')) {
    const openIndex = findOpeningBracketAtEnd(current, '[', ']');
    if (openIndex < 0) {
      break;
    }

    const constraintsChunk = current.slice(openIndex + 1, -1).trim();
    arrayConstraints.unshift(parseConstraintList(constraintsChunk));
    current = current.slice(0, openIndex).trim();
  }

  let atom = parseAtom(current);
  for (const constraints of arrayConstraints) {
    atom = {
      kind: 'array',
      itemType: atom,
      constraints,
      raw: source,
    };
  }

  if (nullable) {
    atom = {
      kind: 'nullable',
      inner: atom,
      raw: source,
    };
  }

  return atom;
}

function parseAtom(source) {
  const current = source.trim();

  if (current === '') {
    return { kind: 'unknown', raw: source };
  }

  if (isWrappedByOuterParens(current)) {
    return parseTypeExpression(current.slice(1, -1));
  }

  if (current.startsWith('{') && current.endsWith('}') && isBalanced(current)) {
    return parseRecord(current);
  }

  if (current.startsWith('dict<') && current.endsWith('>')) {
    return parseDict(current, '<', '>');
  }

  if (current.startsWith('dict{') && current.endsWith('}')) {
    return parseDict(current, '{', '}');
  }

  if (current.startsWith('when ')) {
    return parseConditional(current);
  }

  if (/^\?[A-Za-z_][A-Za-z0-9_]*$/.test(current)) {
    return {
      kind: 'nullableNamed',
      name: current.slice(1),
      constraints: [],
      raw: source,
    };
  }

  if (current === 'absent') {
    return { kind: 'absent', raw: source };
  }

  if (/^(true|false|null|-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(current)) {
    return {
      kind: 'literal',
      value: parseLiteral(current),
      raw: source,
    };
  }

  const named = parseNamed(current);
  if (named) {
    return named;
  }

  return { kind: 'raw', raw: source };
}

function parseNamed(source) {
  const match = source.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\(([^\s\S]*)\))?$/);
  if (match) {
    return {
      kind: 'named',
      name: match[1],
      constraints: parseConstraintList(match[2] ?? ''),
      raw: source,
    };
  }

  const nameOnly = source.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.+)\)$/s);
  if (nameOnly) {
    return {
      kind: 'named',
      name: nameOnly[1],
      constraints: parseConstraintList(nameOnly[2]),
      raw: source,
    };
  }

  const identifier = source.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
  if (identifier) {
    return {
      kind: 'named',
      name: source,
      constraints: [],
      raw: source,
    };
  }

  return null;
}

function parseRecord(source) {
  const inner = source.slice(1, -1).trim();
  const fields = [];

  if (inner !== '') {
    const fieldChunks = splitRecordChunks(inner);
    for (const fieldChunk of fieldChunks) {
      const field = parseFieldChunk(fieldChunk);
      if (field) {
        fields.push(field);
      }
    }
  }

  return {
    kind: 'record',
    fields,
    raw: source,
  };
}

function splitRecordChunks(inner) {
  const chunks = [];
  let start = 0;
  const state = createScanState();

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    advanceScanState(state, inner, i);

    if (!isTopLevelState(state)) {
      continue;
    }

    if (char === ',') {
      pushChunk(chunks, inner.slice(start, i));
      start = i + 1;
      continue;
    }

    if (char !== '\n') {
      continue;
    }

    const nextIndex = skipWhitespace(inner, i + 1);
    if (nextIndex >= inner.length) {
      continue;
    }

    if (!looksLikeFieldOrAnnotationStart(inner, nextIndex)) {
      continue;
    }

    pushChunk(chunks, inner.slice(start, i));
    start = nextIndex;
    i = nextIndex - 1;
  }

  pushChunk(chunks, inner.slice(start));
  return chunks;
}

function pushChunk(target, chunk) {
  const trimmed = chunk.trim();
  if (trimmed !== '') {
    target.push(trimmed);
  }
}

function skipWhitespace(input, start) {
  let i = start;
  while (i < input.length && /\s/.test(input[i])) {
    i++;
  }
  return i;
}

function looksLikeFieldOrAnnotationStart(input, index) {
  const rest = input.slice(index);
  if (rest.startsWith('@')) {
    return true;
  }

  return /^[A-Za-z_][A-Za-z0-9_]*\??\s*:/.test(rest);
}

function parseFieldChunk(source) {
  let current = source.trim();
  const annotations = [];

  while (current.startsWith('@')) {
    const match = current.match(/^@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s*=\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')))?\s*/);
    if (!match) {
      break;
    }

    annotations.push({
      key: match[1],
      value: match[2] ? parseLiteral(match[2]) : null,
    });

    current = current.slice(match[0].length).trim();
  }

  const separatorIndex = findTopLevelColon(current);
  if (separatorIndex < 0) {
    return null;
  }

  const nameChunk = current.slice(0, separatorIndex).trim();
  const valueChunk = current.slice(separatorIndex + 1).trim();

  const nameMatch = nameChunk.match(/^([A-Za-z_][A-Za-z0-9_]*)(\?)?$/);
  if (!nameMatch) {
    return null;
  }

  const defaultSplit = splitTopLevelByKeyword(valueChunk, 'default');
  const typeSource = defaultSplit.type.trim();

  return {
    name: nameMatch[1],
    optional: Boolean(nameMatch[2]),
    typeExpr: typeSource,
    type: parseTypeExpression(typeSource),
    defaultExpr: defaultSplit.defaultExpr,
    annotations,
  };
}

function parseDict(source, left, right) {
  const inner = source.slice(`dict${left}`.length, -1).trim();
  const delimiter = findTopLevelDelimiter(inner, ':', ',');
  if (delimiter < 0) {
    return { kind: 'raw', raw: source };
  }

  const keySource = inner.slice(0, delimiter).trim();
  const valueSource = inner.slice(delimiter + 1).trim();

  return {
    kind: 'dict',
    keyType: parseTypeExpression(keySource),
    valueType: parseTypeExpression(valueSource),
    raw: source,
  };
}

function parseConditional(source) {
  const thenIndex = findTopLevelKeyword(source, 'then');
  const elseIndex = findTopLevelKeyword(source, 'else');

  if (thenIndex < 0 || elseIndex < 0 || elseIndex < thenIndex) {
    return { kind: 'raw', raw: source };
  }

  const whenBody = source.slice('when'.length, thenIndex).trim();
  const thenBody = source.slice(thenIndex + 'then'.length, elseIndex).trim();
  const elseBody = source.slice(elseIndex + 'else'.length).trim();

  return {
    kind: 'conditional',
    condition: whenBody,
    thenType: parseTypeExpression(thenBody),
    elseType: parseTypeExpression(elseBody),
    raw: source,
  };
}

function parseConstraint(source) {
  const callMatch = source.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/s);
  if (callMatch) {
    return {
      name: callMatch[1],
      argument: null,
      callArgs: splitTopLevel(callMatch[2], ',').map((item) => item.trim()).filter(Boolean),
      raw: source,
    };
  }

  const namedArgMatch = source.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/s);
  if (namedArgMatch) {
    return {
      name: namedArgMatch[1],
      argument: parseLiteralOrRaw(namedArgMatch[2].trim()),
      callArgs: null,
      raw: source,
    };
  }

  return {
    name: source,
    argument: null,
    callArgs: null,
    raw: source,
  };
}

function parseLiteralOrRaw(value) {
  if (/^(true|false|null|-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(value)) {
    return parseLiteral(value);
  }

  return value;
}

function parseLiteral(literal) {
  if (literal === 'true') {
    return true;
  }

  if (literal === 'false') {
    return false;
  }

  if (literal === 'null') {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(literal)) {
    return Number(literal);
  }

  if ((literal.startsWith('"') && literal.endsWith('"')) || (literal.startsWith("'") && literal.endsWith("'"))) {
    return decodeStringLiteral(literal);
  }

  return literal;
}

function decodeStringLiteral(literal) {
  const quote = literal[0];
  let value = '';
  let escaped = false;

  for (let i = 1; i < literal.length - 1; i++) {
    const char = literal[i];

    if (escaped) {
      if (char === 'n') {
        value += '\n';
      } else if (char === 'r') {
        value += '\r';
      } else if (char === 't') {
        value += '\t';
      } else {
        value += char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    value += char;
  }

  if (literal[literal.length - 1] !== quote) {
    return literal;
  }

  return value;
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  const state = createScanState();

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    advanceScanState(state, source, i);

    if (char === delimiter && isTopLevelState(state)) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function findTopLevelDelimiter(source, primary, fallback) {
  const state = createScanState();

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    advanceScanState(state, source, i);

    if (!isTopLevelState(state)) {
      continue;
    }

    if (char === primary || char === fallback) {
      return i;
    }
  }

  return -1;
}

function findTopLevelColon(source) {
  return findTopLevelDelimiter(source, ':', ':');
}

function splitTopLevelByKeyword(source, keyword) {
  const index = findTopLevelKeyword(source, keyword);
  if (index < 0) {
    return { type: source, defaultExpr: null };
  }

  return {
    type: source.slice(0, index),
    defaultExpr: source.slice(index + keyword.length).trim() || null,
  };
}

function findTopLevelKeyword(source, keyword) {
  const state = createScanState();

  for (let i = 0; i < source.length; i++) {
    advanceScanState(state, source, i);

    if (!isTopLevelState(state)) {
      continue;
    }

    if (!source.startsWith(keyword, i)) {
      continue;
    }

    const before = source[i - 1] ?? ' ';
    const after = source[i + keyword.length] ?? ' ';

    if (isBoundary(before) && isBoundary(after)) {
      return i;
    }
  }

  return -1;
}

function isBoundary(char) {
  return /\s|[(){}\[\],.:|&?=]/.test(char);
}

function endsWithTopLevelNullable(source) {
  if (!source.endsWith('?')) {
    return false;
  }

  const state = createScanState();
  for (let i = 0; i < source.length - 1; i++) {
    advanceScanState(state, source, i);
  }

  return isTopLevelState(state);
}

function findOpeningBracketAtEnd(source, open, close) {
  let depth = 0;
  const state = createScanState();

  for (let i = source.length - 1; i >= 0; i--) {
    const char = source[i];

    if (!isTopLevelCharFromEnd(source, i)) {
      continue;
    }

    if (char === close) {
      depth++;
      continue;
    }

    if (char === open) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function isTopLevelCharFromEnd(source, index) {
  const state = createScanState();
  for (let i = 0; i <= index; i++) {
    advanceScanState(state, source, i);
  }

  return isTopLevelState(state);
}

function isWrappedByOuterParens(source) {
  if (!(source.startsWith('(') && source.endsWith(')'))) {
    return false;
  }

  const state = createScanState();
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    advanceScanState(state, source, i);

    if (i < source.length - 1 && isTopLevelState(state) && char === ')') {
      return false;
    }
  }

  return true;
}

function isBalanced(source) {
  const state = createScanState();
  for (let i = 0; i < source.length; i++) {
    advanceScanState(state, source, i);
  }

  return isTopLevelState(state);
}

function createScanState() {
  return {
    inSingleQuote: false,
    inDoubleQuote: false,
    inRegex: false,
    inLineComment: false,
    inBlockComment: false,
    escaped: false,
    braces: 0,
    parens: 0,
    brackets: 0,
    lastSignificant: '',
  };
}

function advanceScanState(state, source, index) {
  const char = source[index];
  const next = source[index + 1] ?? '';

  if (state.inLineComment) {
    if (char === '\n') {
      state.inLineComment = false;
    }
    return;
  }

  if (state.inBlockComment) {
    if (char === '*' && next === '/') {
      state.inBlockComment = false;
    }
    return;
  }

  if (state.inSingleQuote || state.inDoubleQuote || state.inRegex) {
    if (state.escaped) {
      state.escaped = false;
      return;
    }

    if (char === '\\') {
      state.escaped = true;
      return;
    }

    if (state.inSingleQuote && char === "'") {
      state.inSingleQuote = false;
      state.lastSignificant = 'literal';
      return;
    }

    if (state.inDoubleQuote && char === '"') {
      state.inDoubleQuote = false;
      state.lastSignificant = 'literal';
      return;
    }

    if (state.inRegex && char === '/') {
      state.inRegex = false;
      state.lastSignificant = 'literal';
      return;
    }

    return;
  }

  if (char === '/' && next === '/') {
    state.inLineComment = true;
    return;
  }

  if (char === '/' && next === '*') {
    state.inBlockComment = true;
    return;
  }

  if (char === "'") {
    state.inSingleQuote = true;
    return;
  }

  if (char === '"') {
    state.inDoubleQuote = true;
    return;
  }

  if (char === '/' && regexCanStartAfter(state.lastSignificant)) {
    state.inRegex = true;
    return;
  }

  if (char === '{') {
    state.braces++;
  } else if (char === '}') {
    state.braces = Math.max(0, state.braces - 1);
  } else if (char === '(') {
    state.parens++;
  } else if (char === ')') {
    state.parens = Math.max(0, state.parens - 1);
  } else if (char === '[') {
    state.brackets++;
  } else if (char === ']') {
    state.brackets = Math.max(0, state.brackets - 1);
  }

  if (!/\s/.test(char)) {
    state.lastSignificant = char;
  }
}

function regexCanStartAfter(lastSignificant) {
  return (
    lastSignificant === '' ||
    lastSignificant === '(' ||
    lastSignificant === '[' ||
    lastSignificant === '{' ||
    lastSignificant === ':' ||
    lastSignificant === ',' ||
    lastSignificant === '=' ||
    lastSignificant === '|' ||
    lastSignificant === '&' ||
    lastSignificant === '!' ||
    lastSignificant === '?' ||
    lastSignificant === '+' ||
    lastSignificant === '-' ||
    lastSignificant === '*' ||
    lastSignificant === '<' ||
    lastSignificant === '>'
  );
}

function isTopLevelState(state) {
  return (
    !state.inSingleQuote &&
    !state.inDoubleQuote &&
    !state.inRegex &&
    !state.inLineComment &&
    !state.inBlockComment &&
    state.braces === 0 &&
    state.parens === 0 &&
    state.brackets === 0
  );
}
