import { describe, expect, it } from 'vitest';
import {
  atomicAmountSchema,
  atomicToUsdcString,
  formatAtomic,
  parseAtomic,
  usdcStringToAtomic,
} from '../src/index.js';

// T-001 (INV-022): money is integer atomic units, never floats.
describe('money', () => {
  it('parses decimal atomic strings into bigint', () => {
    expect(parseAtomic('0')).toBe(0n);
    expect(parseAtomic('50000')).toBe(50000n);
    expect(parseAtomic('123456789012345678901234567890')).toBe(123456789012345678901234567890n);
  });

  it.each([0.1, 50000, 5e4, NaN, Infinity, 10n, null, undefined, {}])('rejects non-string input %s', (bad) => {
    expect(() => parseAtomic(bad)).toThrow(TypeError);
  });

  it.each(['-1', '+1', '01', '1.5', '1e3', '0x10', ' 1', '1 ', '', '1_000'])('rejects malformed string %j', (bad) => {
    expect(() => parseAtomic(bad)).toThrow(TypeError);
    expect(atomicAmountSchema.safeParse(bad).success).toBe(false);
  });

  it('formats non-negative bigint and rejects negatives and non-bigint', () => {
    expect(formatAtomic(0n)).toBe('0');
    expect(formatAtomic(100000n)).toBe('100000');
    expect(() => formatAtomic(-1n)).toThrow(TypeError);
    expect(() => formatAtomic(5 as unknown as bigint)).toThrow(TypeError);
  });

  it('round-trips parse/format', () => {
    for (const s of ['0', '1', '10000', '99999999999999999999']) expect(formatAtomic(parseAtomic(s))).toBe(s);
  });

  it('converts to and from USDC display strings without floats', () => {
    expect(atomicToUsdcString(50000n)).toBe('0.05');
    expect(atomicToUsdcString('10000')).toBe('0.01');
    expect(atomicToUsdcString(1000000n)).toBe('1');
    expect(atomicToUsdcString(1n)).toBe('0.000001');
    expect(usdcStringToAtomic('0.05')).toBe(50000n);
    expect(usdcStringToAtomic('1')).toBe(1000000n);
    expect(usdcStringToAtomic('0.000001')).toBe(1n);
  });

  it.each(['0.0000001', '-1', '1e3', '.5', '1.', '01', 0.05 as unknown as string])('rejects USDC string %j', (bad) => {
    expect(() => usdcStringToAtomic(bad)).toThrow(TypeError);
  });
});
