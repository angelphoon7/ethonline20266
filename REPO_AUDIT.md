# REPO_AUDIT — Risksir bootstrap preflight

Date: 2026-09-26. Produced by `prompts/00_BOOTSTRAP.md` Step 0/1. The repository contains **no application code yet**: only the agent pack, the frozen docs, prompts and guard scripts.

## VERIFIED

| Item | Result | How |
| --- | --- | --- |
| Branch | `main` | `git branch --show-current` |
| Remote | `origin` = `https://github.com/angelphoon7/ethonline20266.git`, reachable, empty before the first push | `git remote -v`, `git ls-remote origin` (exit 0) |
| Commits | `215f766 chore(repo): add operating rules, freeze docs, prompts and guard scripts` (already pushed; it plays the role of the bootstrap "first commit", so no second one is made) | `git log` |
| Hooks path | `.githooks` (`core.hooksPath`), `pre-commit` runs `scripts/guard-secrets.sh`; scripts made executable | `git config core.hooksPath` |
| `.env` ignored | `.env` and `.env.*` ignored, `.env.example` tracked | `git check-ignore -v` |
| Node | v24.18.0 (>= 20 required by the default stack) | `node --version` |
| npm | 11.16.0 | `npm --version` |
| corepack | 0.35.0 | `corepack --version` |
| pnpm | **12.6.0 via `corepack pnpm`** (downloaded on first use). Plain `pnpm` is not on PATH | `corepack pnpm --version` |
| Env names SET | `INTERCEPTA_API_KEY`, `INTERCEPTA_BASE_URL`, `PAYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, `X402_FACILITATOR_URL`, `SELLER_PAY_TO_SAFE`, `SELLER_PAY_TO_RISKY`, `SELLER_PAY_TO_ALT`, `OWNER_CONSOLE_TOKEN` | `bash scripts/env-status.sh` (names only) |
| Env names MISSING | none | same |
| Local git identity | `angelphoon7` / `angelphoon7@gmail.com` | `git config` |

## OBSERVED NOT VERIFIED

- `corepack enable` fails with `EPERM` on `C:\Program Files\nodejs\pnpx` (needs an elevated shell). Workaround used: `corepack pnpm ...`. A human may run `corepack enable` once in an admin shell to get plain `pnpm`.
- `gh` CLI is not installed, so `gh auth status` could not run. `git push` uses the Windows credential manager (`credential.helper=manager`); the first push succeeded.
- The variables are SET, but their **values were not inspected** (rule: never open `.env`). Validity of the Intercepta key, the base URL, and whether `SELLER_PAY_TO_RISKY` is the sponsor's known-risk mainnet address are unknown.
- `.gitattributes` is absent; git warns that LF will become CRLF in the Windows working copy. Shell scripts stored as LF are correct in the repository, but a CRLF checkout could break them under Git Bash.
- `AGENTS.md`, `HANDOFF.md`, `SPEC.md`, `EXECUTION_PLAN.md` and `TEST_PLAN.md` did not exist before this run.

## UNKNOWN (resolved only by spikes, see SPEC §25)

- Intercepta response schema, reasons, score semantics, latency, rate limits (Spike A, M-003).
- x402 SDK package versions, `onBeforePaymentCreation` semantics, the exact 402 payload shape, the settlement response (Spike B, M-004).
- Whether the payer wallet is funded with Base Sepolia ETH and test USDC (not checkable without an RPC call; first checked in M-004 through a signer-module script that prints the public address only).
- Whether the sponsor allows the known-risk address as a testnet merchant `payTo` (human action).
- Whether Intercepta already offers customer-specific historical replay (Spike E, human action, novelty gate).

## CONFLICTS (between the input documents)

| # | Conflict | Resolution |
| --- | --- | --- |
| C1 | 07 §3 example profile uses 100 USDC limits; `OPERATIONAL_GUARDRAILS.md` §4 caps live payments at 0.10 USDC | Guardrails win for anything live. Demo thresholds are scaled to testnet amounts (ADR-012). |
| C2 | 07 uses `CLEAR/WARN/BLOCK` in examples; 08 §9 says the quick-scan is a toxic score and **not** a guaranteed verdict schema | Tiers are a Risksir policy mapping over observed fields (ADR-007). Field names stay `OPEN` until Spike A. |
| C3 | 08 §11 exit gate says do not start full implementation before P0 passes; `CLAUDE.md` and the bootstrap prompt build credential-free modules first | Human-accepted deviation (ADR-011). A kill condition still stops the build. |
| C4 | 07 §7 allows "A + one of B/C"; 07 §14 SHOULD lists a later re-screen (B) | MVP triggers are A and C; B is optional (ADR-005). |
| C5 | 07 §14 SHOULD lists token scan; 08 §9 says token/message scans are not an MVP gate | Address screening only is the MVP claim (SPEC §15). |
| C6 | Bootstrap prompt asks for a first commit named `chore: add Risksir agent pack...`; a differently named first commit already exists and is pushed | History is not rewritten (`CLAUDE.md` §9). No action. |

## BLOCKERS

- Credentials: none missing by name. Funding of the payer wallet is unverified.
- Human actions still open: sponsor confirmation for the risky address as a `payTo`, Spike E, public repo before submission.
