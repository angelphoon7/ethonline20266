# EXECUTION_PLAN — Risksir

Status vocabulary: `TODO | IN_PROGRESS | BLOCKED | VERIFIED`. Evidence words: `implemented < unit-tested < integration-tested < live-verified`. A milestone is `VERIFIED` only with the evidence its Validation section requires (`TEST_PLAN.md` §7 for live ones). `M-005` and `M-010` are never `VERIFIED` without live evidence.

Local command note: plain `pnpm` is not on PATH on this machine, so commands are written `pnpm …` and run as `corepack pnpm …` (ADR-014).

**Human SPEC review applied 2026-09-26 (ADR-019 to ADR-024).** The code from M-000 to M-005 predates the corrected SPEC, so fix milestone **M-004b** is added and M-006 onward depend on it. M-004 and M-005 stay `VERIFIED`: their live evidence is real for the pre-review implementation, and M-004b re-proves the corrected signer.

Refinements to the bootstrap skeleton (dependency order kept, prize path first):
- **M-004** introduces a minimal SQLite `store` (attempts, evidence, decisions, reservations behind interfaces) because the signer must check a *stored* decision and reservation (INV-004). **M-006** extends the same store (cases, policies, audit, concurrency proof, reconciliation).
- **M-007** is a hard dependency of **M-008** (a candidate approval needs a report) and **M-009** is a dependency of **M-010/M-011** (the demo needs the console); both are added to the critical path below.

---

# M-000 — Scaffold
Status: VERIFIED
Needs credentials: none
## Objective
pnpm workspace, TypeScript strict ESM, vitest, minimal eslint, green `pnpm verify`, CI running it, minimal README, `AGENTS.md`.
## Why (SPEC / AC / INV references)
SPEC §6 module map; `CLAUDE.md` §7; AC-016 (README base); INV-018 (secret hygiene stays intact).
## Dependencies
none
## Scope
Root `package.json` (`packageManager` pinned to the detected pnpm), `pnpm-workspace.yaml`, `tsconfig.base.json`, workspaces `packages/core`, `apps/gate`, `apps/seller`, `apps/console` (stubs that typecheck), vitest + eslint config, root scripts `verify`, `test`, `typecheck`, `lint`, `test:live` (refuses without `LIVE=1`), `demo:smoke` (placeholder that fails loudly until M-011), `.github/workflows/ci.yml` running `pnpm verify`, minimal `README.md`, `AGENTS.md`, `.gitattributes` (`*.sh text eol=lf`), `fixtures/` skeleton with `.gitkeep`.
## Out of scope
Any product logic.
## Likely components
Root config, `packages/core`, `apps/*` empty shells.
## Acceptance (AC-xxx, INV-xxx)
AC-016 (partial); INV-018.
## Validation (exact commands and evidence required)
`corepack pnpm install`, `corepack pnpm verify` green, `corepack pnpm test:live` exits non-zero without `LIVE=1`, `bash scripts/env-status.sh`. Evidence: command output summary.
## Commit boundary
One commit: `feat(repo): scaffold pnpm workspace with green verify and CI`.
## Evidence (filled in when VERIFIED)
Level: integration-tested (offline). 2026-09-26: `corepack pnpm install` ok (pnpm 12.6.0); `corepack pnpm verify` = `tsc --noEmit` + `eslint .` + `vitest run` green (2 files, 4 tests). `test:live` exits 1 without `LIVE=1` and exits 1 with `LIVE=1` (no live tests yet); `demo:smoke` exits 1 by design. `bash scripts/env-status.sh` shows all names SET. TypeScript pinned to ~6.0.3 (ADR-016). CI file `.github/workflows/ci.yml` added.

