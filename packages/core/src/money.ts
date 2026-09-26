import { z } from 'zod';

/** USDC has 6 decimals: 0.01 USDC = 10000 atomic units. */
export const USDC_DECIMALS = 6;

const ATOMIC_RE = /^(0|[1-9][0-9]*)$/;
const SIGNED_INT_RE = /^-?(0|[1-9][0-9]*)$/;

/** Money on the wire: a decimal string of atomic units, no sign, no leading zeros (INV-022). */
export const atomicAmountSchema = z.string().regex(ATOMIC_RE, 'atomic amount must be a non-negative decimal integer string without leading zeros');
export type AtomicAmount = z.infer<typeof atomicAmountSchema>;

/** Signed integer string, used only for metric numerators such as `human_reviews_added`. */
export const signedIntegerStringSchema = z.string().regex(SIGNED_INT_RE, 'must be a decimal integer string');

/** Parse an atomic amount. Only decimal strings are accepted: numbers (floats included) and bigint are rejected. */
export function parseAtomic(value: unknown): bigint {
  if (typeof value !== 'string' || !ATOMIC_RE.test(value)) {
    throw new TypeError('atomic amount must be a non-negative decimal integer string without leading zeros');
  }
  return BigInt(value);
}

/** Format a non-negative bigint as the wire representation. */
export function formatAtomic(value: bigint): AtomicAmount {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError('atomic amount must be a non-negative bigint');
  }
  return value.toString(10);
}

/** Display helper only: `50000` -> `"0.05"`. Never used for arithmetic. */
export function atomicToUsdcString(value: bigint | string): string {
  const v = typeof value === 'bigint' ? value : parseAtomic(value);
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return frac === '' ? whole.toString() : `${whole}.${frac}`;
}

/** Parse a decimal USDC string such as `"0.05"` into atomic units. Rejects numbers, signs, exponents and > 6 decimals. */
export function usdcStringToAtomic(value: unknown): bigint {
  if (typeof value !== 'string') throw new TypeError('USDC amount must be a decimal string');
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value);
  if (!m) throw new TypeError('USDC amount must be a plain decimal with at most 6 fractional digits');
  const whole = BigInt(m[1] as string);
  const frac = BigInt((m[2] ?? '').padEnd(USDC_DECIMALS, '0') || '0');
  return whole * 10n ** BigInt(USDC_DECIMALS) + frac;
}
