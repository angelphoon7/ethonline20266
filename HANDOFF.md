AGENT_STATUS: ALL_DONE
HUMAN_ACTIONS: 0. All milestones are verified; only the steps below need a human. 1. (Done) The payer balance ceiling was raised from 20 to 100 test USDC by the human (ADR-026). 2. Vercel: the site is deployed at https://ethtokyo2026-kappa.vercel.app/; fill in DEMO_VIDEO_URL in apps/site/src/config.ts. 3. Send the Intercepta questions (overlap, mid-band score meaning, rate limits) and paste the verbatim answer into docs/spikes/SPIKE_E_OVERLAP.md. 4. Confirm with the sponsor that SELLER_PAY_TO_RISKY may be used as a testnet payTo and SELLER_PAY_TO_ALT as a comparator (Q-003). 5. Before judging, screen-record one full live run of Scenes 1 to 5 (DEMO_RUNBOOK.md section 10). 6. Make the GitHub repo public before submission (AC-024); check the GitHub Actions run of the latest push. 7. Review the DRAFT Intercepta API feedback in README.md.

# HANDOFF — Risksir

Last updated: 2026-09-26, after M-012. If this file disagrees with the repository, the repository wins.

## 1. Current Objective

Every milestone M-000 to M-012 is VERIFIED. `FINAL_VALIDATION.md` has no FAIL; what remains is human only (see HUMAN_ACTIONS). No further build work is planned. Do not add features (CLAUDE.md section 11).

## 2. Repository State

- Branch `main`, remote `origin` = `https://github.com/angelphoon7/ethonline20266.git`. The M-004b commit is the latest; the working tree is clean after it.
- Previous: `8c24707` (SPEC review docs), `f5a956a` (M-004/M-005).

## 3. VERIFIED Working

- **Prize path, live-verified twice** (real 402, live Intercepta on the exact `payTo`, one settled Base Sepolia payment, one Intercepta-driven DENY with `signerCalls=0`): pre-review signer tx `0x1cf9ae6f…8e6b` (M-005) and **permit-based signer tx `0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a`** (M-004b, Base Sepolia block 47332599, RPC receipt `success`, USDC Transfer 50000 payer to SAFE, `signerCalls=1`, permit consumed; block attempt `2f05c880-…` DENY `signerCalls=0`). Evidence: `docs/evidence/M-005_*`, `docs/evidence/M-004b_*`, `docs/spikes/SPIKE_B_X402.md`.
- SPEC v1.1 implemented and tested: signing permit with tables A/B (51 signer tests, one negative per mismatch), local checks before any Intercepta call, `awaiting_approval`/`expired` with approval resume (fresh screen, re-evaluation, PAY only), single spend ledger, state-machine enforcement in the store. `pnpm verify` green: **839 tests** (offline) plus the live Layer 4 run (M-010).
- Intercepta quick-scan shape observed live (Spike A). Spike A evidence gate (ADR-023): endpoint, base origin, HTTP 200, body shape at scores 0 and 100, reproducibility and latency are real; the 80 threshold, WARN band, `txsCount`, error codes and rate limits are OPEN. Tier thresholds are Risksir policy thresholds, not Intercepta verdicts.
- Tools: Node v24.18.0, pnpm 12.6.0 (plain `pnpm` and `corepack pnpm` both work), TypeScript ~6.0.3.

## 4. Implemented, Not Verified

- A live release or commit by the chain reconciler was not exercised (no ambiguous settlement occurred live); only its read paths were checked against the real chain (`docs/evidence/M-006_reconciler_live_check.json`) and its state logic with a fake reader.
- Cases with label revisions and audit events are tested; there is no owner API yet.

## 5. Test Status

| Level | Status |
| --- | --- |
| typecheck / lint / unit / integration | `pnpm verify` green, 839 tests (incl. the multi-process reservation race, the regression engine, the policy lifecycle, the owner API and the console component/App tests) |
| live | `LIVE=1 pnpm test:live` T-060 (Intercepta); `LIVE=1 pnpm demo:block` and `demo:pass` ran 2026-09-26 twice (M-005, M-004b) |
| demo smoke | `LIVE=1 pnpm demo:smoke` ran 2026-09-26: all checks PASS (the payer balance check now uses the 100 test USDC ceiling, ADR-026); reset then re-run of the full loop verified (M-011) |

## 6. External System Status