CI follow-up (2026-09-26, AC-016 / INV-018): [run 36245757448](https://github.com/angelphoon7/ethonline20266/actions/runs/36245757448) for `a97e48b` failed at `pnpm install --frozen-lockfile`, before verification. An isolated export reproduced `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`; replacing the unresolved `allowBuilds.esbuild` placeholder with `true` fixes installation. Continuing verification exposed `no-undef` for `URL` in `scripts/live-guard.mjs`, fixed with an explicit `node:url` import. The snapshot plus both fixes passes `CI=true corepack pnpm install --frozen-lockfile --offline` and `corepack pnpm verify` (11 files, 265 tests); the lockfile is unchanged. Concurrent M-004 changes were excluded from this local verification. Both fixes were subsequently included in the concurrent task's pushed commit `f5a956a`. GitHub [run 36247203846](https://github.com/angelphoon7/ethonline20266/actions/runs/36247203846) completed successfully: frozen installation and `pnpm verify` both passed on Ubuntu.

# M-001 — Core domain
Status: VERIFIED
Needs credentials: none
## Objective
zod types and inferred TS types for SPEC §7, money units, canonical JSON, the single fingerprint helper, provenance labels.
## Why (SPEC / AC / INV references)
SPEC §7, §8; AC-015; INV-005, INV-020, INV-022.
## Dependencies
M-000
## Scope
`packages/core/src/{types,money,canonical,fingerprint,provenance}.ts`; fixed hash vectors; tests T-001, T-002, T-003, T-004 (hash parts), T-016.
## Out of scope
Policy and regression logic; I/O.
## Likely components
`packages/core`.
## Acceptance (AC-xxx, INV-xxx)
AC-015, AC-022 (hash part); INV-005, INV-020, INV-022.
## Validation (exact commands and evidence required)
`pnpm --filter @risksir/core test`, then `pnpm verify` green. Evidence: test names passing.
## Commit boundary
`feat(core): add domain types, money, canonical quote fingerprint and provenance labels`.
## Evidence (filled in when VERIFIED)
Level: unit-tested. 2026-09-26: `corepack pnpm verify` green (tsc + eslint + vitest): 6 files, 102 tests. T-001 (money), T-002 (canonical JSON), T-003 (quote hash changes per field; golden vector `0xc2998300…fca9c` equals an independently built tag + canonical string), T-004 (policy/dataset/report hashes; report hash ignores `reportId`/`generatedAt`), T-016 (provenance survives parse/JSON round trip, relabel rejected, non-live evidence rejected in a `real_live` case, label revisions append-only). zod 4.6.5. Schema refinements also enforce INV-019 (signer timestamp after Intercepta return), INV-009 (decision completeness), INV-002 (HOLD/DENY/ASK_HUMAN never eligible), INV-015 (complete hard-prohibition set).

# M-002 — Deterministic policy engine v1
Status: VERIFIED
Needs credentials: none
## Objective
Pure `evaluate()` with the five actions, fail-closed, reason codes, candidate validation, profile schema; tiers provisional (ADR-007).
## Why (SPEC / AC / INV references)
SPEC §9; AC-007, AC-020, AC-030; INV-002, INV-003, INV-009, INV-015, INV-023.
## Dependencies
M-001
## Scope
`packages/core/src/policy`; the demo policy v1 and candidates A/B/C from Appendix A as typed data; tests T-005…T-011 (tests first for the fail-closed and hard-prohibition rows).
## Out of scope
Intercepta, signing, persistence.
## Likely components
`packages/core/src/policy`.
## Acceptance (AC-xxx, INV-xxx)
AC-007 (data), AC-020 (engine part), AC-030; INV-002, INV-003, INV-009, INV-015, INV-023.
## Validation (exact commands and evidence required)
`pnpm --filter @risksir/core test` and `pnpm verify` green; T-011 static purity check passes.
## Commit boundary
`feat(policy): add deterministic five-action policy engine with fail-closed evidence handling`.
## Evidence (filled in when VERIFIED)
Level: unit-tested. 2026-09-26: `corepack pnpm verify` green: 9 files, 228 tests. `packages/core/src/policy/{evaluate,candidate,demo}.ts`. T-005 (five actions reachable), T-006 (steps 1–11 table + precedence + hard prohibitions beat a catch-all PAY rule), T-007 (UNAVAILABLE ×6 codes, stale, future timestamp, wrong-address evidence ⇒ HOLD; `evaluateFailClosed` ⇒ `ENGINE_ERROR`), T-008 (CAP eligible ≤ cap, `CAP_BELOW_QUOTE` above), T-009 (approval valid ⇒ PAY; wrong hash/version/expired/over-max/wrong attempt ⇒ not eligible; approval never overrides hard prohibitions), T-010 (candidate validation), T-011 (static purity: no Date.now/new Date/Math.random/fetch/process/node builtins/signer API in `policy` and `regression`), AC-020 engine part (same CLEAR evidence: v1 PAY, A HOLD, B CAP below quote, C ASK_HUMAN). Mutation check: disabling the UNAVAILABLE check made 8 tests fail, restored afterwards. Evidence tiers remain provisional (ADR-007).

# M-003 — SPIKE A (P0): Intercepta adapter and live semantics
Status: VERIFIED
Needs credentials: `INTERCEPTA_API_KEY`, `INTERCEPTA_BASE_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`
## Objective
Adapter for the read-only address screen; live screen of the SAFE and RISKY `payTo`; record raw responses; finalise the evidence mapping from **observed** fields.
## Why (SPEC / AC / INV references)
SPEC §10, Q-001/Q-002/Q-011; 08 §11 P0 row 1, Step 9 item 1; AC-019, AC-021, AC-029; INV-001, INV-003, INV-021.
## Dependencies
M-001, M-002
## Scope
`apps/gate/src/intercepta` (client with `X-API-KEY`, timeout, zod parse, raw capture, no retry, header-free storage, redaction), synthetic fixtures under `fixtures/intercepta/synthetic/`, ≤ 40 live calls, the L2 tests T-027/T-028, the live check T-060, `docs/spikes/SPIKE_A_INTERCEPTA.md` (goal, commands, raw evidence paths, observed result, 07 §22 kill-condition check, SPEC OPEN items resolved with ADR IDs), an ADR for the tier mapping, SPEC §10 updated.
## Out of scope
x402, signing, policy changes beyond the mapping.
## Likely components
`apps/gate/src/intercepta`, `fixtures/intercepta/**`, `docs/spikes`.
## Acceptance (AC-xxx, INV-xxx)
AC-019 (address screened), AC-021 (adapter part), AC-029; INV-003, INV-021.
## Validation (exact commands and evidence required)
`pnpm verify` green; `LIVE=1 pnpm test:live -- intercepta` prints `INTERCEPTA calls used: n/40`. Evidence: raw response file paths and timestamps for SAFE and RISKY, plus a note on whether the RISKY subject can be tied to a quote `payTo` (Q-003). Stop with `HUMAN_REQUIRED` on a 07 §22 kill condition or on 429/quota.
## Commit boundary
`feat(intercepta): add live address-screen adapter and record Spike A evidence` (recorded fixtures committed; no headers, no key).
## Evidence (filled in when VERIFIED)
Level: live-verified for the address screen (adapter path only; not yet in a payment flow). 2026-09-26, 4 of 40 live calls.
- Raw responses (`real_live`, no headers): `fixtures/intercepta/recorded/2026-09-26T13-33-52-198Z_0x87cff22e…cb1a.json` (SAFE: HTTP 200, 1336 ms, `toxicScore 0`, `traits []`), `…13-33-55-020Z_0x39308ae4…2fed.json` (RISKY: HTTP 200, 2814 ms, `toxicScore 100`, `known_scammer` 100, `attack_money_target` 85), plus a second identical pair from T-060 at `13-35-25-957Z` / `13-35-26-286Z`.
- `LIVE=1 corepack pnpm test:live` passed (T-060: SAFE ⇒ CLEAR, RISKY ⇒ BLOCK through the production adapter and mapper). `corepack pnpm verify` green: 11 files, 265 tests (T-027, T-028, mapper tests on the recorded files).
- Mapping `quickscan-v1` (ADR-017; thresholds are Risksir policy thresholds, not Intercepta verdicts). `docs/spikes/SPIKE_A_INTERCEPTA.md` written; SPEC §10/§25 updated. **After the 2026-09-26 evidence gate (ADR-023): Q-002 resolved; Q-001 only partly resolved (shape at scores 0 and 100); mid band, WARN, the 80 threshold, `txsCount`, error codes and rate limits are OPEN.** Kill-condition check: none observed; placement before the signer is untested until M-004; Q-003 (sponsor confirmation that RISKY may be a testnet `payTo`) remains a human action. Mid band, 401/429/5xx and rate limits were not observed live.

# M-004 — SPIKE B (P0): x402 seller, buyer gate, protected signer
Status: VERIFIED
Needs credentials: `PAYER_PRIVATE_KEY` (funded), `BASE_SEPOLIA_RPC_URL`, `X402_FACILITATOR_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`, `SELLER_PAY_TO_ALT`
## Objective
Local x402 seller (Base Sepolia `exact` USDC), buyer gate with a pre-sign hook, protected signer with a call counter and guarded viem account. A pass signs once and settles; deny, timeout and mutation sign zero times.
## Why (SPEC / AC / INV references)
SPEC §5, §12, §16; 08 §11 P0 rows 2–3, Step 9 item 2; ADR-003, ADR-015 (amended by ADR-019/024); AC-001–AC-006, AC-022, AC-026; INV-001, INV-002, INV-004, INV-005, INV-006, INV-008, INV-019, INV-024.
## Dependencies
M-001, M-002, M-003
## Scope
`apps/seller` (`@x402/express`, routes `safe|risky|alt`, prices from Appendix A), `apps/gate/src/{x402,signer,store,agent}`, minimal SQLite store for attempts/evidence/decisions/reservations behind interfaces, the stub facilitator and local integration tests T-023, T-024, T-025, T-040–T-047, T-053, `docs/spikes/SPIKE_B_X402.md` (package names/versions verified from **installed** packages and docs.x402.org, hook semantics, typed-data shape, settlement ordering ADR), SPEC OPEN items Q-005/Q-006 resolved. A public-address script inside the signer module prints the payer address and checks Base Sepolia funding without printing the key.
## Out of scope
Regression, console, ambiguous reconciliation beyond the state model.
## Likely components
`apps/seller`, `apps/gate/src/{x402,signer,store,agent,api}`.
## Acceptance (AC-xxx, INV-xxx)
AC-001–AC-006, AC-022, AC-026; INV-001, INV-002, INV-004–INV-006, INV-008, INV-019, INV-024.
## Validation (exact commands and evidence required)
`pnpm verify` green (offline); live: `LIVE=1 pnpm test:live -- x402` within `[G §4]` limits printing the run banner. Evidence: settled tx hash, `signerCalls=1` for the pass, `signerCalls=0` for deny/timeout/mutation. `HUMAN_REQUIRED` if the wallet is unfunded or a 07 §22 kill condition appears (guard bypass).
## Commit boundary
`feat(gate): add x402 seller, pre-sign buyer gate and protected signer with zero-call guarantees`.
## Evidence (filled in when VERIFIED)
Level: live-verified (pass and deny); timeout/mutation/expiry/policy-change zero-signer cases are integration-tested against a real local seller and a stub facilitator (fixture evidence, never claimed as live). 2026-09-26.
- `corepack pnpm verify` green: 15 files, 350 tests (signer matrix T-023/T-024 49 tests, key isolation T-025 7 tests with self-test, live-session guard T-053, gate integration T-040 to T-049 and T-052 22 tests, Intercepta adapter/mapper).
- Live pass: tx `0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b` (Base Sepolia, block 47331424, RPC receipt `status: success`, USDC Transfer 50000 payer to SAFE), `signerCalls=1`. Live deny: attempt `aae1f854-7804-4135-b0c1-c811d182cad0`, `signerCalls=0`, no signer timestamp.
- `docs/spikes/SPIKE_B_X402.md` (installed-source facts, kill-condition check: none observed), ADR-018, SPEC Q-005/Q-006/Q-009 resolved. Gaps: ambiguous reconciliation against the chain (M-006), real facilitator failure modes.

# M-005 — PRIZE CHECKPOINT
Status: VERIFIED
Needs credentials: all live variables
## Objective
One live pass (tx hash), one live Intercepta-driven block (`signerCalls=0`), and persisted decision traces.
## Why (SPEC / AC / INV references)
`[PA]` points 1–6; SPEC §22 Scenes 2–3; AC-001–AC-006, AC-019, AC-023, AC-029; INV-001, INV-002, INV-019.
## Dependencies
M-004
## Scope
Run the live pass on the SAFE route and the live block on the RISKY route under v1; persist traces; store the `real_live` cases and raw evidence; write the evidence into this file and `HANDOFF.md`.
## Out of scope
Regression.
## Likely components
`apps/gate` CLI `demo:pass`, `demo:block`.
## Acceptance (AC-xxx, INV-xxx)
AC-004, AC-005, AC-006, AC-019, AC-023, AC-029; INV-001, INV-002.
## Validation (exact commands and evidence required)
`LIVE=1 pnpm demo:pass` then `LIVE=1 pnpm demo:block`. Evidence: raw Intercepta response paths + timestamps, Base Sepolia tx hash, `signerCalls=0` log line for the block, trace rows from the DB. Never mark VERIFIED without all of them.
## Commit boundary
`test(live): record prize-path pass and Intercepta-driven block evidence`.
## Evidence (filled in when VERIFIED)
Level: live-verified. 2026-09-26: `LIVE=1 corepack pnpm demo:block` then `LIVE=1 corepack pnpm demo:pass`.
- Pass: `attempt=392a270f-8a18-485e-b3df-9a81b6607feb status=settled action=PAY signerCalls=1 settlement=settled delivery=received tx=0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b`; Intercepta CLEAR (`real_live`, `fixtures/intercepta/recorded/2026-09-26T13-58-54-181Z_0x87cff22e...json`), policy v1.
- Block: `attempt=aae1f854-7804-4135-b0c1-c811d182cad0 status=failed action=DENY signerCalls=0 settlement=none`; Intercepta BLOCK (`known_scammer`, `attack_money_target`, score 100; `fixtures/intercepta/recorded/2026-09-26T13-58-41-611Z_0x39308ae4...json`).
- Persisted traces `docs/evidence/M-005_prize_checkpoint_traces.json`; on-chain receipt check `docs/evidence/M-005_tx_receipt_check.json`; summary `docs/evidence/M-005_prize_checkpoint.md`. Limits respected: 0.05 USDC per payment, session 1/20 settlements and 0.05/1.00 USDC.
- Caveat: Q-003 (sponsor confirmation that the RISKY address may be a merchant payTo) is still a human action, so the block is labelled as the live screen of the configured merchant address, not a sponsor-confirmed qualification claim.

# M-004b — SPEC conformance fix (human review 2026-09-26)
Status: VERIFIED
Needs credentials: all live variables (for the live re-proof); offline work needs none
## Objective
Bring the code into line with the corrected SPEC: signing permit, local-checks-first, `awaiting_approval`/`expired`, single spend ledger, and re-prove the guarded signer with the installed x402 SDK.
## Why (SPEC / AC / INV references)
Human review 2026-09-26; ADR-019 to ADR-022, ADR-024; SPEC §5, §9, §11, §12; AC-033 to AC-037; INV-001, INV-002, INV-004, INV-007, INV-009, INV-017, INV-027, INV-028, INV-029; Q-012.
## Dependencies
M-005
## Scope
(1) `SigningPermit` type, table and lifecycle; the gate arms it after decision and reservation; the signer checks tables A and B, consumes it atomically; remove `authorise(decisionId)` binding; one negative test per mismatch (T-024, T-036). (2) `evaluateLocal` stage A split from `evaluate`; `Decision.evidenceId` nullable with the eligibility refine; the gate runs stage A before any Intercepta call; tests T-009a, T-034, update T-044. (3) Attempt states `awaiting_approval` and `expired`, `awaitingApprovalUntil`, approval `status`, transition tables (finish `packages/core/src/state.ts` from the M-006 WIP), gate `ASK_HUMAN` path and a `resumeWithApproval` that re-requests the resource, re-screens live, re-evaluates and only signs on `PAY` (T-033). (4) Ledger: sum `amountAtomic` only, `committedAtomic` must equal it, tests T-035. (5) New audit types `PermitArmed`, `ApprovalRecorded`, `AttemptExpired`. (6) Re-proof: T-037 offline, then `LIVE=1 pnpm demo:pass` with the new signer within `[G §4]`. (7) Update `AGENTS.md`, SPIKE_B note.
## Out of scope
Owner approval HTTP route and console (M-008, M-009); regression engine.
## Likely components
`packages/core/src/{types,state,policy}`, `apps/gate/src/{signer,store,x402}`.
## Acceptance (AC-xxx, INV-xxx)
AC-033, AC-034, AC-035, AC-036, AC-037; INV-001, INV-002, INV-004, INV-007, INV-009, INV-017, INV-027, INV-028, INV-029.
## Validation (exact commands and evidence required)
`corepack pnpm verify` green; `LIVE=1 corepack pnpm demo:pass` once (0.05 USDC, session limits respected). Evidence: tx hash with an RPC receipt check, `signerCalls=1`, and a block run with `signerCalls=0`; raw Intercepta paths.
## Commit boundary
`fix(gate): add signing permit, local-first checks, awaiting_approval and single spend ledger per SPEC review`.
## Evidence (filled in when VERIFIED)
Level: live-verified (pass and deny) plus integration-tested. 2026-09-26.
- `corepack pnpm verify` green: 21 files, 636 tests (core 460, gate 176). New: T-009a `policy-local.test.ts`; T-024 `signer.test.ts` (51 tests, one negative per table A/B mismatch); T-033 `approval.integration.test.ts` (11); T-034 `local-first.integration.test.ts` (6); T-035/T-036 `ledger-permit.test.ts` (13); T-020 exhaustive attempt/permit/approval/reservation/decision/policy transitions.
- Mutation checks (each fails tests, then restored): recipient check removed, policy-version check removed, stage A skipped, UNAVAILABLE check removed, permit-consumption requirement removed.
- **Live re-proof (AC-037, Q-012):** `LIVE=1 corepack pnpm demo:pass`: attempt `7b94ea6c-bcf3-43a4-9f59-251f544719d3` settled, `signerCalls=1`, permit `consumed`, tx `0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a` (Base Sepolia block 47332599, RPC receipt `status: success`, USDC Transfer 50000 payer to SAFE), Intercepta returned `14:38:03.600Z` before the signer `14:38:03.619Z`, raw file `fixtures/intercepta/recorded/2026-09-26T14-38-03-592Z_0x87cff22e…json`. `LIVE=1 corepack pnpm demo:block`: attempt `2f05c880-d864-469b-be30-198b35d6fc3f` DENY (`EVIDENCE_BLOCK`), `signerCalls=0`, no permit. Files: `docs/evidence/M-004b_tx_receipt_check.json`, `docs/evidence/M-004b_traces.json`. Limits: 0.05 USDC per payment; session now 2/20 settlements, 0.10/1.00 USDC; Intercepta 8/40 calls; wallet 19.89 test USDC.
- Delivered with it (from the M-006 WIP, now tested): state-machine enforcement in the store, audit events, cases with append-only label revisions, signer authorisation recording and the chain reconciler. M-006 remains open for the two-connection reservation test, the reconciler's live check and the audit-order tests.
- SPEC: Q-012 resolved; INV-027/028/029 and AC-033 to AC-037 have tests.


# M-006 — Case store, reservations, reconciliation
Status: VERIFIED
Needs credentials: none (live check optional)
## Objective
Extend the M-004 store: cases with label revisions, serialised spend reservations with a concurrency proof, ambiguous-settlement reconciliation, separate settlement and delivery status, audit events.
## Why (SPEC / AC / INV references)
SPEC §7, §11, §12, §16; 08 §8, §11 P1 rows; AC-009, AC-025, AC-027; INV-007, INV-014, INV-020.
## Dependencies
M-004b
## Scope
Migrations, `BEGIN IMMEDIATE` reservations, reconciliation module (facilitator status + viem receipt/nonce read), tests T-020, T-021, T-022, T-031, T-032, T-048, T-049, T-052.
## Out of scope
Regression and console.
## Likely components
`apps/gate/src/store`.
## Acceptance (AC-xxx, INV-xxx)
AC-025, AC-027, AC-023; INV-007, INV-014, INV-020.
## Validation (exact commands and evidence required)
`pnpm verify` green; T-021 uses two DB connections against one file.
## Commit boundary
`feat(store): add serialised reservations, reconciliation and append-only case labels`.
## Evidence (filled in when VERIFIED)
Level: integration-tested plus a live read-only check of the chain reader. 2026-09-26.
- `corepack pnpm verify` green. T-020 store-side transition enforcement and exhaustive tables (`state.test.ts`, `store.test.ts`); T-021 `reservation-concurrency.test.ts`: **real OS processes** (6 and 8) open one SQLite file and race for a 0.10 USDC cap: exactly 2 and exactly 4 win, total never above the cap (removing the cap re-check fails both tests); T-022 `store.test.ts` reconciliation (used and tx found, used but tx unfound, unused and valid, exactly at `validBefore`, unused after `validBefore`, chain time not local time, non-ambiguous skipped); T-031 cases and append-only label revisions with audit; T-032 `audit.integration.test.ts` (event order on pass, block, unavailable and refusal paths, strictly increasing `seq`, hashes only; this found and fixed a `PermitArmed` timestamp earlier than `PolicyDecided`); T-048/T-049 (M-004) unchanged.
- **Live read-only reconciler check** (`docs/evidence/M-006_reconciler_live_check.json`): for attempt `7b94ea6c-…` the recorded authorisation (from, nonce, validBefore) gives `usedOnChain: true` and `txHash 0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a`, the M-004b settlement; a random nonce gives `used: false`. This exposed that the public RPC limits `eth_getLogs` to 1,000 blocks; the reader now searches in chunks and treats any RPC error as pending. No settlement was ambiguous live, so a live release or commit was not exercised (only the state logic and fake-chain tests).
- Not covered: a real facilitator failure producing an ambiguous settlement.


# M-007 — Regression engine and labelled dataset
Status: VERIFIED
Needs credentials: none
## Objective
Pure regression engine, exposure model and metrics (SPEC §13); labelled dataset of `real_live` (from M-005), `sponsor_fixture`, `controlled_variant` and `synthetic` cases with computed metrics.
## Why (SPEC / AC / INV references)
SPEC §13, Appendix A; AC-009–AC-011, AC-015, AC-032; INV-012, INV-013, INV-023.
## Dependencies
M-002 (engine), M-005 (for the `real_live` cases; the rest can proceed earlier)
## Scope
`packages/core/src/regression`, seed script producing cases from stored evidence snapshots only, T-012–T-015.
## Out of scope
Approval and activation.
## Likely components
`packages/core/src/regression`, `fixtures/cases`, `apps/gate` seed CLI.
## Acceptance (AC-xxx, INV-xxx)
AC-010, AC-011, AC-015, AC-032; INV-012, INV-013, INV-023.
## Validation (exact commands and evidence required)
`pnpm verify` green; mutation test proves metrics change with data.
## Commit boundary
`feat(regression): add deterministic replay engine, metrics and labelled case dataset`.
## Evidence (filled in when VERIFIED)
Level: unit-tested and integration-tested (offline, from stored evidence only). 2026-09-26.
- `corepack pnpm verify` green: 25 files, **734 tests**. Engine: `packages/core/src/regression/{replay,metrics,engine}.ts` (pure; static purity test covers the directory). `regression.test.ts` (19): hand-computed numerators and denominators for candidates A, B and C on a 7-case dataset, an independent naive oracle, unknown labels excluded from prevention/friction metrics but counted in the rates (T-013), deterministic report hash independent of case order and of `reportId`/`generatedAt`, metrics and hash change when one case or one label changes (T-014), invalid candidate / duplicate case id / malformed case rejected, empty dataset gives `0/0` and no fabricated value, inputs not mutated. Mutation checks (5 of 5 killed): prevention clamp removed, unknown counted as good, CAP-below-quote counted as exposure, replay using wall time, dataset hash hard-coded.
- Dataset: `apps/gate/src/dataset/{build,load}.ts`, `fixtures/cases/real_live_manifest.json`, `fixtures/cases/README.md`, `corepack pnpm seed` (idempotent, no network). 19 cases: **4 `real_live`** (the M-005 and M-004b attempts, evidence from the recorded Intercepta files), **11 `controlled_variant`** (the stored SAFE CLEAR and RISKY BLOCK snapshots with other amounts, histories and budgets), **4 `synthetic`** (WARN band, UNAVAILABLE). Labels 9 good, 6 bad, 4 unknown; the Scene-4 incident `cv-01-incident-80000` is seeded `unknown` so the owner labels it (Trigger C). `dataset.test.ts` (16): provenance mix and honesty (no non-real case carries real evidence; real cases replay to their recorded action), hand-computed candidate B metrics on the full dataset (prevents 3/3 exposed bad cases, changes 2/9 good cases, delays 80000/340000 of good value, 6/19 auto-approved), A blunter (4/9, 110000/340000, 12/19 holds), C adds reviews; an owner label on the incident changes the metrics and both hashes.
- No `sponsor_fixture` cases: the sponsor has not confirmed the RISKY address (Q-003).


# M-008 — Policy lifecycle
Status: VERIFIED
Needs credentials: none
## Objective
Candidates, report binding, authenticated owner approval, atomic activation, rollback, stale-approval invalidation, audit events, owner API for all of it.
## Why (SPEC / AC / INV references)
SPEC §9, §11, §19; AC-012, AC-014, AC-028, AC-031; INV-010, INV-011, INV-017, INV-025, INV-026.
## Dependencies
M-006, M-007
## Scope
Store transitions, owner API routes (including `POST /api/approvals`, which calls the M-004b approval-resume path: fresh live screen, re-evaluation, `expired` on approval or policy change), T-029, T-030.
## Out of scope
UI.
## Likely components
`apps/gate/src/{store,api}`.
## Acceptance (AC-xxx, INV-xxx)
AC-012, AC-014, AC-028, AC-031; INV-010, INV-011, INV-017, INV-025, INV-026.
## Validation (exact commands and evidence required)
`pnpm verify` green.
## Commit boundary
`feat(policy): add candidate approval, atomic activation and rollback with report binding`.
## Evidence (filled in when VERIFIED)
Level: integration-tested (offline; real local x402 seller, stub facilitator, fixture evidence labelled synthetic). 2026-09-26.
- `pnpm verify` green: 28 files, **771 tests**. Lifecycle `apps/gate/src/policy/lifecycle.ts` (`installInitialPolicy`, `createCandidate`, `replayCandidate`, `approveCandidate`, `rollbackPolicy`, `ensureVersionRecords`), store tables `policy_versions`, `candidates`, `reports`, owner API `apps/gate/src/api/server.ts` (Express 5, all 15 routes of SPEC section 19), `pnpm owner-api` (127.0.0.1 only).
- T-029 `lifecycle.test.ts` (22): the server builds candidates (next version, parent = active, profile copied; a body cannot change limits, network or asset); replay seals a report bound to candidate, baseline and dataset hashes (same inputs, same hash); approval refused for an unreplayed candidate, missing/other candidate's/tampered/stale-dataset/foreign-baseline report and a blank approver; success is one transaction (policy, records, pointer, sibling candidates rejected, `PolicyApproved` + `PolicyActivated`); **atomicity proved by injecting a failure in the pointer move** (v1 stays active, no v2 policy, records and audit unchanged, the candidate can still be approved afterwards); approved versions are immutable (`putPolicy` insert-only, record edits and illegal transitions throw); rollback is a new logged transition (v2 `rolled_back`, history kept, a rolled-back number is never reused: the next candidate is v3); an attempt awaiting approval under v1 becomes `expired` when v2 activates (AC-031, INV-017).
- T-030 `api.test.ts` (14): every route x 5 bad-auth variants (75 requests) is 401 with `WWW-Authenticate` and never echoes the token; unauthenticated callers cannot tell routes apart; short tokens refused at start; constant-time compare over hashes; static check that agent and signer code never reference the owner token or import the API; body validation (unknown keys, bad values, invalid JSON, 413); the approver identity is always the authenticated owner; the owner loop over HTTP (label incident as owner, two candidates replayed, approval bound to the exact report, 409 for another candidate's report and for a stale sibling, rollback); `POST /api/approvals` binds the shown quote hash, resumes the attempt through the M-004b path and returns the settled result; an approval after a policy change expires the attempt; attempt traces show the signer section only with real calls and label the tier "Risksir tier (policy threshold ADR-017), not an Intercepta verdict".
- T-050 `lifecycle.integration.test.ts`: v1 pays a first-time counterparty; after the owner labels the incident and approves candidate B (bound to its report) a NEW first-time attempt gets a fresh screen and v2 caps it below the quote (`CAP_BELOW_QUOTE`, `signerCalls=0`, no settlement); a known counterparty with the same evidence still pays (Layer 2); rollback restores v1 for the next new attempt. Offline only: the live proof is M-010.
- Mutation checks (7 of 8 killed at first, the survivor closed with a new test; the eighth is unreachable because the strict body schema rejects an `approvedBy` key first): dataset-staleness, candidate binding, baseline binding, rollback target validation, replay requirement, token comparison, approval quote binding.
- Smoke: `pnpm owner-api` started, unauthenticated and wrong-token requests returned 401, then stopped. `POST /api/agent/run` returns 501 and `POST /api/approvals` returns `resumed: false` until the live gate is wired in M-010.


# M-009 — Owner console
Status: VERIFIED
Needs credentials: none
## Objective
Vite + React one-page console: profile view, live trace, incident labelling (Trigger C), regression comparison, approve, rollback; UX contract in SPEC §20.
## Why (SPEC / AC / INV references)
SPEC §20; AC-002, AC-003, AC-006–AC-008, AC-015; INV-012, INV-019.
## Dependencies
M-008
## Scope
`apps/console` with the always-visible policy version header, signer-call badge, provenance badges, separate settlement/delivery, Basescan link, T-054.
## Out of scope
Settings editor, analytics.
## Likely components
`apps/console`.
## Acceptance (AC-xxx, INV-xxx)
AC-006, AC-007, AC-008, AC-015; INV-012, INV-019.
## Validation (exact commands and evidence required)
`pnpm verify` green; console build succeeds; run locally and view.
## Commit boundary
`feat(console): add owner console with decision trace, regression comparison and approval`.
## Evidence (filled in when VERIFIED)
Level: unit-tested (jsdom component and App tests with a fake API) plus a local smoke of the dev server; no live payment in this milestone. 2026-09-26.
- `pnpm verify` green (now also type-checks `apps/console`): 31 files, **797 tests** (26 console tests). `pnpm build:console` (vite build) succeeds: 20 modules, 237 kB JS.
- Console `apps/console` (Vite + React, one page): always-visible `Policy vN` header, large `signer calls: N` badge, provenance badges (only `real_live` reads REAL LIVE), tier labelled "Risksir tier (policy threshold ADR-017), not an Intercepta verdict", settlement and delivery shown separately, Basescan link, no signer timestamp when the signer was not called, "No Intercepta call was made" for locally rejected quotes, incident labelling, candidate A/B/C presets (equal to core's demo candidates, tested), replay with numerator/denominator per metric and the provenance mix, approval bound to the report hash, rollback, approve-quote button that sends the shown quote hash.
- Token handling: bearer token held in memory only, passed to the API factory, input cleared; tests assert nothing in `localStorage`, `sessionStorage`, cookies, URL or DOM. Dev proxy `/api` to `127.0.0.1:4100` (no CORS).
- Smoke: `pnpm owner-api` + `pnpm dev:console` started locally; `GET /` returned 200 and `GET /api/state` through the proxy returned 401 without a token; both stopped. Not yet viewed in a browser with real data (M-010/M-011 demo run).

# M-010 — Layer 4 proof
Status: TODO
Needs credentials: all live variables
## Objective
An approved v2 changes a **new** x402 decision that has a fresh live Intercepta screen; rollback from v2 to v1 demonstrated.
## Why (SPEC / AC / INV references)
SPEC §22 Scenes 4–5; AC-009–AC-014, AC-020; INV-010, INV-011, INV-017.
## Dependencies
M-005, M-008, M-009
## Scope
Live run: incident label → ≥2 candidates replayed → approve → new ALT attempt under v2 → different decision; rollback; record evidence.
## Out of scope
New product features.
## Likely components
`apps/gate` CLI `demo:v2`.
## Acceptance (AC-xxx, INV-xxx)
AC-012, AC-013, AC-014, AC-020; INV-010, INV-011.
## Validation (exact commands and evidence required)
`LIVE=1 pnpm demo:v2` within `[G §4]`. Evidence: raw Intercepta response path + timestamp for the v2 attempt, decision rows showing v1 vs v2, `signerCalls` log, report hash, audit events. Never mark VERIFIED without them.
## Commit boundary
`test(live): record policy v2 changing a freshly screened x402 decision`.
## Evidence (filled in when VERIFIED)
—

# M-011 — Demo hardening
Status: TODO
Needs credentials: all live variables (for smoke)
## Objective
Seed and reset scripts, fail-closed demo, `pnpm demo:smoke`, `DEMO_RUNBOOK.md`; follows `prompts/DEMO_AND_SUBMISSION.md`.
## Why (SPEC / AC / INV references)
SPEC §22; AC-001–AC-006, AC-013; `[G §4]`.
## Dependencies
M-010
## Scope
Scripts, runbook, fallbacks labelled as recorded (never live), reset procedure.
## Out of scope
New features.
## Likely components
`apps/gate` CLI, docs.
## Acceptance (AC-xxx, INV-xxx)
Reproducibility of AC-004, AC-005, AC-013.
## Validation (exact commands and evidence required)
`LIVE=1 pnpm demo:smoke`; reset then re-run; evidence: output summary and tx hash.
## Commit boundary
`feat(demo): add seed, reset, smoke script and runbook`.
## Evidence (filled in when VERIFIED)
—

# M-012 — Submission
Status: TODO
Needs credentials: none
## Objective
README and `FINAL_VALIDATION.md` checked line by line against 07 §27; follows `prompts/DEMO_AND_SUBMISSION.md`.
## Why (SPEC / AC / INV references)
AC-016, AC-017, AC-018, AC-024; SPEC §23.
## Dependencies
M-011
## Scope
README (setup, tests, file map to Intercepta adapter / decision point / signer / regression engine, 3–5 lines of Intercepta API feedback written from **observed** behaviour, claim boundaries), `FINAL_VALIDATION.md`, T-090.
## Out of scope
Making the repo public (human action).
## Likely components
Docs.
## Acceptance (AC-xxx, INV-xxx)
AC-016, AC-017, AC-018.
## Validation (exact commands and evidence required)
`pnpm verify` green; every 07 §27 line marked with evidence or an honest gap.
## Commit boundary
`docs: add README and final validation against the demo checklist`.
## Evidence (filled in when VERIFIED)
—

---

## CRITICAL PATH

M-000 → M-001 → M-002 → M-003 → M-004 → M-005 → **M-004b** → M-006 → M-007 → M-008 → M-009 → M-010 → M-011 → M-012.
(The bootstrap skeleton lists M-005 → M-006 → M-008 → M-010; M-007 and M-009 are added because M-008 needs a regression report and M-010/M-011 need the console.) The **prize path** is M-000…M-005 and comes first. Never mark M-005 or M-010 `VERIFIED` without live evidence. A 07 §22 kill condition stops the build (`CLAUDE.md` §6); do not redesign around it.

## WORK THAT CAN PROCEED WHILE BLOCKED ON CREDENTIALS

Credential names are all SET at bootstrap (`env-status`), so nothing is blocked by a missing name. If a live milestone hits an unfunded wallet, a 429/quota, or a sponsor answer, continue with: M-006 (store, reservations, reconciliation), M-007 (engine and the non-`real_live` dataset), M-008 (lifecycle and owner API), M-009 (console). Return to the critical path as soon as the blocker clears.

## P0/P1 RISKS (08 §11) and the milestone that retires each

| Risk | Pri | Retired by |
| --- | --- | --- |
| Live Intercepta signal on the exact selected `payTo` is decisive and reproducible | P0 | M-003, confirmed M-005 |
| Protected x402 signing boundary is interceptable and non-bypassable | P0 | M-004 (pre-review implementation), re-proved by M-004b (permit design) |
| Exact EVM USDC path settles on the chosen facilitator | P0 | M-004, confirmed M-005 |
| Sponsor known-risk mainnet address can be truthfully tied to a runnable testnet merchant quote | P0 | M-003 (Q-003, human sponsor confirmation) |
| Signed-but-unconfirmed payment reconciles before reservation release or retry | P1 | M-006 |
| Concurrent attempts cannot overshoot the period limit | P1 | M-004 (basic), M-006 (proof) |
| Owner approval/version activation binds future signer decisions; stale approvals invalidated | P1 | M-008, M-010 |
| Intercepta already offers the same replay/optimisation (differentiation gate) | P1 | Spike E, human action, tracked in `HANDOFF.md`; not blocking |
| Token scan / EIP-712 message scan compatibility | P1 if mandatory, else P2 | M-003/M-004 (optional; claim only if proven) |
| Risk-state change API | P2 | Not built (ADR-005) |
| Field names, timeouts, freshness, rate limits | P2 | M-003 |
