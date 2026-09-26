AGENT_STATUS: CONTINUE
HUMAN_ACTIONS: 1. (Optional) Run `corepack enable` once in an admin shell so plain `pnpm` works; until then everything runs as `corepack pnpm`. 2. Keep the payer wallet `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD` at or below 20 test USDC (19.89 now). 3. Confirm with the sponsor that `SELLER_PAY_TO_RISKY` (the known-risk mainnet address) may be used as a testnet merchant `payTo`, and that `SELLER_PAY_TO_ALT` is an acceptable comparator (Q-003). 4. Ask Intercepta the overlap question from 07 §20 (Spike E) and paste the verbatim answer into `docs/spikes/SPIKE_E_OVERLAP.md`. 5. Make the GitHub repo public before submission. 6. Check the GitHub Actions run of the latest push (a concurrent session reported run 36247203846 green on Ubuntu for `f5a956a`; later pushes are unconfirmed).

# HANDOFF — Risksir

Last updated: 2026-09-26, after M-004b. If this file disagrees with the repository, the repository wins.

## 1. Current Objective

M-004b (SPEC v1.1 conformance fix) and M-006 (store hardening, reconciliation) are done. Next: **M-007** (regression engine and labelled dataset), then M-008 (policy lifecycle and owner API), M-009 (console), M-010 (Layer 4 live proof).

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`. The M-004b commit is the latest; the working tree is clean after it.
- Previous: `8c24707` (SPEC review docs), `f5a956a` (M-004/M-005).

## 3. VERIFIED Working

- **Prize path, live-verified twice** (real 402, live Intercepta on the exact `payTo`, one settled Base Sepolia payment, one Intercepta-driven DENY with `signerCalls=0`): pre-review signer tx `0x1cf9ae6f…8e6b` (M-005) and **permit-based signer tx `0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a`** (M-004b, Base Sepolia block 47332599, RPC receipt `success`, USDC Transfer 50000 payer to SAFE, `signerCalls=1`, permit consumed; block attempt `2f05c880-…` DENY `signerCalls=0`). Evidence: `docs/evidence/M-005_*`, `docs/evidence/M-004b_*`, `docs/spikes/SPIKE_B_X402.md`.
- SPEC v1.1 implemented and tested: signing permit with tables A/B (51 signer tests, one negative per mismatch), local checks before any Intercepta call, `awaiting_approval`/`expired` with approval resume (fresh screen, re-evaluation, PAY only), single spend ledger, state-machine enforcement in the store. `corepack pnpm verify` green: **643 tests** (offline).
- Intercepta quick-scan shape observed live (Spike A). Spike A evidence gate (ADR-023): endpoint, base origin, HTTP 200, body shape at scores 0 and 100, reproducibility and latency are real; the 80 threshold, WARN band, `txsCount`, error codes and rate limits are OPEN. Tier thresholds are Risksir policy thresholds, not Intercepta verdicts.
- Tools: Node v24.18.0, pnpm 12.6.0 via `corepack pnpm`, TypeScript ~6.0.3.

## 4. Implemented, Not Verified

- A live release or commit by the chain reconciler was not exercised (no ambiguous settlement occurred live); only its read paths were checked against the real chain (`docs/evidence/M-006_reconciler_live_check.json`) and its state logic with a fake reader.
- Cases with label revisions and audit events are tested; there is no owner API yet.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint / unit / integration | `corepack pnpm verify` green, 643 tests (incl. real multi-process reservation race) |
| live | `LIVE=1 pnpm test:live` T-060 (Intercepta); `LIVE=1 pnpm demo:block` and `demo:pass` ran 2026-09-26 twice (M-005, M-004b) |
| demo smoke | not run |

## 6. External System Status

| System | Status |
| --- | --- |
| Intercepta | **live**, inside the payment flow (8 of 40 calls used: `data/intercepta-calls.json`) |
| x402 seller | **live** local `@x402/express` seller on 127.0.0.1; stub facilitator in tests only |
| Facilitator | **live** (the facilitator configured in `X402_FACILITATOR_URL`; two successful settles; failure modes only via the stub) |
| Base Sepolia RPC + payer wallet | **live**, funded: 19.89 test USDC, 0.1 ETH; payer `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD`; live session 2/20 settlements, 0.10/1.00 USDC (`data/live-session.json`) |

## 7. Known Issues

- Plain `pnpm` is not on PATH (`corepack enable` gives EPERM); use `corepack pnpm` (ADR-014). `gh` CLI is not installed.
- A concurrent "CI repair" session also edits `HANDOFF.md`, `EXECUTION_PLAN.md` and `pnpm-workspace.yaml`; expect merge noise and check `git status` before staging.
- `data/risksir.db` (gitignored) holds the live demo attempts; SAFE is no longer a first-time counterparty there.
- Only scores 0 and 100 were observed, so the WARN tier rests on a labelled synthetic fixture.
- git identity is `angelphoon7@gmail.com`; confirm it is linked to the GitHub account for attribution.
- Approval HTTP route and console do not exist yet (M-008/M-009); approvals are recorded through the store and `gate.resumeWithApproval`.

## 8. Blockers

- Human decision: none open. Credentials: none missing. Technical: none. External: sponsor confirmations (HUMAN_ACTIONS 3–4).

## 9. Recent Decisions

ADR-019 signing permit; ADR-020 `awaiting_approval`/`expired`; ADR-021 single spend ledger; ADR-022 local checks before Intercepta; ADR-023 Spike A evidence gate; ADR-024 key isolation wording. Earlier: ADR-001 to ADR-018.

## 10. Next

1. M-007 regression engine (SPEC §13, pure, no signer import) and the labelled dataset built from stored snapshots (use the `real_live` evidence in `fixtures/intercepta/recorded/` and the store; `controlled_variant` incident per SPEC Appendix A).
2. Add a `seed` CLI that writes the dataset and cases through `store.saveCase`.
3. M-008 lifecycle and owner API (including `POST /api/approvals` calling `resumeWithApproval`); M-009 console (label the tier as a Risksir policy tier).
4. M-010 live Layer 4 proof; M-011 demo hardening; M-012 submission.

## 11. Do Not Repeat

- Do not open `.env`; use `bash scripts/env-status.sh`. Do not run `corepack enable` (EPERM).
- Do not claim a tier threshold as an Intercepta verdict; do not treat scores 1 to 99 as understood.
- Do not describe the signer as a security or process boundary (code-path isolation only).
- Do not recompute a quote hash from EIP-3009 typed data (it lacks scheme, resource and attemptId).
- Public RPC limits `eth_getLogs` to 1,000 blocks: chunk log searches.
- Do not re-run `demo:pass` needlessly (0.05 USDC each, session limit 1.00 USDC).
- Do not use shell heredocs with mixed quotes for large edits; write a script file instead.

## 12. SPEC Review Checklist (asynchronous, non-blocking)

- [x] Human review items 1–8 applied (SPEC v1.1) and now implemented (M-004b).
- [ ] SPEC §9 stage A/B order and the approval-resume rules match the intended product behaviour.
- [ ] SPEC §12 permit tables A and B.
- [ ] Attempt `expired` vs `failed` reasons (`APPROVAL_EXPIRED`, `POLICY_CHANGED`).
