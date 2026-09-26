import type { AttemptStatus } from './types.js';

/**
 * State machines from SPEC section 11. Illegal transitions throw and are never persisted. A transition to the same
 * state is allowed (idempotent saves of other fields).
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const ATTEMPT_TRANSITIONS: TransitionTable<AttemptStatus> = {
  created: ['quoted', 'failed'],
  quoted: ['screened', 'decided', 'failed'], // decided directly on a local-stage rejection (no screen)
  screened: ['decided', 'failed'],
  decided: ['signed', 'awaiting_approval', 'failed'],
  awaiting_approval: ['decided', 'awaiting_approval', 'failed', 'expired'],
  signed: ['submitted', 'failed'],
  submitted: ['settled', 'failed', 'ambiguous'],
  ambiguous: ['settled', 'failed'],
  settled: [],
  failed: [],
  expired: [],
};

export type ReservationStatus = 'reserved' | 'committed' | 'released' | 'reconciling';
export const RESERVATION_TRANSITIONS: TransitionTable<ReservationStatus> = {
  reserved: ['committed', 'released', 'reconciling'],
  reconciling: ['committed', 'released'],
  committed: [],
  released: [],
};

export type DecisionStatus = 'open' | 'consumed' | 'expired' | 'superseded';
export const DECISION_TRANSITIONS: TransitionTable<DecisionStatus> = {
  open: ['consumed', 'expired', 'superseded'],
  consumed: [],
  expired: [],
  superseded: [],
};

export type PermitStatus = 'armed' | 'consumed' | 'revoked' | 'expired';
export const PERMIT_TRANSITIONS: TransitionTable<PermitStatus> = {
  armed: ['consumed', 'revoked', 'expired'],
  consumed: [],
  revoked: [],
  expired: [],
};

export type ApprovalStatus = 'active' | 'consumed' | 'expired';
export const APPROVAL_TRANSITIONS: TransitionTable<ApprovalStatus> = {
  active: ['consumed', 'expired'],
  consumed: [],
  expired: [],
};

export type PolicyVersionStatus = 'draft' | 'replayed' | 'approved' | 'active' | 'superseded' | 'rolled_back';
/** `superseded -> active` exists only as a rollback target and is logged as a new pointer transition (INV-011). */
export const POLICY_VERSION_TRANSITIONS: TransitionTable<PolicyVersionStatus> = {
  draft: ['replayed'],
  replayed: ['approved'],
  approved: ['active'],
  active: ['superseded', 'rolled_back'],
  superseded: ['active'],
  rolled_back: [],
};

export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return from === to || table[from].includes(to);
}

export function assertTransition<S extends string>(name: string, table: TransitionTable<S>, from: S, to: S): void {
  if (!canTransition(table, from, to)) throw new Error(`illegal ${name} transition ${from} -> ${to}`);
}
