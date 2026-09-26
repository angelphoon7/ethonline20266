# TEST_PLAN — Risksir

Governs how every `AC-xxx` and `INV-xxx` in `SPEC.md` is proven. Status words follow `CLAUDE.md` §8: `implemented` < `unit-tested` < `integration-tested` < `live-verified`. Nothing is "works", "done", "verified" or "settled" without the evidence named here.

## 1. Levels: what each proves and what it does not

| Level | Scope | Runs in | Proves | Does **not** prove |
| --- | --- | --- | --- | --- |
| L0 static | `tsc --noEmit`, eslint, static import/secret checks | `pnpm verify` | Types, lint, key isolation, engine purity by grep/import graph | Runtime behaviour |
| L1 unit | `packages/core`: money, canonical JSON, hashes, policy engine, regression engine | `pnpm verify` | Deterministic logic on typed inputs | Anything involving I/O, SDK or a real Intercepta response |
| L2 module | gate modules with in-memory or temp-file SQLite: signer, store/reservations, adapter with fixtures, policy lifecycle, owner API | `pnpm verify` | Each module's contract and failure paths | Cross-module wiring; the real x402 SDK against a real seller |
| L3 integration | local seller, **stubbed facilitator**, **recorded/synthetic Intercepta fixtures**, no network | `pnpm verify` | The full buyer→gate→signer→seller path and zero-signer matrix | That the real Intercepta or facilitator behave this way (fixtures are labelled `recorded`/`synthetic`, never `live`) |
| L4 live | `pnpm test:live`, gated by `LIVE=1`, within `[G §4]` and `[G §5]` | manual/agent only | Real Intercepta responses, a real 402, a real Base Sepolia settlement | Production readiness, mainnet behaviour, seller honesty |
| L5 demo smoke | `pnpm demo:smoke` (Scenes 2, 3, 5 live, then asserts) | manual/agent only | The demo path is reproducible end to end | Anything beyond the seeded scenario |
| L6 manual demo | `DEMO_RUNBOOK.md` checklist with the console | human | Legibility of the proof to a judge | Automated regressions |

## 2. Commands

| Command | Contents | Network |
| --- | --- | --- |
| `pnpm verify` | L0 + L1 + L2 + L3 (typecheck, lint, unit, module, integration, README/doc checks) | **none** (offline only) |
| `pnpm test:live` | L4; refuses to run unless `LIVE=1`; prints network, payer address (public), `payTo`, amount, count, max total, and aborts if a `[G §4]` limit would be exceeded | Intercepta, facilitator, Base Sepolia |
| `pnpm demo:smoke` | L5 | same as L4 |

Local fallback while plain `pnpm` is not on PATH: `corepack pnpm <script>` (ADR-014).

## 3. Test catalogue

IDs are stable; files are created by the milestone that owns them (`EXECUTION_PLAN.md`).

