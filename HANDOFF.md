AGENT_STATUS: CONTINUE
HUMAN_ACTIONS: 0. Vercel: import the repo, check the project settings listed in the final message of the site commit (root directory, Node version, pnpm), then fill in DEMO_VIDEO_URL (apps/site/src/config.ts) and the README Live site URL. 1. Keep the payer wallet `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD` at or below 20 test USDC (19.84 now). 2. Confirm with the sponsor that `SELLER_PAY_TO_RISKY` (the known-risk mainnet address) may be used as a testnet merchant `payTo`, and that `SELLER_PAY_TO_ALT` is an acceptable comparator (Q-003). 3. Ask Intercepta the overlap question from 07 §20 (Spike E) and paste the verbatim answer into `docs/spikes/SPIKE_E_OVERLAP.md`. 4. Make the GitHub repo public before submission. 5. Check the GitHub Actions run of the latest push (a concurrent session reported run 36247203846 green on Ubuntu for `f5a956a`; later pushes are unconfirmed).

# HANDOFF — Risksir

Last updated: 2026-09-26, after M-010. If this file disagrees with the repository, the repository wins.

## 1. Current Objective

M-004b, M-006, M-007, M-008 (policy lifecycle and owner API), M-009 (owner console) and M-010 (live Layer 4 proof) are done. Next: **M-011** (demo hardening: reset script, `demo:smoke`, `DEMO_RUNBOOK.md`), then M-012 (README, FINAL_VALIDATION, Intercepta feedback, submission).

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`. The M-004b commit is the latest; the working tree is clean after it.
- Previous: `8c24707` (SPEC review docs), `f5a956a` (M-004/M-005).

## 3. VERIFIED Working

- **Prize path, live-verified twice** (real 402, live Intercepta on the exact `payTo`, one settled Base Sepolia payment, one Intercepta-driven DENY with `signerCalls=0`): pre-review signer tx `0x1cf9ae6f…8e6b` (M-005) and **permit-based signer tx `0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a`** (M-004b, Base Sepolia block 47332599, RPC receipt `success`, USDC Transfer 50000 payer to SAFE, `signerCalls=1`, permit consumed; block attempt `2f05c880-…` DENY `signerCalls=0`). Evidence: `docs/evidence/M-005_*`, `docs/evidence/M-004b_*`, `docs/spikes/SPIKE_B_X402.md`.
- SPEC v1.1 implemented and tested: signing permit with tables A/B (51 signer tests, one negative per mismatch), local checks before any Intercepta call, `awaiting_approval`/`expired` with approval resume (fresh screen, re-evaluation, PAY only), single spend ledger, state-machine enforcement in the store. `pnpm verify` green: **798 tests** (offline) plus the live Layer 4 run (M-010).
- Intercepta quick-scan shape observed live (Spike A). Spike A evidence gate (ADR-023): endpoint, base origin, HTTP 200, body shape at scores 0 and 100, reproducibility and latency are real; the 80 threshold, WARN band, `txsCount`, error codes and rate limits are OPEN. Tier thresholds are Risksir policy thresholds, not Intercepta verdicts.
- Tools: Node v24.18.0, pnpm 12.6.0 (plain `pnpm` and `corepack pnpm` both work), TypeScript ~6.0.3.

## 4. Implemented, Not Verified

- A live release or commit by the chain reconciler was not exercised (no ambiguous settlement occurred live); only its read paths were checked against the real chain (`docs/evidence/M-006_reconciler_live_check.json`) and its state logic with a fake reader.
- Cases with label revisions and audit events are tested; there is no owner API yet.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint / unit / integration | `pnpm verify` green, 798 tests (incl. the multi-process reservation race, the regression engine, the policy lifecycle, the owner API and the console component/App tests) |
| live | `LIVE=1 pnpm test:live` T-060 (Intercepta); `LIVE=1 pnpm demo:block` and `demo:pass` ran 2026-09-26 twice (M-005, M-004b) |
| demo smoke | not run |

## 6. External System Status

| System | Status |
| --- | --- |
| Intercepta | **live**, inside the payment flow (10 of 40 calls used: `data/intercepta-calls.json`) |
| x402 seller | **live** local `@x402/express` seller on 127.0.0.1; stub facilitator in tests only |
| Facilitator | **live** (the facilitator configured in `X402_FACILITATOR_URL`; three successful settles (the latest, tx `0xb38f786a…e866a`, block 47333318, was run by the human from PowerShell and checked read-only by `verify:tx`); failure modes only via the stub) |
| Base Sepolia RPC + payer wallet | **live**, funded: 19.84 test USDC, 0.1 ETH; payer `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD`; live session 3/20 settlements, 0.15/1.00 USDC (`data/live-session.json`) |

## 7. Known Issues

- Plain `pnpm` works (corepack shims installed into `%APPDATA%\npm`, ADR-014 amendment); `corepack enable` itself still needs an admin shell and is no longer needed. `gh` CLI is not installed.
- A concurrent "CI repair" session also edits `HANDOFF.md`, `EXECUTION_PLAN.md` and `pnpm-workspace.yaml`; expect merge noise and check `git status` before staging.
- `data/risksir.db` (gitignored) holds the live demo attempts; SAFE is no longer a first-time counterparty there.
- Only scores 0 and 100 were observed, so the WARN tier rests on a labelled synthetic fixture.
- git identity is `angelphoon7@gmail.com`; confirm it is linked to the GitHub account for attribution.
- The owner API: `pnpm owner-api` (policies, cases, traces only; run/resume answer 501 / `resumed: false`) or `pnpm owner-api:live` (LIVE=1: local seller plus the live gate; run scenarios and approval resume work). 127.0.0.1:4100, bearer `OWNER_CONSOLE_TOKEN`, no CORS (the console uses the Vite `/api` proxy). The console was smoke-started but not yet viewed in a browser with real data.
- **The live data/risksir.db is now in a used state:** ALT and SAFE are known counterparties, policy history is v1 -> v2 (rolled back) -> v1. `demo:v2` needs a fresh first-time ALT, so it can only be re-run after the M-011 reset script (or with a fresh db).

### Public showcase site (ADR-025, human-approved, static)

`apps/site` (`@risksir/site`), built by Vercel through the GitHub integration (`vercel.json`). Data: `pnpm export:site` (reads `data/risksir.db`, writes redacted JSON to `apps/site/public/data/`); after any new live run, re-export and review the diff. `pnpm build:site` / `pnpm dev:site` locally. Placeholders for the human: `DEMO_VIDEO_URL` in `apps/site/src/config.ts` and the Live site URL in `README.md`. The agent runs no Vercel command.

## 8. Blockers

- Human decision: none open. Credentials: none missing. Technical: none. External: sponsor confirmations (HUMAN_ACTIONS 3–4).

## 9. Recent Decisions

ADR-019 signing permit; ADR-020 `awaiting_approval`/`expired`; ADR-021 single spend ledger; ADR-022 local checks before Intercepta; ADR-023 Spike A evidence gate; ADR-024 key isolation wording. Earlier: ADR-001 to ADR-018.

## 10. Next

1. Console: `pnpm owner-api` in one terminal and `pnpm dev:console` in another, open http://127.0.0.1:5173, paste `OWNER_CONSOLE_TOKEN` (held in memory only). Run `pnpm seed` first for labelled cases.
2. Candidates A/B/C rules come from `demoCandidates(demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)))`.
3. M-011: `pnpm reset` (fresh db, session counters), `pnpm demo:smoke`, `DEMO_RUNBOOK.md` (see `prompts/DEMO_AND_SUBMISSION.md`); M-012 submission. Live session counters now: 5/20 settlements, 0.25/1.00 USDC, Intercepta 14/40 (one call timed out, fail-closed HOLD). Reset the counters by deleting `data/live-session.json` and `data/intercepta-calls.json` only when starting a new agent session.

## 11. Do Not Repeat

- Do not open `.env`; use `bash scripts/env-status.sh`. Do not run plain `corepack enable` (EPERM); the shims are already installed.
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
