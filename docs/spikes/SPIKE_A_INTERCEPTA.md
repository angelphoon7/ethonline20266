# SPIKE A — Live Intercepta semantics (M-003)

Date: 2026-09-26. Governing: SPEC §10, Q-001, Q-002, Q-011; 08 §11 P0 row 1; ADR-007, ADR-017.

## Goal

Call the live Intercepta (W3A) address screen on the exact `payTo` addresses of the SAFE and RISKY sellers, record the raw responses, and fix the evidence mapping from **observed** fields only.

## Commands (exact)

```bash
LIVE=1 corepack pnpm --filter @risksir/gate spike:a   # observe-only probe, unmapped mapper, 2 calls
LIVE=1 corepack pnpm test:live                        # T-060 through the production adapter + mapper, 2 calls
corepack pnpm verify                                  # offline: adapter tests + mapper tests on the recorded files
```

Calls used: **4 of 40** (`data/intercepta-calls.json`, local and gitignored). Keys are read from `.env` by the runtime and never printed or stored.

## Raw evidence (`provenance: real_live`, no headers stored)

| File | Subject | HTTP | Latency | Observed body summary |
| --- | --- | --- | --- | --- |
| `fixtures/intercepta/recorded/2026-09-26T13-33-52-198Z_0x87cff22e916a4d70675e5b3056c1df6bd401cb1a.json` | `SELLER_PAY_TO_SAFE` | 200 | 1336 ms | `toxicScore: 0`, `traits: []` |
| `fixtures/intercepta/recorded/2026-09-26T13-33-55-020Z_0x39308ae43e5dda98db5fb17d005c5c764e5a2fed.json` | `SELLER_PAY_TO_RISKY` | 200 | 2814 ms | `toxicScore: 100`, traits `known_scammer` (risk 100), `attack_money_target` (risk 85) |
| `fixtures/intercepta/recorded/2026-09-26T13-35-25-957Z_0x87cff22e916a4d70675e5b3056c1df6bd401cb1a.json` | SAFE (T-060) | 200 | 441 ms | identical to the first SAFE response |
| `fixtures/intercepta/recorded/2026-09-26T13-35-26-286Z_0x39308ae43e5dda98db5fb17d005c5c764e5a2fed.json` | RISKY (T-060) | 200 | 325 ms | identical to the first RISKY response |

## Observed API facts

- Endpoint used: `GET https://api.web3antivirus.io/api/public/v2/extension/account/{address}/quick-scan` (base URL from `INTERCEPTA_BASE_URL`; the origin matches the public docs), header `X-API-KEY`, no query string. Address passed lowercase.
- Response `application/json`: `{ "toxicScore": number, "traits": [ { "risk": number, "name": string, "description": string } ] }`. The docs also list `txsCount` on traits; it was **not** present in the observed traits. `toxicScore` observed at exactly 0 and 100 only.
- No `verdict`, `CLEAR/WARN/BLOCK` or reason-code fields exist: the tiers are a Risksir mapping (ADR-007, ADR-017), as 08 §9 warned.
- Same-address responses were identical across two calls ~90 s apart (reproducible).
- Latency 325–2814 ms across 4 calls; the 8 s timeout has ample margin.
- The docs give **no** error-code or rate-limit information, and no 401/429/5xx was observed. Those paths are covered by stubbed-fetch tests only (labelled `synthetic`), not by live observation.
- The mid band (0 < score < 100) was **not observed**. The WARN tier is exercised only by a labelled synthetic fixture (`fixtures/intercepta/synthetic/quick-scan-warn-midband.json`). Scene 5 therefore uses the observed tiers (CLEAR) plus context predicates (SPEC §22).

## Evidence mapping (ADR-017, `mappingVersion = quickscan-v1`)

| Condition | Tier |
| --- | --- |
| Body fails the observed schema (`toxicScore` 0–100 number, `traits[].risk` 0–100, `traits[].name` string) | `UNAVAILABLE(MALFORMED)` ⇒ HOLD |
| `toxicScore ≥ 80` or any trait `risk ≥ 80` | `BLOCK` |
| Any other non-zero score, or any trait present | `WARN` |
| `toxicScore = 0` and no traits | `CLEAR` (means "no disqualifying observed signal", not "safe") |

Reasons are the provider trait names verbatim; `providerScore = toxicScore`. The 80 threshold is a Risksir policy default; only the two endpoints (0 and 100) are observed evidence for it.

## Implementation

`apps/gate/src/intercepta/{client,mapping,record,budget}.ts`. Read-only GET only (path regex enforced, INV-021); 8 s timeout; **no retry**; every failure returns an `UNAVAILABLE` evidence record; local 40-call budget (file-backed); raw storage without headers and only for `real_live` (`writeRecordedResponse` refuses other provenance). Tests: `apps/gate/test/intercepta.test.ts` (T-027, T-028), `apps/gate/test/intercepta-mapping.test.ts`, live `apps/gate/test/intercepta.live.test.ts` (T-060).

## Kill-condition check (07 §22)

| Condition | Result |
| --- | --- |
| A live Intercepta result cannot be placed before the actual x402 signer | **Not yet tested** (needs M-004). The adapter is a standalone async call with 325–2814 ms latency; nothing found that prevents placing it before signing |
| Guard can be bypassed | Not tested (M-004) |
| No real pass and no real live-risk hold/block | Live data shows a clean address (score 0) and a known-risk address (score 100 with `known_scammer`), so both branches are available **as screens**. Whether the RISKY address can be used as a merchant `payTo` (Q-003, sponsor confirmation, human) is still open |
| Intercepta already provides historical replay (Spike E) | Not tested; human action |

No kill condition observed.

## SPEC OPEN items resolved

| Item | Resolution |
| --- | --- |
| Q-001 fields/tiers | Resolved for `toxicScore`/`traits` with ADR-017 (mid band unobserved) |
| Q-002 endpoint/base URL | Resolved: quick-scan path and `https://api.web3antivirus.io` observed working |
| Q-011 timeout | 8000 ms retained; latency 325–2814 ms; rate limits still unobserved |
| Q-003 sponsor address as `payTo` | Still open (human) |
