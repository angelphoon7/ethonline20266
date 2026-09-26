# SPIKE B — Protected x402 signing path and real settlement (M-004)

Date: 2026-09-26. Governing: SPEC §5, §12, §16, Q-005, Q-006; 08 §11 P0 rows 2–3; ADR-003, ADR-015, ADR-018.

> **Design note (human review 2026-09-26):** the signer described below is the pre-review implementation. SPEC §12 now requires a single-use signing permit and typed-data checks against a stored quote (ADR-019). M-004b implemented it and re-proved it live (tx `0xda62fcb74165323b7d6707c92a0aa02b00e09dd739128e3c568328282a5ca97a`, `docs/evidence/M-004b_*`). The evidence below stays valid for the pre-review implementation.

## Goal

Prove on a real x402 flow that (1) the Intercepta screen and the policy decision happen **before** anything is signed, (2) an approved PAY signs exactly once and settles on Base Sepolia, and (3) deny, Intercepta failure, quote mutation, expiry and policy change all sign **zero** times, with the agent unable to reach the key.

## Installed packages (verified from `node_modules`, not from memory)

| Package | Version |
| --- | --- |
| `@x402/core`, `@x402/fetch`, `@x402/evm`, `@x402/express` | 2.27.0 |
| `viem` | 2.56.9 |
| `express` | 5.2.1 |
| `better-sqlite3` | 13.0.3 (prebuilt binary works; its `node-gyp` build script is disabled with `allowBuilds: false` because this machine has no C++ toolchain) |

## Observed SDK semantics (read from the installed source)

- **Client flow** (`@x402/core/client`, `x402Client.createPaymentPayload`): select requirement (registered schemes → spend controls → policies → selector) → run `onBeforePaymentCreation` hooks with `{ paymentRequired, selectedRequirements }` → only then call `scheme.createPaymentPayload` (which signs). A hook returning `{ abort: true, reason }` makes the SDK throw `Payment creation aborted: <reason>`; nothing is signed. The requirement object is shared by reference with later hooks and with the scheme.
- **Signer contract** (`ClientEvmSigner`): only `address` and `signTypedData({ domain, types, primaryType, message })` are required. Risksir hands the SDK an object with exactly those, so the raw key never leaves `apps/gate/src/signer`.
- **EIP-3009 typed data** the exact scheme signs: `domain = { name, version, chainId, verifyingContract }` (`name`/`version` from `requirements.extra`), `primaryType = "TransferWithAuthorization"`, `message = { from, to, value, validAfter: 0, validBefore: now + maxTimeoutSeconds, nonce: random bytes32 }`. The SDK reads real `Date.now()`. Permit2 or other typed data is possible via `extra.assetTransferMethod`; the signer refuses everything except the exact `TransferWithAuthorization` shape.
- **Default spend controls**: only recognised default assets (USDC) and a `$1` per-payment cap. The gate tightens this to `$0.10`. A wrong network or non-default asset is filtered by the SDK **before** the hook (so no decision exists); with SDK controls disabled the policy DENYs it (tested both ways).
- **HTTP headers**: `PAYMENT-REQUIRED` (402), `PAYMENT-SIGNATURE` (paid retry), `PAYMENT-RESPONSE` (settlement). Settlement response fields: `success`, `transaction` (the tx hash), `network`, `payer`.
- **Settlement ordering** (docs.x402.org `exact` page): by default `exact` uses the **authorization** flow: verify, run the resource handler, then settle; `upfront` is an opt-in. Risksir keeps the default (ADR-018); settlement and delivery are recorded separately.
- **Facilitator HTTP API** (read from `HTTPFacilitatorClient`): `GET /supported`, `POST /verify`, `POST /settle`. A stub of exactly these is used offline.

## Commands (exact)

```bash
corepack pnpm verify                       # offline: 350 tests incl. signer matrix, key isolation, real local seller + stub facilitator
corepack pnpm wallet:status                # read-only payer balance
LIVE=1 corepack pnpm demo:block            # live Intercepta + real 402 on the RISKY payTo, no payment
LIVE=1 corepack pnpm demo:pass             # live Intercepta + real 402 + real Base Sepolia settlement, 0.05 USDC
corepack pnpm verify:tx <txHash>           # independent on-chain receipt check
corepack pnpm trace:export                 # persisted decision traces
```

