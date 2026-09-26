/**
 * The public surface of the signer module. Buyer-gate and CLI code import from here only, never from `key.ts`.
 * Nothing exported here returns key material.
 */
export { createProtectedSigner, SignerRefusedError } from './guard.js';
export type { AttemptSigner, ProtectedSigner, SignerDeps, TypedDataRequest } from './guard.js';
export { payerPublicAddress, readWalletStatus } from './status.js';
export type { WalletStatus } from './status.js';
export type { KeyProvider } from './key.js';