| ID | Level | Description |
| --- | --- | --- |
| T-001 | L1 | Money: bigint parse/format, rejects floats, negatives, leading zeros, non-decimal strings |
| T-002 | L1 | Canonical JSON: sorted keys at depth, rejects `undefined`/`bigint`/`NaN`; fixed hash vectors |
| T-003 | L1 | Quote hash changes for **each** of scheme, network, asset, amount, `payTo`, resource, attemptId, validity; address case does not change it |
| T-004 | L1 | Policy/dataset/report hash vectors; report hash ignores `generatedAt`/`reportId` |
| T-005 | L1 | Engine: each of PAY, CAP, HOLD, ASK_HUMAN, DENY reachable |
| T-006 | L1 | Engine step order 1–11 table-driven; hard prohibitions beat rules and approvals |
| T-007 | L1 | UNAVAILABLE and stale evidence ⇒ HOLD whatever the rules say |
| T-008 | L1 | CAP: amount ≤ cap eligible; amount > cap `signerEligible=false` with `CAP_BELOW_QUOTE` |
| T-009 | L1 | ASK_HUMAN pending not eligible; valid approval ⇒ PAY; wrong hash/version/expired/over-max ⇒ not eligible; evaluated only on a re-screen result |
| T-009a | L1 | `evaluateLocal` (stage A) returns DENY/HOLD for scheme, network, asset, cap, service and quote validity without evidence; `evaluate` runs stage A first; stage B with `evidence = null` fails closed |
| T-010 | L1 | Candidate validation rejects: default PAY/CAP, missing hard prohibition, missing `capAtomic`, changed network/asset, duplicate rule ids |
| T-011 | L0 | Static: `packages/core/src/{policy,regression}` reference no `Date`, `Math.random`, `fetch`, `process`, fs, db, or `apps/` import |
| T-012 | L1 | Regression: hand-computed dataset yields exact numerator/denominator for every metric in SPEC §13 |
| T-013 | L1 | `unknown` labels excluded from prevention/friction metrics, included in rate metrics only |
| T-014 | L1 | Determinism: same inputs ⇒ same `reportHash`; mutating one case/label changes metrics and hash |
| T-015 | L0 | Static: regression code has no import path to the signer or key |
| T-016 | L1 | Provenance survives zod parse and persistence round trip; relabel attempt is rejected |
| T-020 | L2 | Attempt/PolicyVersion/Reservation/Decision state machines: every legal edge passes, every illegal edge throws |
| T-021 | L2 | Reservation concurrency: parallel reservations from two DB connections never exceed the period cap |
| T-022 | L2 | Reservation lifecycle; ambiguous ⇒ `reconciling`, released only on confirmed non-settlement |
| T-023 | L2 | Signer: valid decision ⇒ exactly one signature, counter = 1, decision `consumed` |
| T-024 | L2 | Signer permit matrix, **one negative test per mismatch** (see §5): table A (primary type/types, `to`, `value`, `verifyingContract`, `chainId`, `from`, `validAfter`, `validBefore` too far / expired) and table B (no permit, unarmed, consumed, expired, another attempt's permit; decision missing/not open/not eligible/expired; evidence unusable or later than the decision; `decision.quoteHash != attempt.quoteHash`; `permit.quoteHash` mismatch; policy version changed; no reservation or amount mismatch; over authorised max / live limits; second use). Every case ends with `signerCalls = 0` and an untouched permit and decision |
| T-025 | L0 | Static code-path isolation (not a security boundary): `PAYER_PRIVATE_KEY` only in `apps/gate/src/signer/**`; agent/core/regression cannot import `signer` |
| T-026 | L2 | Redaction: logs never contain key, token, `X-API-KEY`, `Authorization`, full signature |
| T-027 | L2 | Adapter with fixtures: timeout, 500, 429, malformed, empty ⇒ matching `UNAVAILABLE` code; exactly one call (no retry) |
| T-028 | L2 | Raw response stored with timestamp, endpoint, address, provenance and **no headers** |
| T-029 | L2 | Lifecycle: approval requires matching report/candidate/dataset hash; stale approval invalid; atomic activation; rollback restores; one active pointer |
| T-030 | L2 | Owner API returns 401 without/with wrong token on **every** owner route |
| T-031 | L2 | Label revisions append-only; provenance present in API output |
| T-032 | L2 | Audit events emitted for each step in §5 of SPEC, in order |
| T-040 | L3 | Pass path: real local 402 → gate → PAY → one signature → stub facilitator settles; `interceptaReturnedAt < signerInvokedAt` |
| T-041 | L3 | Block path: BLOCK fixture ⇒ DENY, `signerCalls=0`, no signer timestamp |
| T-033 | L3 | `awaiting_approval` flow: ASK_HUMAN ⇒ attempt `awaiting_approval`, zero signer calls; a valid approval ⇒ current 402 with an identical quote ⇒ **fresh live screen** ⇒ re-evaluation under the current policy ⇒ sign only on `PAY`; a BLOCK on the re-screen is DENY despite the approval; a mutated resumed quote ⇒ `failed`; approval expiry, window expiry and a policy-version change ⇒ `expired` with zero signer calls; approval consumed on use |
| T-034 | L3 | Local stage first: wrong scheme/network/asset, cap, service and quote validity produce a Decision without evidence and **zero Intercepta calls**; an eligible quote makes exactly one call |
| T-035 | L2 | Spend ledger: `used` sums only `reserved`/`reconciling`/`committed` amounts; `released` frees budget; `committed` is not double counted; `remaining = cap − used` excludes the current attempt; the reservation transaction re-checks `used + amount ≤ cap` and a failure yields HOLD |
| T-036 | L2 | Permit lifecycle: armed by the gate only after a reservation; single use; expires with the decision; revoked and unusable after a policy change |
| T-037 | L3 | Permit-based signer with the installed x402 SDK: one valid signature settled by the (stub) facilitator; the same run live is the M-004b re-proof (AC-037) |
| T-042 | L3 | Intercepta timeout/429/500/malformed through the gate ⇒ HOLD, `signerCalls=0` |
| T-043 | L3 | Seller changes `payTo`/amount/asset/network between 402 and retry ⇒ zero signing |
| T-044 | L3 | Wrong network / wrong asset quote ⇒ DENY, zero signing, zero Intercepta calls (SDK controls on and off) |
| T-045 | L3 | Over per-payment cap and over period cap ⇒ zero signing |
| T-046 | L3 | Expired decision ⇒ zero signing |
| T-047 | L3 | Policy activated while an attempt is pending ⇒ zero signing, `POLICY_CHANGED` |
| T-048 | L3 | Stub facilitator loses the response ⇒ `ambiguous`, reservation `reconciling`, no second signature |
| T-049 | L3 | Settled but resource fails ⇒ settlement `settled`, delivery `not_received`, shown separately |
| T-050 | L3 | Loop: seed incident, ≥2 candidates replayed, approve, new attempt (fresh fixture screen) changes the decision; rollback restores v1 |
| T-051 | L3 | Layer 2: same evidence with a different amount / counterparty history / profile ⇒ different action |
| T-052 | L3 | Concurrent attempts through the gate cannot exceed the period cap |
| T-053 | L3 | Live-run guard aborts before signing when a `[G §4]` limit would be exceeded |
| T-054 | L2 | Console: signer badge, provenance badge, active version and settlement/delivery render from API data; no signer timestamp shown when not called |
| T-060 | L4 | Live Intercepta screens of `SELLER_PAY_TO_SAFE` and `SELLER_PAY_TO_RISKY`; raw files saved |
| T-061 | L4 | Live pass: real 402, one signature, Base Sepolia tx hash |
| T-062 | L4 | Live block: Intercepta-driven HOLD/DENY, log `signerCalls=0` |
| T-063 | L4 | Live v2: approved v2 changes a new attempt's decision with a fresh live screen |
| T-070 | L5 | `demo:smoke` end to end and assertions on the outputs |
| T-080 | L6 | Manual demo checklist |
| T-090 | L0 | Doc check: README names the Intercepta adapter, decision point, signer gate and regression engine files, contains setup/test steps and 3–5 lines of API feedback |

## 4. Traceability: AC → tests

| AC | Tests | Live evidence needed for `live-verified` |
| --- | --- | --- |
| AC-001 | T-040 | T-061 |
| AC-002 | T-040, T-054 | T-061 |
| AC-003 | T-040, T-054 | T-061/T-062 (timestamps) |
| AC-004 | T-023, T-040 | T-061 (tx hash) |
| AC-005 | T-041 | T-062 |
| AC-006 | T-041, T-054 | T-062 (`signerCalls=0`) |
| AC-007 | T-054, T-050 | — |
| AC-008 | T-050, T-054 | T-063 |
| AC-009 | T-031, T-050 | — |
| AC-010 | T-010, T-050 | — |
| AC-011 | T-012, T-014 | — |
| AC-012 | T-029, T-050 | T-063 |
| AC-013 | T-050 | T-063 |
| AC-014 | T-029, T-050 | T-063 |
| AC-015 | T-016, T-031, T-054 | — |
| AC-016 | T-090 | — |
| AC-017 | T-090 | — |
| AC-018 | T-090 | — |
| AC-019 | T-027, T-040 | T-060 |
| AC-020 | T-051 | T-063 |
| AC-021 | T-027, T-042 | T-062 (optional forced timeout) |
| AC-022 | T-003, T-024, T-033, T-043 | — |
| AC-023 | T-049, T-054 | T-061 |
| AC-024 | none (human: repo visibility) | human check |
| AC-025 | T-021, T-052 | — |
| AC-026 | T-025 | — |
| AC-027 | T-022, T-048 | — |
| AC-028 | T-030 | — |
| AC-029 | T-028 | T-060 |
| AC-030 | T-005 | — |
| AC-031 | T-009, T-024, T-033, T-036, T-047 | — |
| AC-033 | T-009, T-033 | — |
| AC-034 | T-024, T-036 | — |
| AC-035 | T-009a, T-034, T-044 | — |
| AC-036 | T-021, T-035, T-052 | — |
| AC-037 | T-037 | live re-run of a pass (tx hash, `signerCalls=1`) |
| AC-032 | T-014, T-015 | — |

## 5. Traceability: INV → tests (each with a negative test)

| INV | Positive | **Negative** (must fail closed) |
| --- | --- | --- |
| INV-001 | T-040 | Screen skipped or mocked out ⇒ gate refuses to proceed (T-042); signer ordering assertion in T-040; a Decision without evidence is never eligible (T-024, T-034) |
| INV-002 | T-023 | T-024 matrix, T-041–T-047, T-008 |
| INV-003 | T-040 | T-007, T-027, T-042; cached evidence from a previous attempt is rejected |
| INV-004 | T-023 | T-024: no permit, no decision, `decision.quoteHash != attempt.quoteHash`, expired, wrong version, no reservation, second use |
| INV-005 | T-003 | T-024 (each mutated field), T-043 |
| INV-006 | T-023 | T-024 wrong chain, wrong asset; T-044 |
| INV-007 | T-021, T-035 | T-024 over cap; T-035 reservation re-check fails at the cap; T-045, T-052 |
| INV-008 | T-025 | A fixture file that references the key outside `signer/` makes T-025 fail (self-test). Documented as code-path isolation, not a process boundary |
| INV-009 | T-009, T-040 | Decision without policy version, quote hash, action or reasons is rejected by schema; a Decision without evidence is rejected if `signerEligible` (T-034) |
| INV-010 | T-029 | Approve with a wrong report/candidate/dataset hash ⇒ 409, prior version stays; unauthenticated ⇒ 401 |
| INV-011 | T-029 | Attempt to edit an approved version ⇒ rejected; rollback creates a new transition |
| INV-012 | T-016, T-054 | Synthetic case rendered as `real_live` ⇒ schema/UI test fails |
| INV-013 | T-012, T-013, T-014 | Hard-coded metric would fail the mutate-dataset test |
| INV-014 | T-022, T-048, T-049 | Release on HTTP timeout alone is rejected |
| INV-015 | T-006, T-009 | Approval on a DENY/hard-prohibition case still not eligible |
| INV-016 | T-025, T-011 | Static: no LLM SDK import in gate/core; no route lets an unauthenticated caller approve |
| INV-017 | T-009, T-029, T-033 | T-024, T-036 and T-047: decision, approval or permit from the previous version cannot sign; an `awaiting_approval` attempt becomes `expired` (T-033) |
| INV-018 | T-026 | `guard-secrets.sh` blocks a staged secret value (manual check recorded in the milestone evidence) |
| INV-019 | T-040, T-054 | Signer invoked before evidence returned ⇒ attempt state machine throws |
| INV-020 | T-016, T-031 | Relabel/overwrite ⇒ rejected |
| INV-021 | T-027, T-028 | Non-GET or mutating endpoint URL rejected by the adapter; stored file has no headers |
| INV-022 | T-001 | Float/`number` amount rejected by schema |
| INV-023 | T-011, T-014 | Static grep fails if `Date.now`/`Math.random`/`fetch` enters the engines |
| INV-024 | T-023 | T-024: second signature for the same decision refused |
| INV-025 | T-029 | Two active pointers cannot be created (unique constraint) |
| INV-026 | T-030 | Every owner route without/with a wrong token ⇒ 401 |
| INV-027 | T-024, T-036 | One negative test per table A/B mismatch; second use of a permit refused |
| INV-028 | T-033 | Expired approval, wrong `attemptId`/`quoteHash`/`policyVersion`, mutated resumed quote, BLOCK on re-screen, non-`PAY` re-evaluation: none signs |
| INV-029 | T-009a, T-034 | A locally rejected quote triggers zero Intercepta calls |

## 6. Mandatory tests (from the bootstrap contract)

**Zero signer calls** (T-024 + T-041–T-047), one test per case: HOLD; DENY; pending ASK_HUMAN; CAP below quote; Intercepta timeout; Intercepta error; malformed response; 429; quote mutation after the decision (each field); wrong network; wrong asset; over the per-payment cap; over the period cap; expired decision; policy version changed while pending. **Exactly one** signer call for an approved PAY (T-023, T-040). **Concurrency** (T-021, T-052). **Key isolation** (T-025). **Replay determinism** and "metrics come from data" (T-014). **Promotion** requires an approval bound to the report hash; rollback restores the previous version; stale approvals are invalid (T-029). **Provenance labels** survive persistence and appear in API output (T-016, T-031).

## 7. Evidence standard for `live-verified`

A milestone or AC is `live-verified` only with **all** that apply, recorded in `EXECUTION_PLAN.md` and `HANDOFF.md`:

1. The path to the raw Intercepta response file (`fixtures/intercepta/recorded/…`) and its timestamp.
2. The Base Sepolia transaction hash for a settlement.
3. A log line showing `signerCalls=0` for a blocked attempt (and `signerCalls=1` for the paid one).
4. The live-run banner (network, payer public address, `payTo`, amount, count, max total) showing limits respected.

Fixtures, stubs and synthetic data are labelled as such and never counted as live evidence.

## CURRENT COVERAGE GAPS

**Conformance gap (human SPEC review 2026-09-26):** the code from M-000 to M-005 predates the corrected SPEC. Known contradictions: there is no signing permit object (the signer is bound by `authorise(decisionId)`; it does compare typed data with the attempt's stored quote, but permit arming, expiry, consumption and the permit-specific negative tests do not exist); every parseable quote is screened before local checks; `Decision.evidenceId` is required; there is no `awaiting_approval` or `expired` state and `ASK_HUMAN` ends the attempt as `failed`; the ledger sums `committedAtomic ?? amountAtomic` for committed rows where the SPEC says `amountAtomic`. Fix milestone: **M-004b**. T-033 to T-037 and T-009a are unimplemented until then.

Status after M-005 (2026-09-26): T-001 to T-016 (core), T-020 (partly), T-023 to T-028, T-030 (not yet: owner API), T-040 to T-049, T-052, T-053, T-060 to T-062 have been implemented (350 offline tests; T-061/T-062 as live CLI runs recorded in `docs/evidence/`). Still unimplemented: T-021/T-022 full (two-connection reservation test, chain reconciliation, M-006), T-029 to T-032 (lifecycle, owner API, audit, M-006/M-008), T-012 to T-015 regression (M-007), T-050/T-051 loop (M-008/M-010), T-054 console (M-009), T-063, T-070, T-090. Additionally:

- Intercepta: only scores 0 and 100 were observed live; the WARN band, 401/429/5xx and rate limits rest on labelled synthetic fixtures and stubbed fetch (never claimed as live).
- The facilitator failure modes (drop, 500, `success:false`) are exercised only through the stub; a single successful real settlement was observed.
- AC-024 (public repo) and Spike E (sponsor overlap) are human-verified only.
- The payer wallet is funded (19.94 test USDC); T-063 and T-070 wait for M-008 to M-011.
- The console (T-054) relies on component tests only; no browser end-to-end automation is planned.
