# OPERATIONAL_GUARDRAILS.md — Risksir

The human owner wrote these hard limits for autonomous agent execution. Agents may add detail, such as script names. They may **not** relax any limit without an explicit human instruction in the current session. Product behaviour is defined in `SPEC.md`, not here.

---

## 1. Secrets

- Never read, print, echo, log, copy or commit the values of `INTERCEPTA_API_KEY`, `PAYER_PRIVATE_KEY`, `OWNER_CONSOLE_TOKEN`, or anything matching `*_KEY`, `*_SECRET`, `*_TOKEN` or `*_PASSWORD`.
- Don't open `.env`. Check which variables are set only with `bash scripts/env-status.sh`, which prints names only.
- Refer to variables by **name** only, in code, docs, logs and commit messages.
- Loggers must redact the `X-API-KEY` and `Authorization` headers, private keys and full signed payment payloads. Log a hash, plus at most the first and last 6 characters of a signature.
- Never bypass `.githooks/pre-commit`. `--no-verify` is forbidden.

## 2. Networks

| Purpose | Allowed | Forbidden |
| --- | --- | --- |
| Signing and settlement | Base Sepolia only (`eip155:84532`), USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (confirm against x402 docs) | Every mainnet. Every other testnet unless the human approves. |
| Risk screening | Read-only Intercepta screens of **mainnet** addresses | Any mutating Intercepta endpoint |

The chain and asset allowlist must be **enforced in code**: the signer rejects anything else. Writing it in this document isn't enough.

## 3. Wallets

- Use one **fresh, dedicated** Base Sepolia payer wallet, with its key in `.env` as `PAYER_PRIVATE_KEY`. It must never have held mainnet funds. Keep its balance at 100 test USDC or less, plus a little test ETH (the human raised this from 20 on 2026-09-26, ADR-026; the spending limits in section 4 are unchanged).
- Merchant `payTo` addresses only receive funds. No merchant private key is needed, and none is allowed in this repo.
- Never generate, import or export a wallet on the human's behalf. The one exception is throwaway keys created inside unit tests, which are never funded.

## 4. Spending limits (live, testnet)

| Limit | Value |
| --- | --- |
| Maximum per live payment | 0.10 test USDC |
| Maximum total per agent session | 1.00 test USDC |
| Maximum live settlements per agent session | 20 |

Before a live payment run, print the network, the public payer address, the `payTo`, the amount, the count and the maximum total. Abort if any limit would be exceeded. Unit and integration tests never hit a live facilitator. Scale the demo policy thresholds to these amounts.

## 5. Intercepta API usage

- Make at most **100 live calls per agent session** (raised from 40 by the human on 2026-09-26, ADR-027). Unit and integration tests use recorded fixtures only.
- Store every live response under `fixtures/intercepta/recorded/` as JSON: timestamp, endpoint, address, HTTP status and body. Never store headers.
- Never hand-write a response and store it as recorded. Hand-made fixtures go under `fixtures/intercepta/synthetic/` and carry `"provenance": "synthetic"`.
- On 429 or quota errors, stop live calls for the rest of the session, record it in `HANDOFF.md` and continue offline work.

## 6. Live vs mock

- Mocks are for tests. The qualifying demo path (one pass and one block) must use the live Intercepta API and a real x402 402 and settlement.
- Never report a mocked, recorded or synthetic result as live. Every evidence object and UI element shows its provenance.

## 7. Git and GitHub

- **Allowed autonomously:** `status`, `diff`, `log`, `add` (explicit paths), `commit`, and `git push origin HEAD` to `main`.
- **Forbidden:**
  - force push, rebase, `reset --hard`, `clean`
  - amending pushed commits, or any history rewrite
  - deleting remote branches
  - `gh repo create`, `gh repo delete`, `gh repo edit`, or changing repo visibility
  - GitHub releases

## 8. Filesystem and system

- Work inside the repository only. No `sudo`. No `rm -rf`: delete tracked files with `git rm`.
- Don't read `~/.ssh`, `~/.aws`, `~/.config/gh`, wallet keystores or browser profiles.
- No global installs, except enabling pnpm through corepack.

## 9. Deployments

- Run local processes only: seller, gate and console on localhost. Public deployments, tunnels and hosting need human approval.
- Don't deploy smart contracts. The MVP has none.

## 10. Irreversible actions

For anything irreversible or outside these limits, stop, set `AGENT_STATUS: HUMAN_REQUIRED` and state exactly what action is needed and why.

## 11. Automation safe zone (no need to ask)

- Read, edit and create files inside the repo.
- Install workspace dependencies with pnpm.
- Build, typecheck, lint and test.
- Start and stop local dev servers, and run offline scripts.
- Make live Intercepta calls and live Base Sepolia payments **within the limits in §4 and §5**.
- Commit and push to `main`.
- Read official documentation: x402, Intercepta/W3A, viem, Base, npm package pages.
