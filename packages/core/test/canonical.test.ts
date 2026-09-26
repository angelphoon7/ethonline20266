import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/index.js';

// T-002: canonical JSON.
describe('canonicalJson', () => {
  it('sorts keys at every depth and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('keeps array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('sorts keys by UTF-16 code unit', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, 'é': 4 })).toBe('{"B":2,"a":3,"b":1,"é":4}');
  });

  it('serialises null, booleans, strings and finite numbers', () => {
    expect(canonicalJson({ n: null, t: true, f: false, s: 'a"b', i: 7, d: 1.5 })).toBe(
      '{"d":1.5,"f":false,"i":7,"n":null,"s":"a\\"b","t":true}',
    );
  });

  it.each([
    ['undefined', undefined],
    ['nested undefined', { a: undefined }],
    ['bigint', 10n],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['function', () => 1],
    ['symbol', Symbol('x')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['sparse array hole', [1, , 3]], // eslint-disable-line no-sparse-arrays
  ])('rejects %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('accepts null-prototype objects', () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    expect(canonicalJson(o)).toBe('{"a":2,"b":1}');
  });
});
