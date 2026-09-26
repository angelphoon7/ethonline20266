# FINAL_VALIDATION

Checked on 2026-09-26 against the repository, `docs/07_PROJECT_FREEZE.md` section 27, `docs/PRIZE_ANCHOR_INTERCEPTA.md` and every `AC-xxx` in `SPEC.md`. PASS means there is evidence named in the row. PENDING means a human action remains. FAIL means the behaviour is not proven. Testnet only (Base Sepolia, `eip155:84532`).

**Result: no FAIL. Three PENDING items need a human (AC-024 public repository, Q-003 sponsor confirmation of the risky `payTo` as a testnet merchant, review of the Intercepta feedback draft).** `AGENT_STATUS: CONTINUE`, with those human actions in `HANDOFF.md`.

Evidence sources used below:

- `pnpm verify`: offline typecheck, lint and 839 tests (see the last line of this file for the run recorded at the time of writing).
- Live evidence files: `docs/evidence/M-004b_traces.json`, `M-005_*`, `M-010_v2_run.json`, `M-011_v2_rerun_after_reset.json`; raw Intercepta responses in `fixtures/intercepta/recorded/` (21 files: 20 successful, 1 real timeout, all `real_live`, no headers).
- Settled payments, each re-checked read-only against the chain with `pnpm verify:tx` (status `success`, USDC transfer of 50000 atomic from the payer): `0x1cf9ae6f…8e6b`, `0xda62fcb7…a97a`, `0xb38f786a…866a`, `0x9225d604…1b97`, `0xe06c8201…70fa`, `0x5f4d70a1…a4c5`, `0x3d0602d0…ecd8`, `0x2ba64242…b4ab`. Full hashes are in the evidence files. Basescan: `https://sepolia.basescan.org/tx/<hash>`.

## 1. Demo acceptance checklist (07 section 27)

| # | Line | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Real x402 `402 Payment Required` | PASS | Real `@x402/express` seller returns HTTP 402; `LIVE=1 pnpm demo:smoke` checks the 402 and its quoted `payTo` for SAFE, RISKY and ALT; trace of tx `0xda62fcb7…a97a` in `M-004b_traces.json` |
| 2 | Exact selected quote displayed | PASS | Console `TraceView` and the static site show network, asset, amount, `payTo`, resource and quote hash (`apps/console/test/components.test.tsx`, `apps/site/test/site.test.tsx`) |
| 3 | Live Intercepta call occurs before signer | PASS | Every settled trace has `interceptaReturnedAt` before `signerInvokedAt` (`M-004b_traces.json`, `M-010_v2_run.json`); `apps/gate/test/gate.integration.test.ts` asserts the order; the raw response file for each attempt is stored |
| 4 | One successful payment | PASS | Eight settled payments listed above, for example `0xda62fcb7…a97a`, `signerCalls=1`, `settled`, `delivered` |
| 5 | One Intercepta-driven hold/block | PASS, with a caveat | Known-risk `payTo`: live score 100, `known_scammer`, `DENY`. Caveat: the sponsor has not confirmed the risky mainnet address as a testnet merchant `payTo` (Q-003), so the blocked branch is described as a controlled merchant configuration and no qualification is claimed |
| 6 | Zero signer calls on blocked path | PASS | Block attempts show `signerCalls=0` and no signer timestamp (`M-004b_traces.json`, `M-011_v2_rerun_after_reset.json` attempt `f627358f…`); `gate.integration.test.ts` block path |
| 7 | Company risk profile is explicit | PASS | Console profile panel (0.10 USDC per payment, 0.50 per day, allowed services); `apps/console/test/app.test.tsx` |
| 8 | Active policy version displayed | PASS | Header `Policy vN` always visible (`components.test.tsx`); stored on every decision |
| 9 | At least one incident/regression case exists | PASS, with a note | `cv-01-incident-80000`, a `controlled_variant` case labelled bad by the owner (`IncidentLabelled` audit event). In the scripted live run the label is written by `demo:v2` acting as the owner; the authenticated HTTP and console path is integration-tested (`apps/gate/test/api.test.ts`) |
| 10 | At least two candidate policies replayed | PASS | Candidates A, B, C replayed with report hashes in `M-010_v2_run.json` and `M-011_v2_rerun_after_reset.json` |
| 11 | Metrics calculated from case data | PASS | `packages/core/test/regression.test.ts` and `apps/gate/test/dataset.test.ts` (hand-computed metrics; mutating one case or label changes metrics and the report hash); the UI renders numerators and denominators from the stored report |
| 12 | One candidate approved as a new policy version | PASS | B approved bound to its report hash and activated as v2 in one transaction (`apps/gate/test/lifecycle.test.ts`; live in `M-010_v2_run.json`) |
| 13 | New policy changes a later payment decision | PASS | Live: ALT under v2 attempt `3faa35f6…` `CAP`, `signerCalls=0`, fresh live screen; under v1 the same kind of attempt `PAY` (`26540d40…`); reproduced after reset (`0322160f…` CAP; `08ba465b…` PAY) |
| 14 | Rollback is possible | PASS | `PolicyRolledBack` v2 to v1 as a new logged transition, then a paid attempt under v1 (live, both runs); `lifecycle.test.ts` |
| 15 | Synthetic/controlled cases clearly labelled | PASS | Provenance label stored, in API output, and shown in console and site; only `real_live` reads as live (`components.test.tsx`, `packages/core/test/types.test.ts`); the dataset mix (4 real_live, 11 controlled_variant, 4 synthetic) is printed with every comparison |
| 16 | Public repo contains setup/testing instructions | PASS for content, PENDING for visibility | README sections Setup, Tests and Run (`test/docs.test.ts`); clean-checkout run in section 4 below. Whether the repository is public is a human action (AC-024) |
| 17 | README points to Intercepta integration files | PASS | README "Where the integration lives" table with line anchors, verified by `test/docs.test.ts` |
| 18 | README contains the 3 to 5 lines of Intercepta API feedback | PASS, PENDING review | Five numbered lines written from observed behaviour, marked `DRAFT — human to review before submission` |