## Evidence (2026-09-26, guardrail limits respected: 0.05 USDC per payment, session 1/20 settlements, 0.05/1.00 USDC)

| Item | Result |
| --- | --- |
| Payer wallet (public) | `0x4a599d033E1295E93bbFB5feA17aB44b2CbAD9fD`: 0.1 ETH and 19.99 test USDC before, 19.94 after |
| Live pass | attempt `392a270f-8a18-485e-b3df-9a81b6607feb`: real 402 from the local seller (quoted validity 300 s), live Intercepta of `0x87cff22e…cb1a` = CLEAR (`toxicScore 0`), policy v1 `PAY` (R1), **`signerCalls=1`**, settled |
| Settlement tx | `0x1cf9ae6f4e155214115528bcbfd917c94ece8fb987f68f193a1ef77114478e6b` on `eip155:84532`; independently checked by RPC receipt: `status: success`, block 47331424, USDC `Transfer` from the payer to `0x87cFf22e…cB1A`, value 50000 (`docs/evidence/M-005_tx_receipt_check.json`) |
| Live block | attempt `aae1f854-7804-4135-b0c1-c811d182cad0`: real 402 for payTo `0x39308ae4…2fed`, live Intercepta = BLOCK (`toxicScore 100`, `known_scammer`, `attack_money_target`), policy v1 `DENY` (`EVIDENCE_BLOCK`), **`signerCalls=0`**, no signer timestamp, nothing sent to the facilitator |
| Ordering | Intercepta returned at `13:58:54.189Z`, signer invoked at `13:58:54.207Z` (pass); the schema rejects any attempt whose signer timestamp is not later (INV-019) |
| Raw evidence | `fixtures/intercepta/recorded/2026-09-26T13-58-41-611Z_0x39308ae4…json` (block), `…13-58-54-181Z_0x87cff22e…json` (pass) |
| Persisted traces | `docs/evidence/M-005_prize_checkpoint_traces.json` (exported from `data/risksir.db`) |

Offline (real local `@x402/express` seller, stub facilitator, fixture evidence; **not** live): pass path, block path, Intercepta timeout/500/429/malformed/non-JSON, quote mutation by a later hook (payTo, amount ±1, validity), wrong network and asset, per-payment and period caps, expired decision, policy changed while pending, facilitator dropping the settle connection, settled-but-empty-body delivery, five concurrent attempts against a 0.10 USDC cap (exactly two sign). Signer matrix (49 tests) and key isolation (7 tests).

## Kill-condition check (07 §22)

| Condition | Result |
| --- | --- |
| Intercepta cannot be placed before the actual signer | **Not observed.** It runs inside `onBeforePaymentCreation`, before `scheme.createPaymentPayload`; live timestamps confirm the order |
| The x402 flow can bypass the guard | **Not observed.** Nothing but the guarded object reaches `ExactEvmScheme`; a later hook that mutates the already-decided requirement is refused by the signer (`QUOTE_MUTATED`, tested for payTo, amount, validity); the signer also refuses unsupported typed data; agent code cannot import the signer (static test) |
| No real pass and no real live-risk hold/block | **Not observed.** Both happened live (above). Q-003 (sponsor confirmation that the RISKY address may be a merchant `payTo`) is still a human action |
| Sponsor overlap (Spike E) | Not tested; human action |

## Not yet proven (honest gaps)

- Ambiguous-settlement **reconciliation** against the chain (only the state and the "no release, no re-sign" rule are tested): M-006.
- Real facilitator failure modes (only the stub's `hangup`/`500`/`success:false` were exercised).
- A **live** timeout/mutation run; these are integration-tested against a local seller and a stub facilitator (`fixture`/`synthetic`, never claimed as live).
- Token scan / EIP-712 message scan compatibility (Q-007): not attempted; claim address screening only.

## SPEC OPEN items resolved

Q-005 (SDK packages and hook semantics) and Q-006 (settlement ordering: authorization flow, default) are resolved with ADR-018. Q-009: the payer wallet is funded (19.99 test USDC before the run).
