AGENT_STATUS: CONTINUE
HUMAN_ACTIONS: 1. (Optional) Run `corepack enable` once in an admin shell so plain `pnpm` works; until then everything runs as `corepack pnpm`. 2. Keep the payer wallet `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD` at or below 20 test USDC (19.94 after the M-005 run). 3. Confirm with the sponsor that `SELLER_PAY_TO_RISKY` (the known-risk mainnet address) may be used as a testnet merchant `payTo`, and that `SELLER_PAY_TO_ALT` is an acceptable comparator (Q-003). 4. Ask Intercepta the overlap question from 07 §20 (Spike E) and paste the verbatim answer into `docs/spikes/SPIKE_E_OVERLAP.md`. 5. Make the GitHub repo public before submission. 6. Check the GitHub Actions run of the latest push (I could not confirm CI is green on Linux; a concurrent session reported CI fixes, see Known Issues).

# HANDOFF — Risksir

Last updated: 2026-09-26, after the human SPEC review. If this file disagrees with the repository, the repository wins.

## 1. Current Objective

The human SPEC review (SPEC v1.1, ADR-019 to ADR-024) has been applied to the documents. **Next: fix milestone M-004b** (signing permit, local checks before Intercepta, `awaiting_approval`/`expired`, single spend ledger, permit re-proof), then resume M-006 onward. No new feature milestone starts before M-004b.

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`. Last pushed code commit: `f5a956a` (M-004/M-005).
- The review commit `docs(spec): apply human review: signer binding, awaiting_approval, spend ledger, evidence gate` contains only `SPEC.md`, `DECISIONS.md`, `TEST_PLAN.md`, `EXECUTION_PLAN.md`, `HANDOFF.md` and the two spike notes.
- **Uncommitted, unverified WIP (M-006, paused; not part of the review commit):** `packages/core/src/state.ts` and `packages/core/test/state.test.ts` (state-machine tables and exhaustive tests, passing when last run: 172 tests in the two files run together with the fingerprint tests), `packages/core/src/{fingerprint,index}.ts` and `test/fingerprint.test.ts` (audit payload hash), `apps/gate/src/store/store.ts` (state-machine enforcement, cases with label revisions, audit events, signer authorisation recording, reconciliation apply), `apps/gate/src/signer/guard.ts` (audit + authorisation recording), `apps/gate/src/x402/gate.ts` (audit events), `apps/gate/src/reconcile/` (chain reconciliation), `apps/gate/test/store.test.ts`. `pnpm typecheck` passed on the store and reconcile code; **`store.test.ts` and the full `pnpm verify` were not run after these edits** (the run was interrupted by the review). The attempt transition tables in `state.ts` must be extended with `awaiting_approval` and `expired` in M-004b before they are committed.

## 3. VERIFIED Working

- Prize path (M-000 to M-005), live-verified for the **pre-review implementation**: real 402, live Intercepta on the exact `payTo`, one settled Base Sepolia payment (tx `0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b`, RPC receipt `success`, block 47331424, USDC Transfer 50000 payer to SAFE, `signerCalls=1`), and one Intercepta-driven DENY (attempt `aae1f854-7804-4135-b0c1-c811d182cad0`, `signerCalls=0`). Evidence: `docs/evidence/M-005_*`, `docs/spikes/SPIKE_B_X402.md`.
- Intercepta quick-scan call shape observed live (Spike A, see the evidence gate below).
- Tools: Node v24.18.0, pnpm 12.6.0 via `corepack pnpm`, TypeScript ~6.0.3. `corepack pnpm verify` was green at `f5a956a` (350 tests, offline).

### Spike A evidence gate result (review item 5, ADR-023)

Checked against `docs/spikes/SPIKE_A_INTERCEPTA.md` and the six raw files in `fixtures/intercepta/recorded/` (all `real_live`, HTTP 200, scores 0 and 100 only).

| Item | Verdict |
| --- | --- |
| Q-002 endpoint and base URL (`https://api.web3antivirus.io`, quick-scan path, no query) | **Real**, kept resolved |
| HTTP 200 with `X-API-KEY`; body shape `{ toxicScore, traits[{ risk, name, description }] }` at scores 0 and 100; reproducible over 3 pairs; latency 325–2814 ms | **Real** |
| Q-001 fields | **Partly real** (two points only). Reverted to OPEN: meaning of scores between 0 and 100, the WARN band, where BLOCK starts |
| BLOCK at 80 and WARN for any non-zero signal | **Not supported by evidence.** Now labelled "Risksir policy threshold (ADR-017), not an Intercepta verdict" everywhere, including UI text (SPEC §10, §20, Appendix A) |
| `txsCount`, behaviour without the header, 401/429/5xx bodies, rate limits (Q-011) | **Not observed.** OPEN — resolve with Spike A evidence |

## 4. Implemented, Not Verified

The M-006 WIP listed in section 2. Nothing else.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint / unit / integration | 350 tests green at `f5a956a`; **not re-run since** (WIP present; the review is documentation only) |
| live | `LIVE=1 pnpm test:live` T-060 (Intercepta); `LIVE=1 pnpm demo:block` and `demo:pass` ran 2026-09-26 |
| demo smoke | not run |

## 6. External System Status