## 2. Prize anchor (`docs/PRIZE_ANCHOR_INTERCEPTA.md`)

| # | Point | Result | Evidence |
| --- | --- | --- | --- |
| 1 | An autonomous buyer agent receives an x402 payment requirement | PASS | `apps/gate/src/agent/runner.ts` (deterministic task runner, no LLM) hands a real 402 to the gate; live traces |
| 2 | Before the payer can sign, the selected payment is screened with a live Intercepta API call | PASS | The exact selected `payTo` is screened inside the SDK `onBeforePaymentCreation` hook (`apps/gate/src/x402/gate.ts`), before the signer; timestamps in every trace; raw responses stored |
| 3 | Intercepta evidence is evaluated together with the organisation's active payment policy | PASS | `packages/core/src/policy/evaluate.ts`; the decision stores the policy version and evidence id |
| 4 | The result directly produces one of `PAY`, `CAP`, `HOLD`, `ASK_HUMAN`, `DENY` | PASS | All five reachable and tested (`policy.test.ts`); live observed: `PAY`, `CAP`, `DENY`, `HOLD`. `ASK_HUMAN` and its approval resume are integration-tested only (`approval.integration.test.ts`), not exercised live |
| 5 | A held or denied payment produces zero payer-signing calls | PASS | `signerCalls=0` on every held or denied live attempt; signer matrix and zero-signer integration tests (`signer.test.ts`, `gate.integration.test.ts`) |
| 6 | The demo includes both a successful payment and a payment blocked or held because of visible Intercepta evidence | PASS | Both, in the same run (`M-011_v2_rerun_after_reset.json` and `M-004b_traces.json`); same caveat as line 5 above |

## 3. Acceptance criteria (SPEC section 21)

