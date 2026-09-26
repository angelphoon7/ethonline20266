import { privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';

/**
 * The ONLY place PAYER_PRIVATE_KEY is read (INV-008). The value never leaves this module except inside the
 * viem account object, which is never exported from `public.ts`. Errors never contain the key.
 */
export type KeyProvider = () => `0x${string}`;

export const envKeyProvider: KeyProvider = () => {
  const raw = process.env.PAYER_PRIVATE_KEY?.trim();
  const hex = raw ? (raw.startsWith('0x') ? raw : `0x${raw}`) : '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('PAYER_PRIVATE_KEY is missing or malformed');
  return hex as `0x${string}`;
};

export function loadAccount(provider: KeyProvider = envKeyProvider): PrivateKeyAccount {
  return privateKeyToAccount(provider());
}