| System | Status |
| --- | --- |
| Intercepta | **live**, inside the payment flow (6 of 40 calls used: `data/intercepta-calls.json`) |
| x402 seller | **live** local `@x402/express` seller on 127.0.0.1; stub facilitator in tests only |
| Facilitator | **live** (the facilitator configured in `X402_FACILITATOR_URL`; one successful settle; failure modes only via the stub) |
| Base Sepolia RPC + payer wallet | **live**, funded: 19.94 test USDC, 0.1 ETH; payer `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD` |

## 7. Known Issues

**The code contradicts the corrected SPEC** (fix milestone M-004b, ADR-019 to ADR-022):

| Corrected SPEC | Code today |
| --- | --- |
| Single-use signing permit armed by the gate (SPEC §12, INV-027) | Signer is bound by `authorise(decisionId)`; no permit object, expiry or consumption. It does compare typed data with the attempt's stored quote and never recomputes a quote hash from typed data |
| Local checks (scheme, network, asset, cap, service, validity) before any Intercepta call (INV-029) | The gate screens every parseable quote first; no `evaluateLocal` split; no quote-validity check |
| `Decision.evidenceId` null for stage-A rejections; eligible Decisions need evidence (INV-009) | `evidenceId` is required |
| `awaiting_approval` and `expired` attempt states; approval resume with re-screen and re-evaluation (INV-017, INV-028) | Neither state exists; `ASK_HUMAN` ends the attempt as `failed` |
| Ledger = reservation rows only, summing `amountAtomic` (INV-007) | Sums `committedAtomic ?? amountAtomic` for committed rows |
| Key isolation described as code-path isolation, not a security boundary (INV-008) | Code is fine; wording fixed in SPEC and docs only |
| Q-012: permit-based guarded signer with the installed x402 SDK | Proven only for the pre-review signer (M-004, live tx above); the permit design is OPEN until M-004b |

Other:
- Plain `pnpm` is not on PATH (`corepack enable` gives EPERM); use `corepack pnpm` (ADR-014). `gh` CLI is not installed.
- A concurrent session reported "CI repair for `a97e48b`" and edited `HANDOFF.md` and `pnpm-workspace.yaml` (`allowBuilds`) while I worked; those edits landed in `f5a956a`. I have not confirmed a green GitHub Actions run (HUMAN_ACTION 6).
- `data/intercepta-calls.json` counts live Intercepta calls (6/40 used) and `data/live-session.json` the live spend (1 settlement, 0.05 USDC); delete them only at a new session start.
- git identity is `angelphoon7@gmail.com`; confirm it is linked to the GitHub account for attribution.
- Only scores 0 and 100 were observed, so the WARN tier rests on a labelled synthetic fixture.

## 8. Blockers

- Human decision: none open. Credentials: none missing. Technical: none. External: sponsor confirmations (HUMAN_ACTIONS 3–4).

## 9. Recent Decisions

ADR-019 signing permit; ADR-020 `awaiting_approval`/`expired` and approval resume; ADR-021 single spend ledger; ADR-022 local checks before Intercepta (INV-001/INV-009 refined, INV-029 added); ADR-023 Spike A evidence gate; ADR-024 key isolation wording. Earlier: ADR-001 to ADR-018 (name, sponsor path, rail, offchain governance, triggers, deterministic engines, fail-closed, CAP, stack, autonomous mode, credential-free-first, demo thresholds, engine defaults, `corepack pnpm`, signer defence in depth, TypeScript pin, Intercepta mapping, x402 stack).

## 10. Next

1. **M-004b** (see `EXECUTION_PLAN.md`): `evaluateLocal` and nullable `Decision.evidenceId`; gate order (local first); `SigningPermit` with one negative test per mismatch; `awaiting_approval`/`expired` and approval resume; single ledger; finish `state.ts`; T-033 to T-037 and T-009a; then one live `demo:pass` re-proof (0.05 USDC) and a block run.
2. Finish M-006 from the WIP (two-connection reservation test, reconciliation tests, cases and audit tests) after M-004b.
3. M-007 regression engine and dataset; M-008 lifecycle and owner API (including the approvals route); M-009 console (label the tier as a Risksir policy tier).
4. M-010 live Layer 4 proof; M-011 demo hardening; M-012 submission.

## 11. Do Not Repeat

- Do not open `.env`; use `bash scripts/env-status.sh`. Do not run `corepack enable` (EPERM).
- Do not claim a tier threshold as an Intercepta verdict; do not treat scores 1 to 99 as understood.
- Do not describe the signer as a security or process boundary.
- Do not recompute a quote hash from EIP-3009 typed data (it lacks scheme, resource and attemptId).
- Do not commit the M-006 WIP as-is: it needs the new attempt states first. Do not re-run `demo:pass` needlessly (0.05 USDC each, and SAFE is no longer a first-time counterparty in `data/risksir.db`).

## 12. SPEC Review Checklist (asynchronous, non-blocking)

- [x] Human review items 1–8 applied to SPEC v1.1 (raw text had no escaped markdown).
- [ ] SPEC §9 stage A/B evaluation order and the `awaiting_approval` resume rules.
- [ ] SPEC §12 permit tables A and B, and the ledger definition.
- [ ] SPEC §10 evidence status (observed vs OPEN) and the threshold labelling.
- [ ] `EXECUTION_PLAN.md` M-004b scope and that M-006 is BLOCKED behind it.
