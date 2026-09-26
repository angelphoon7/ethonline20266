# DEMO_RUNBOOK

How to run the Risksir demo. Every claim below matches the implementation and the recorded evidence in `docs/evidence/`. Testnet only (Base Sepolia). Never read or paste `.env`.

## 1. Objective

The one promise: **Intercepta tells the agent what is risky. Risksir makes sure the organisation's payment policy learns from what happened.**

Opening line: "A $0.20 API call and a $5,000 payment should not react identically to the same risk warning."

## 2. Prerequisites

- Environment variable names that must be SET (values are never printed): `INTERCEPTA_API_KEY`, `INTERCEPTA_BASE_URL`, `PAYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, `X402_FACILITATOR_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`, `SELLER_PAY_TO_ALT`, `OWNER_CONSOLE_TOKEN`. Check with `bash scripts/env-status.sh`.
- Payer wallet (Base Sepolia): a little test ETH and **at most 100 test USDC** (the preflight fails above that). A full run spends 0.15 USDC.
- Live limits per agent session: 0.10 USDC per payment, 1.00 USDC in total, 20 settlements, 100 live Intercepta calls. A full scripted run uses 3 settlements and 5 Intercepta calls. Counters live in `data/live-session.json` and `data/intercepta-calls.json`.
- Processes (all on 127.0.0.1): `pnpm owner-api:live` (owner API with the local x402 seller and the live gate) and `pnpm dev:console` (console at http://127.0.0.1:5173). The CLI demos start their own seller, so stop `owner-api:live` before running `demo:pass`, `demo:block` or `demo:v2`.

## 2a. One command

`pnpm demo:up` does sections 3, 4 and the process start in one go: it runs `pnpm demo:reset`, then `LIVE=1 pnpm demo:smoke` (it stops if a check FAILs), then starts the owner API (live) and the console and opens http://127.0.0.1:5173. Ctrl+C stops both servers. Flags: `--no-reset` (restart the servers mid-demo without wiping state), `--ignore-smoke` (start despite a failed preflight), `--skip-smoke`, `--no-open`. You still paste `OWNER_CONSOLE_TOKEN` in the console yourself.

## 3. Clean start

Stop the owner API and any demo, then:

```bash
pnpm demo:reset          # moves data/risksir.db to data/backup/, installs policy v1, seeds the 19 labelled cases
```

`demo:reset` refuses while a reservation is reserved or reconciling (run `pnpm reconcile` first, or `--force`). It does **not** reset the spend and Intercepta counters: `pnpm demo:reset --new-session` does, and starting a new agent session is a human decision. `pnpm demo:seed` only adds missing cases and installs v1 if none is active.

## 4. Preflight

```bash
LIVE=1 pnpm demo:smoke   # spends no funds; 1 live Intercepta call
```

It checks: variable names, local state (v1 active, 19 cases, ALT first-time, which step is next), the seller's 402 for SAFE, RISKY and ALT with the quoted `payTo`, the facilitator (`/supported` lists `eip155:84532`), the payer balance, the session limits and one live Intercepta screen of SAFE. Any FAIL exits non-zero: fix it first. Without `LIVE=1` the Intercepta check is skipped.

## 5. Canonical demo (07 §18, Scenes 1 to 5)

Two ways to run it. **Interactive** (for judges): `pnpm owner-api:live` + `pnpm dev:console`, open the console, paste `OWNER_CONSOLE_TOKEN` (held in memory only), and use the scene buttons. **Scripted** (for evidence or a backup take): `LIVE=1 pnpm demo:pass`, `demo:block`, `demo:v2` in that order from a clean start.

| # | Presenter does | Audience sees | Technically | Evidence that proves it |
| --- | --- | --- | --- | --- |
| 1 | Connect the console | Header `Policy v1`, the ExampleCo profile (0.10 USDC per payment, 0.50 per day) | Active policy read from the store | Policy version in the header |
| 2 | "Run scene 2: pay SAFE" | Trace: 402 quote, live Intercepta CLEAR, `PAY`, `signer calls: 1`, settled, delivered | Local checks, live screen of the exact `payTo`, decision, single-use signing permit, signer, facilitator | Intercepta timestamp before the signer timestamp; Basescan tx link; raw response in `fixtures/intercepta/recorded/` |
| 3 | "Run scene 3: risky payTo" (**prize moment**) | Live Intercepta BLOCK with the returned traits, `DENY`, **`signer calls: 0`**, no signer timestamp | Same path; a BLOCK tier is a policy DENY; the signer is never called | `signer calls: 0`, reasons `EVIDENCE_BLOCK`, raw response (score 100, `known_scammer`) |
| 4 | Label the incident case as bad; create candidates A and B; Replay; compare; Approve B | Metrics with numerators, denominators and provenance mix; new `Policy v2` | Deterministic replay over labelled cases; approval bound to the report hash; atomic activation | Report hash, `PolicyApproved` audit event, header `Policy v2` |
| 5 | "Run scene 5: new ALT payment" | A first-time counterparty at 0.05 USDC: v2 gives `CAP` at 0.02 below the quote, `signer calls: 0`; the same screen under v1 would `PAY` | New attempt, fresh live screen, v2 rule B1 | v2 trace with its own Intercepta timestamp; Roll back to v1 and run scene 5 again to see `PAY` |

For scripted evidence `LIVE=1 pnpm demo:v2` does steps 4 and 5 in one run (labels, replays A/B/C, approves B, ALT under v2, SAFE under v2, rolls back, ALT under v1) and asserts every decision. It refuses to start if ALT was already paid or SAFE was not.

Timing for the 4-minute live version. Screens: the console plus one Basescan tab. No slides after the opening.

| Time | Segment | Evidence on screen |
| --- | --- | --- |
| 0:15 | Opening line | none |
| 0:15 | Scene 1: profile | `Policy v1` header |
| 0:45 | Scene 2: pay | Intercepta time before signer time; `signer calls: 1`; Basescan tx |
| 0:45 | Scene 3: risky payTo | returned traits; `signer calls: 0` |
| 1:00 | Scene 4: label, replay A vs B, approve B | metrics with denominators; `Policy v2` |
| 0:30 | Scene 5: new payment under v2 | changed action next to what v1 did |
| 0:10 | Closing line | none |

Closing line: **Intercepta tells the agent what is risky. Risksir makes sure the organisation's payment policy learns from what happened.**

## 6. Sponsor evidence

Show that the live Intercepta call happens **before** the signer: open a settled trace and point at "Intercepta call returned" (time), then "Signer invoked at" (later time). The evidence block lists the screened address, the returned `toxicScore` and traits as returned, and the Risksir tier, labelled "Risksir tier (policy threshold ADR-017), not an Intercepta verdict". Provenance badge: only `REAL LIVE` was observed from the live API; recorded, controlled and synthetic data say what they are.

## 7. Failure demo (one only)

```bash
pnpm demo:failure
```

Simulates an Intercepta timeout: the result is `HOLD` (`EVIDENCE_UNAVAILABLE`) with `signerCalls=0`. It is **simulated** (evidence provenance `synthetic`, no live call, nothing paid) and must be described that way. A real 8-second timeout was also observed once and recorded: `fixtures/intercepta/recorded/2026-09-26T15-45-44-474Z_0x39308ae4...json`, which produced the same HOLD.

## 8. Recovery

| Symptom | Do |
| --- | --- |
| Smoke: payer balance FAIL | Balance above 100 test USDC: move funds out. Below 0.15 USDC or no ETH: fund from the Base Sepolia faucets (human), keep at most 100 USDC |
| Facilitator down | Do not retry blindly. Show scenes 3, 4 and the recorded scene 2 trace (section 10); label it recorded |
| Intercepta 429 or timeout | The gate holds (`signer calls: 0`). Wait, retry once from a new attempt (each attempt is a new call and spends the 100-call budget). Do not lower any check |
| Session limit or call budget reached | Stop live payments. Starting a new session is a human decision (`pnpm demo:reset --new-session`) |
| Console does not load | Confirm `pnpm owner-api:live` is up on 127.0.0.1:4100, then `pnpm dev:console`; `OWNER_CONSOLE_TOKEN` is the only credential; a 401 means a wrong token |
| A scene ends `awaiting_approval` or a payment looks stuck | `pnpm reconcile` (read-only chain check first: `pnpm reconcile --check <attemptId>`) |
| ALT or SAFE state wrong for scene 5 | `pnpm demo:reset`, then run scene 2 (SAFE) before scene 5 |

## 9. Reset between runs

`pnpm demo:reset` (section 3). The previous database is kept under `data/backup/` (gitignored, local). One full interactive run needs a reset before it can be repeated, because ALT stops being a first-time counterparty once it is paid.

## 10. Degraded backup

If the API or testnet is down, what can still be shown, each labelled:

- The static showcase site (recorded evidence, every trace labelled "Recorded from a live run on <timestamp>"): https://ethtokyo2026-kappa.vercel.app/
- `docs/evidence/M-005_*`, `M-004b_*`, `M-010_v2_run.json`, `M-011_v2_rerun_after_reset.json` (traces and tx receipts) and the raw responses in `fixtures/intercepta/recorded/`.
- Regression scenes 4 (offline, from `fixtures/`): replay and approval need no network.
- **HUMAN step before judging: screen-record one full live run of Scenes 1 to 5** to keep as a backup video. If it is played, say it is recorded.

Never present recorded, simulated or synthetic material as live.

## 11. Timed scripts

**4 minutes:** the table in section 5.

**2 minutes:** opening line (10s); Scene 2 pay with Intercepta before signer and the tx (30s); Scene 3 risky payTo with `signer calls: 0` (30s); Scene 4 and 5 shown as one beat: label, replay, approve B, then the same ALT payment gives a different action under v2 (40s); closing line (10s). Check the current ETHGlobal rules for the exact video length.

## 12. Presentation rules

- Demo the running product, not the development framework (`CLAUDE.md`, prompts, the agent loop).
- Do not open code unless a judge asks; then use the GitHub file links from the README.
- Mention the agent-built workflow at most once, only if asked how it was built.
- Do not say CLEAR means safe, that a tier is an Intercepta verdict, or that replay metrics are real prevented losses. A testnet settlement does not prove mainnet wrongdoing.

## 13. Judge Q&A

- *"Doesn't Intercepta already have Automation Rules?"* Intercepta decides what is risky. Risksir governs how this organisation acts on that risk and turns incidents into regression cases that must pass replay and owner approval before a policy changes. We have not received a confirmed answer on whether Intercepta already offers customer-specific replay (`docs/spikes/SPIKE_E_OVERLAP.md` does not exist yet), so we do not claim a confirmed gap.
- *"The risky address is on mainnet but you pay on testnet?"* The mainnet address is screened by Intercepta and settlement happens on Base Sepolia. These are separate observations, as the sponsor rules allow (08 §1). The risky address is never paid.
- *"What if Intercepta is down?"* The system fails closed: `HOLD` with zero signer calls. Show the failure demo (simulated) and the recorded real timeout.
- *"Who can approve a policy?"* Only the authenticated owner, bound to a replay report. No LLM has signing, approval or activation rights.

## 14. Final pre-demo checklist

1. `bash scripts/env-status.sh`: all names SET.
2. Payer holds 0.15 USDC or more and at most 100 test USDC, plus test ETH.
3. `pnpm demo:reset` (owner API stopped), then `LIVE=1 pnpm demo:smoke` shows only PASS.
4. `pnpm owner-api:live` and `pnpm dev:console` are running; console shows `Policy v1`, 19 cases.
5. One Basescan (Base Sepolia) tab open.
6. A recorded full run exists as the backup video.
7. Repo public, showcase site URL works, README links are filled in.