| System | Status |
| --- | --- |
| Intercepta | **live**, inside the payment flow (10 of 40 calls used: `data/intercepta-calls.json`) |
| x402 seller | **live** local `@x402/express` seller on 127.0.0.1; stub facilitator in tests only |
| Facilitator | **live** (the facilitator configured in `X402_FACILITATOR_URL`; three successful settles (the latest, tx `0xb38f786a…e866a`, block 47333318, was run by the human from PowerShell and checked read-only by `verify:tx`); failure modes only via the stub) |
| Base Sepolia RPC + payer wallet | **live**, **39.44 test USDC as of the last preflight (ceiling raised to 100, ADR-026)**, 0.1 ETH; payer `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD`; live session 8/20 settlements, 0.40/1.00 USDC (`data/live-session.json`), Intercepta 21/40 |

## 7. Known Issues

- Plain `pnpm` works (corepack shims installed into `%APPDATA%\npm`, ADR-014 amendment); `corepack enable` itself still needs an admin shell and is no longer needed. `gh` CLI is not installed.
- A concurrent "CI repair" session also edits `HANDOFF.md`, `EXECUTION_PLAN.md` and `pnpm-workspace.yaml`; expect merge noise and check `git status` before staging.
- `data/risksir.db` (gitignored) now holds the reset-then-rerun demo attempts (v1 active, SAFE and ALT paid, history v1 -> v2 -> v1). The pre-reset database (all earlier live attempts, including the ones the showcase site was exported from) is `data/backup/risksir-2026-09-26T16-17-05-382Z.sqlite`, local only. `pnpm export:site --db=data/backup/risksir-2026-09-26T16-17-05-382Z.sqlite` reproduces the committed site data. Run `pnpm demo:reset` before the next full demo.
- Only scores 0 and 100 were observed, so the WARN tier rests on a labelled synthetic fixture.
- git identity is `angelphoon7@gmail.com`; confirm it is linked to the GitHub account for attribution.
- The owner API: `pnpm owner-api` (policies, cases, traces only; run/resume answer 501 / `resumed: false`) or `pnpm owner-api:live` (LIVE=1: local seller plus the live gate; run scenarios and approval resume work). 127.0.0.1:4100, bearer `OWNER_CONSOLE_TOKEN`, no CORS (the console uses the Vite `/api` proxy). The console was smoke-started but not yet viewed in a browser with real data.
- `demo:v2` writes its summary to `data/last-demo-v2.json` (not committed evidence) unless `--out=<path>` is given, and refuses to start unless ALT is first-time and SAFE is known.

### Public showcase site (ADR-025, human-approved, static)

`apps/site` (`@risksir/site`), built by Vercel through the GitHub integration (`vercel.json`). Data: `pnpm export:site` (reads `data/risksir.db`, writes redacted JSON to `apps/site/public/data/`); after any new live run, re-export and review the diff. `pnpm build:site` / `pnpm dev:site` locally. The console login page is published on the same site at `/console/` as a disabled preview (Connect off on non-local hosts, ADR-025 addendum; the live demo stays local via `pnpm demo:up`). Placeholders for the human: `DEMO_VIDEO_URL` in `apps/site/src/config.ts` and the Live site URL in `README.md`. The agent runs no Vercel command.

## 8. Blockers

- Human decision: none open. Credentials: none missing. Technical: none. External: sponsor confirmations (HUMAN_ACTIONS 3–4).

## 9. Recent Decisions

ADR-019 signing permit; ADR-020 `awaiting_approval`/`expired`; ADR-021 single spend ledger; ADR-022 local checks before Intercepta; ADR-023 Spike A evidence gate; ADR-024 key isolation wording. Earlier: ADR-001 to ADR-018.

## 10. Next

1. Human submission steps: fill `DEMO_VIDEO_URL`, review the README Intercepta feedback draft, make the repository public, record the backup video, send the Intercepta questions (Spike E), confirm Q-003 with the sponsor.
2. Before judging (human): `pnpm demo:reset`, `LIVE=1 pnpm demo:smoke`, screen-record one full live run as the backup video (`DEMO_RUNBOOK.md` sections 10 and 14). Interactive demo: `pnpm owner-api:live` + `pnpm dev:console`, the console has Run scene 2/3/5 buttons.
3. Candidates A/B/C rules come from `demoCandidates(demoPolicyV1(demoProfile(DEMO_SERVICE_BASE)))`.

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
