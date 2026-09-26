/**
 * Canonical JSON (SPEC section 8): UTF-8 text, object keys sorted by UTF-16 code unit at every depth,
 * no whitespace, arrays keep their order. Rejects `undefined`, `bigint`, non-finite numbers, functions,
 * symbols and any non-plain object (Date, Map, class instances) so hashes cannot depend on hidden state.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? serializeArray(value, path) : serializeObject(value, path);
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

function serializeArray(items: unknown[], path: string): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    parts.push(serialize(items[i], `${path}[${i}]`));
  }
  return `[${parts.join(',')}]`;
}

function serializeObject(obj: object, path: string): string {
  const proto: unknown = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalJson: non-plain object at ${path}`);
  }
  const record = obj as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    parts.push(`${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`)}`);
  }
  return `{${parts.join(',')}}`;
}