| AC | Result | Evidence |
| --- | --- | --- |
| AC-001 | PASS | Real local x402 402 parsed; `gate.integration.test.ts`; live `M-004b_traces.json` |
| AC-002 | PASS | Quote in trace; `components.test.tsx`, `site.test.tsx` |
| AC-003 | PASS | `interceptaReturnedAt < signerInvokedAt` in every settled trace; `gate.integration.test.ts` |
| AC-004 | PASS | Eight settled txs (RPC receipts `success`), Basescan link in the trace |
| AC-005 | PASS | Live BLOCK to `DENY`, reason `EVIDENCE_BLOCK`, traits shown |
| AC-006 | PASS | `signer calls: 0`, no signer timestamp (`components.test.tsx`; live traces) |
| AC-007 | PASS | Profile panel, `app.test.tsx` |
| AC-008 | PASS | Header on every screen; policy version stored on every decision (`Decision.policyVersion`, asserted in `lifecycle.integration.test.ts` and shown in each trace) |
| AC-009 | PASS, note | Incident case labelled by `owner`; label history append-only (`store.test.ts`, `lifecycle.test.ts`); scripted live run writes the label as the owner, the authenticated path is `api.test.ts` |
| AC-010 | PASS | Three valid candidates replayed (`candidate.test.ts`, live runs) |
| AC-011 | PASS | `regression.test.ts`, `dataset.test.ts` (mutation changes metrics) |
| AC-012 | PASS | `lifecycle.test.ts` (atomicity proved by injected failure); live |
| AC-013 | PASS | `lifecycle.integration.test.ts` offline; live `3faa35f6…` and `0322160f…` |
| AC-014 | PASS | `lifecycle.test.ts`; live rollback in both runs |
| AC-015 | PASS | Provenance labels in DB, API, console and site; `types.test.ts`, `components.test.tsx`, `site.test.tsx` |
| AC-016 | PASS | README setup and test steps; `test/docs.test.ts`; clean-checkout run (section 4) |
| AC-017 | PASS | `test/docs.test.ts` verifies each anchored line |
| AC-018 | PASS, PENDING review | README "Intercepta API feedback", 5 lines, marked DRAFT |
| AC-019 | PASS | Screened address equals the quote `payTo` in every trace; the raw record schema fixes `interpretedNetwork: evm-mainnet` (`packages/core/src/types.ts`, visible in every recorded file); `gate.integration.test.ts` asserts the screened address |
| AC-020 | PASS | `lifecycle.integration.test.ts` (known counterparty pays under v2, first-time is capped); live: SAFE `PAY` and ALT `CAP` under v2 with the same CLEAR tier |
| AC-021 | PASS, partly synthetic | Timeout, 500, 429, malformed and empty each give `HOLD` with `signerCalls=0` in `intercepta.test.ts` and `gate.integration.test.ts` (stubbed, labelled synthetic). One **real** timeout was observed live and held (`2026-09-26T15-45-44-474Z_0x39308ae4…json`); 429 and malformed were not observed live |
| AC-022 | PASS | Quote mutation after the decision refuses signing (`gate.integration.test.ts` quote mutation, `signer.test.ts`) |
| AC-023 | PASS | Settlement and delivery separate fields, tested (`gate.integration.test.ts` settlement outcomes) and rendered separately |
| AC-024 | PENDING (human) | The repository must be made public before submission. It is not verified public from here; no repository visibility change was made |
| AC-025 | PASS | `reservation-concurrency.test.ts` (real processes) and gate concurrency test |
| AC-026 | PASS | `key-isolation.test.ts` (static) |
| AC-027 | PASS, offline | Ambiguous settlement keeps a `reconciling` reservation (`gate.integration.test.ts`); chain reconciler read paths checked live (`docs/evidence/M-006_reconciler_live_check.json`); a live release or commit did not occur |
| AC-028 | PASS | Every owner route x 5 bad-auth variants returns 401 (`api.test.ts`) |
| AC-029 | PASS | 21 raw files with timestamp, endpoint, address, provenance and no headers; `intercepta.test.ts`, `intercepta.live.test.ts` |
| AC-030 | PASS | `policy.test.ts` |
| AC-031 | PASS | `approval.integration.test.ts`, `ledger-permit.test.ts`, `gate.integration.test.ts` decision validity |
| AC-032 | PASS | `purity.test.ts`, `regression.test.ts` (same inputs, same report hash; no signer import) |
| AC-033 | PASS, offline | `approval.integration.test.ts` (`awaiting_approval`, resume with fresh screen, PAY only, expiry); not exercised live |
| AC-034 | PASS | `signer.test.ts` (51 tests, one negative per mismatch) and `ledger-permit.test.ts` |
| AC-035 | PASS | `local-first.integration.test.ts` (zero Intercepta calls for a locally rejected quote) |
| AC-036 | PASS | `store.test.ts`, `ledger-permit.test.ts`, `reservation-concurrency.test.ts` |
| AC-037 | PASS | Live: permit-based signer, one valid signature settled by the facilitator: `0xda62fcb7…a97a` and every later payment |

## 4. Clean checkout

See the last section, added after the run.

## 5. Gaps that are not FAILs, stated plainly

- Only scores 0 and 100 were observed from Intercepta. The 80 threshold and the WARN tier are Risksir policy choices (ADR-017); the WARN tier is exercised by a labelled synthetic fixture only.
- The Intercepta overlap question (does Automation Rules already offer customer-specific replay?) is unanswered (`docs/spikes/SPIKE_E_OVERLAP.md` does not exist), so no gap in Intercepta is claimed.
- Replay metrics are counterfactual on 19 labelled cases (4 real_live, 11 controlled_variant, 4 synthetic), not real prevented losses.
- The payer wallet held 39.74 test USDC at the last preflight, above the 20 USDC ceiling in `OPERATIONAL_GUARDRAILS.md`. The spend limits were never exceeded (0.40 of 1.00 USDC, 8 of 20 settlements); this is a human action.
