import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TRANSITIONS,
  ATTEMPT_STATUSES,
  ATTEMPT_TRANSITIONS,
  DECISION_TRANSITIONS,
  PERMIT_TRANSITIONS,
  POLICY_VERSION_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  assertTransition,
  canTransition,
  hashAuditPayload,
} from '../src/index.js';
import type { TransitionTable } from '../src/index.js';

/** Every ordered pair is either in the legal list (passes) or throws; the legal lists are exactly the SPEC section 11 tables. */
function exhaustive<S extends string>(name: string, table: TransitionTable<S>, legal: [S, S][]) {
  const states = Object.keys(table) as S[];
  const legalSet = new Set(legal.map(([a, b]) => `${a}>${b}`));
  for (const from of states) {
    for (const to of states) {
      const ok = from === to || legalSet.has(`${from}>${to}`);
      it(`${name}: ${from} -> ${to} is ${ok ? 'legal' : 'rejected'}`, () => {
        if (ok) expect(() => assertTransition(name, table, from, to)).not.toThrow();
        else expect(() => assertTransition(name, table, from, to)).toThrow(/illegal/);
      });
    }
  }
}

// T-020: every legal edge passes, every illegal edge throws.
describe('state machines (SPEC section 11)', () => {
  exhaustive('attempt', ATTEMPT_TRANSITIONS, [
    ['created', 'quoted'], ['created', 'failed'],
    ['quoted', 'screened'], ['quoted', 'decided'], ['quoted', 'failed'],
    ['screened', 'decided'], ['screened', 'failed'],
    ['decided', 'signed'], ['decided', 'awaiting_approval'], ['decided', 'failed'],
    ['awaiting_approval', 'decided'], ['awaiting_approval', 'failed'], ['awaiting_approval', 'expired'],
    ['signed', 'submitted'], ['signed', 'failed'],
    ['submitted', 'settled'], ['submitted', 'failed'], ['submitted', 'ambiguous'],
    ['ambiguous', 'settled'], ['ambiguous', 'failed'],
  ]);
  exhaustive('reservation', RESERVATION_TRANSITIONS, [
    ['reserved', 'committed'], ['reserved', 'released'], ['reserved', 'reconciling'],
    ['reconciling', 'committed'], ['reconciling', 'released'],
  ]);
  exhaustive('permit', PERMIT_TRANSITIONS, [['armed', 'consumed'], ['armed', 'revoked'], ['armed', 'expired']]);
  exhaustive('approval', APPROVAL_TRANSITIONS, [['active', 'consumed'], ['active', 'expired']]);
  exhaustive('decision', DECISION_TRANSITIONS, [['open', 'consumed'], ['open', 'expired'], ['open', 'superseded']]);
  exhaustive('policy version', POLICY_VERSION_TRANSITIONS, [
    ['draft', 'replayed'], ['replayed', 'approved'], ['approved', 'active'],
    ['active', 'superseded'], ['active', 'rolled_back'], ['superseded', 'active'],
  ]);

  it('covers every attempt status the schema knows', () => {
    expect(Object.keys(ATTEMPT_TRANSITIONS).sort()).toEqual([...ATTEMPT_STATUSES].sort());
  });

  it('a policy cannot skip replay: draft -> approved is illegal (INV-010)', () => {
    expect(canTransition(POLICY_VERSION_TRANSITIONS, 'draft', 'approved')).toBe(false);
    expect(canTransition(POLICY_VERSION_TRANSITIONS, 'draft', 'active')).toBe(false);
  });

  it('terminal states have no exits', () => {
    for (const s of ['settled', 'failed', 'expired'] as const) expect(ATTEMPT_TRANSITIONS[s]).toEqual([]);
    for (const s of ['committed', 'released'] as const) expect(RESERVATION_TRANSITIONS[s]).toEqual([]);
    expect(POLICY_VERSION_TRANSITIONS.rolled_back).toEqual([]);
  });
});

describe('audit payload hash', () => {
  it('is deterministic, key-order independent and tagged', () => {
    expect(hashAuditPayload({ a: 1, b: 2 })).toBe(hashAuditPayload({ b: 2, a: 1 }));
    expect(hashAuditPayload({ a: 1 })).not.toBe(hashAuditPayload({ a: 2 }));
    expect(hashAuditPayload({ a: 1 })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
