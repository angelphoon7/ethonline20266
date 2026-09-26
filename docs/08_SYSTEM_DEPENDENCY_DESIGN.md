# 08 — Risksir: System Dependency Design

**Decision gate:** Step 8, before Technical Feasibility Spikes  
**Date checked:** 26 September 2026  
**Inputs:** `docs/07_PROJECT_FREEZE.md`, `docs/00_HACKATHON_CONTEXT.md`, official ETHGlobal Intercepta prize requirements, x402 and Intercepta/W3A documentation.  
**Status:** Design proposal constrained by the frozen product. Interfaces, API response mapping, demo address pairing, and actual settlement remain **unproven until Step 9**. No application implementation has begun.

## 1. Frozen project definition

**Name:** **Risksir**. The mechanism and scope remain the Step 7 freeze.

### User

An organisation's risk/security owner or developer who operates a buyer agent with authority to pay x402 services from an organisation-funded wallet. In the demo, one authorised operator owns one agent, one bounded USDC wallet and one payment policy. The paid service operator is a counterparty, not the policy owner.

### Problem

A current counterparty-risk signal cannot alone decide whether this *agent*, for this *task*, may pay this *quote* under this organisation's limits. A policy can also become overly permissive or disruptive after new incidents. The owner needs payment-time enforcement and a controlled way to learn from outcomes. Demand and relative novelty remain hypotheses.

### Core promise

> The owner can let an agent pay x402 services under a tested, evolving risk policy **without having to manually review every payment or let an AI change spending authority on its own**.

### Core mechanism, seven steps

1. Owner approves risk profile and active version; agent requests an allowed paid resource.
2. Buyer receives a real HTTP 402 and selects an `exact` Base Sepolia USDC requirement.
3. Risksir binds the selected terms to the request, checks local caps, and obtains a *live* Intercepta screen for the selected `payTo` **before signing**.
4. Deterministic policy combines that evidence with amount, task, counterparty history and available budget, producing `PAY`, `CAP`, `HOLD`, `ASK_HUMAN` or `DENY`. A hold/deny makes zero signer calls.
5. For `PAY`, the protected signer checks the same terms and current policy again, then the x402 client signs; the service/facilitator verifies and settles the USDC payment and the buyer records the response.
6. An authorised incident label or later re-screen opens a case. Candidate policies replay against stored cases; the UI shows prevention and friction metrics with provenance.
7. Owner approves a version only after review. A later **new live-screened** x402 attempt uses it and visibly changes its decision; rollback restores the preceding approved version.

### Demo proof

Three observable moments: (A) real 402 → live Intercepta evidence → signed and settled testnet USDC → paid result; (B) a *different* real 402 → live known-risk mainnet address screen tied to its `payTo` → held/denied, **zero signer calls**; (C) incident → two genuinely evaluated candidate rules → approved v2 → a new payment attempt is screened live and its decision differs from v1. A policy preview alone does not prove (C).

**Critical distinction:** Intercepta's mainnet address risk and the Base Sepolia payment are separate observations. For the demo, the testnet `payTo` can be the same 20-byte EVM address screened against supported mainnet data, but it is not proof of that address's real-world seller identity or of risk on Base Sepolia. The sponsor-provided risky address must actually be usable as a merchant `payTo`, or the blocked branch must be labelled as a controlled merchant configuration. Never assert that testnet settlement establishes a mainnet crime.

## 2. End-to-end user flow

| # | Actor | Input → operation → output | Execution |
| --- | --- | --- | --- |
| 1 | Owner | Authenticates; approves profile v1 with wallet scope, asset, network, per-payment and period cap, permitted service/task, risk rules → active v1 | Browser → Risksir backend/database |
| 2 | Agent | Allowed task and resource URL → requests resource *without payment credential* → HTTP 402 | Agent/backend → service |
| 3 | x402 service | Resource route with `exact`, network, USDC price and `payTo` → returns payment requirements | Service/backend |
| 4 | Buyer gate | Parses requirements, selects one supported option and canonicalises scheme/network/asset/atomic amount/recipient/resource/request ID/validity → immutable quote fingerprint | Backend, x402 client |
| 5 | Buyer gate | Quote and task → checks asset allowlist, price ceiling, service scope, expiry, period budget; reserves exposure for concurrent attempts → provisional eligibility or `HOLD` | Backend/database |
| 6 | Intercepta adapter | Actual selected `payTo` interpreted as a real mainnet address → live address scan, request ID, timestamp, raw response → normalised evidence or unavailable | Sponsor API/backend |
| 7 | Policy engine | v1 + live evidence + frozen quote + context → deterministic action and reasons. Unknown/unusable evidence → `HOLD`. Owner approval, if required, applies to this exact attempt and expires | Backend; optional owner browser |
| 8 | Protected signer | For `PAY`, rereads active policy and quote, verifies approval binding and reserved budget, optionally screens compatible EIP-712 authorization before signing if proven; signs *only* bounded x402 payload → payment signature. For `CAP` above price, `HOLD`, `ASK_HUMAN` pending, or `DENY`: no signature | Isolated backend/wallet |
| 9 | Buyer/service/facilitator | Retries same resource with payment payload; verifies terms; facilitator settles USDC on Base Sepolia; service returns paid result and settlement metadata | x402 HTTP, facilitator, chain |
| 10 | Case recorder | Correlates request, quote, evidence, decision, signer count, settlement status, HTTP result and any transaction hash; releases/commits reserved budget → auditable payment case | Backend/database; chain read if needed |
| 11 | Owner | Labels an observed incident in a prior case (or opens a case after a later live re-screen); marks provenance and rationale | Browser/backend/database |
| 12 | Regression engine | Frozen case-set version + v1 + two candidate policies → deterministic per-case decisions and metrics; no signing → comparison report | Backend/database |
| 13 | Owner | Reviews report and approves candidate → transactional activation of v2, with rollback pointer; invalid/untested candidates remain drafts | Browser/backend/database |
| 14 | Agent | Makes a new x402 request; same steps 2–10 with *fresh* Intercepta evidence and v2 → changed action and visible trace | Buyer gate, sponsor API, x402, perhaps chain |

`ASK_HUMAN` means the attempt is paused until a scoped approval is recorded and revalidated. `HOLD` means no payment until an issue is resolved; `DENY` ends this attempt. `CAP` is a maximum authorised amount, **not a unilateral price reduction**: an `exact` quote above it is held or a genuinely advertised cheaper offer is newly selected and screened. A human override never waives an absolute hard prohibition.

## 3. Component map

| Component | Responsibility and inputs → outputs | Owned state | Trust and failure effect |
| --- | --- | --- | --- |
| Owner console | Displays profiles, cases, reasons, candidate comparison and approval/rollback; authorised commands → UI state | No authoritative payment policy in browser | UI can lie or fail; backend rechecks auth and every command. No UI → autonomous approved payments can continue, new approvals pause. |
| Buyer agent | Requests only allowlisted task resource; 402 → proposed paid request | Task/session only; **no payer key or raw payment-signing API** | May be compromised or invent context; typed server-side scope and caps constrain it. Failure → no new requests. |
| x402 buyer gate | Parses and selects actual 402 terms; fingerprints them; calls policy, Intercepta, signer and HTTP retry | Short-lived attempt and persisted status | Correctness-critical local code. Parse/hook bypass → unsafe signature; cannot use an unguarded wrapper elsewhere. |
| Intercepta adapter | Live quick/deep address screen using sandbox key; raw result → typed evidence, timestamp, provenance | Response snapshot in case store | Trust Intercepta for what its evidence states, *not* for seller honesty or delivery. API unavailable/ambiguous → `HOLD`; no cached pass for a new payment. |
| Deterministic policy engine | Profile + active policy + immutable quote/context + evidence → action, reason codes, exposure decision | Reads versioned rules; no key | Logic bug can misclassify; versioned cases reveal behaviour, but history cannot prove future correctness. |
| Protected signer | Accepts internal bounded authorisation only; checks same quote/version/limits/approval → signs one permitted x402 authorization | Key in isolated process/service; replay and in-flight attempt ledger | Trusted for correctness and key custody. Compromise defeats promise; failure means no payment. Agent cannot call it directly. |
| Case/policy store | Transactional organisation scope, budget reservations, snapshots, cases, immutable approved versions and active pointer | Authoritative *offchain* governance/audit state | Trusted for correctness, integrity, access control and availability. Centralisation is explicit; outage → no fresh signing. |
| Regression runner | Stored evidence/cases + candidate rules → per-case replay and measured differences | Immutable dataset/report snapshots | Trusted for honest metrics, not signing; failure blocks promotion but not v1 payments. Synthetic labels never count as observed outcomes. |
| x402 paid service | Serves real 402 and resource after valid payment | Merchant route configuration | May change quotes or fail delivery; gate rechecks quote and records settlement separately from service quality. |
| Facilitator + Base Sepolia USDC | Validate/settle signed payment under `exact`; transfer result → chain state and receipt | Facilitator service, USDC ledger/nonces onchain | Trust service for liveness/accurate reporting; verify receipt when possible. Failure may leave ambiguous settlement: reconcile before retry. |

For MVP these can be modules in one backend with a separate key boundary, not separate network services. No solver, indexer, escrow, bespoke policy smart contract, oracle, relayer, ML model or agent-to-agent protocol extension is required.

## 4. Onchain/offchain boundary

| Operation | Onchain / offchain | Reason |
| --- | --- | --- |
| x402 EVM `exact` authorization | Signed offchain; eventually enforced onchain | EIP-3009 USDC authorization is signed locally; facilitator submits valid transfer. Signature itself is a spend capability, so pre-sign screening matters. |
| USDC transfer and authorization nonce consumption | **Onchain** on Base Sepolia | Asset ownership, replay protection under token scheme and auditable balance change. One token execution is atomic onchain. |
| Quote parsing, risk scan, policy decision and spend-limit check | Offchain | No public consensus or asset ownership requirement; sponsor API and company context are offchain. |
| Budget reservation and reconciliation | Offchain transactional DB | Prevent concurrent buyer attempts from each individually passing the same daily budget. Does not guarantee permissionless enforcement if the key escapes. |
| Policy versions, approval, rollback, audit hash, incident labels | Offchain | One-organisation governance does not need public chain state. DB transactions provide local atomicity; immutable records and access controls support demo audit. |
| Historical replay and comparison | Offchain | Bounded deterministic compute over private and synthetic data; chain execution would add cost without security benefit. |
| Service response and delivery assessment | Offchain | HTTP/data quality is not proven by USDC transfer. |
| Optional public policy attestation | **Excluded** | Adds a chain transaction without improving the frozen user promise or sponsor fit. |

**Web3 necessity:** x402 supplies the machine-readable payment demand and signed blockchain money movement. Risksir governs the offchain authorisation point. Its company policy store could be a conventional database because it is company owned; do not claim the policy itself is decentralised or tamper-proof onchain.

## 5. State model

| Object / ID | Owner; fields | Lifecycle; source of truth; mutability |
| --- | --- | --- |
| `Organisation/orgId` | Owner/admin IDs, payer address, service/task allowlist | Configured → active; DB; authorised mutable config with recorded history. |
| `RiskProfile/profileVersion` | Organisation; network/USDC allowlist, per-payment/period limits, hard denials, review capacity | Draft → approved → superseded; DB append-only approved versions. Changes constitute policy promotion. |
| `PaymentPolicy/policyVersion` | Organisation; typed predicates, ordered decisions, approval and rollback parent, effective time | Draft → replayed → approved → active → superseded/rollback; immutable version in DB plus atomic active pointer. Never edited in place. |
| `PaymentAttempt/attemptId` | Buyer gate; org/agent/task/resource, selected requirements, canonical quote hash, request fingerprint, expiry, policy version, status | Created → quoted → screened → decided → signed → submitted → settled/failed/ambiguous; DB. Status mutable, snapshots immutable. |
| `RiskEvidence/evidenceId` | Intercepta raw result; endpoint, address, interpreted mainnet, timestamp, provider request ID if any, normalised reason/status, API/fixture provenance | Captured per real decision; DB immutable raw snapshot. A replay uses then-observed evidence, never a fabricated past verdict. |
| `SpendReservation/reservationId` | Organisation/wallet/period; amount atomic, attemptId, expiry, committed amount | Reserved → committed/released/reconciled; DB transaction. Onchain USDC balance is separate truth. |
| `Decision/decisionId` | Gate; quote hash, evidence ID, policy version, action, reasons, signer-eligibility expiry, human approval reference | Decided → consumed/expired; DB append-only. A fresh attempt requires fresh evidence. |
| `PaymentOutcome/outcomeId` | Facilitator/chain/HTTP observations; tx hash, settlement status, response status, data-received flag | Pending → settled/failed/ambiguous; DB observations; **USDC ledger/receipt onchain authoritative for transfer**. Delivery label is operator/service observation. |
| `PaymentCase/caseId` | Organisation; attempt refs, labels (`good`, `bad`, `unknown`), label provenance, timestamp/rationale | Open → labelled/reviewed → included in dataset; DB append-only label revisions. `unknown` excluded from prevention denominators. |
| `CandidatePolicy/candidateId` and `RegressionReport/reportId` | Owner or optional analyst proposes typed rules; dataset snapshot/hash, engine version, baseline/candidate per-case decisions, metric numerators and denominators | Draft → evaluated → rejected/approved; DB immutable report bound to exact policy+dataset. No signing authority. |

No onchain `PolicyApproved` event exists in this MVP. The chain exposes token transfer/authorization effects and transaction receipts. Policy governance emits **application audit events**, explicitly offchain.

## 6. Transaction and event model

### Main blockchain transaction: x402 `exact` USDC settlement

| Field | Design |
| --- | --- |
| Caller | Facilitator/settlement submitter, following resource-server verification (precise caller depends on chosen facilitator). |
| Contract | Official Base Sepolia USDC token `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, under `eip155:84532`; EIP-3009 path when advertised and selected. |
| Preconditions | Correct typed authorization signature, authorised payer, exact recipient/amount/token/network, validity window and unused nonce; payer balance; facilitator and resource server accept the declared x402 terms. The *company policy decision is not checked by USDC*; only Risksir's protected signing boundary enforces it. |
| State transition | Payer USDC decreases, recipient USDC increases, authorization consumed onchain, in one token transaction if successful. |
| Chain event/evidence | ERC-20 `Transfer` plus token-specific authorization event if emitted by the deployed implementation; tx receipt/hash and facilitator settlement response. Do not assert event names beyond verified deployment. |
| Failure | Invalid/expired/used signature, wrong network/asset, insufficient funds, facilitator unavailable or verification/settlement error. Receipt ambiguity requires reconciliation before any re-sign/retry. |

**No other application chain transactions are required.** Funding wallet with test USDC is setup. A one-time approval would arise only if switching from the selected EIP-3009 path to Permit2; that is outside this minimum design and would reopen the signer threat model.

The x402 `exact` documentation distinguishes its default **authorization** ordering (verify first, run the resource handler, then settle) from the optional **upfront** ordering (settle before handler). The chosen server configuration must be recorded in Step 9. Neither ordering makes paid service delivery atomic with the USDC transfer; a successful handler followed by failed settlement or settled payment followed by failed client receipt still needs an explicit status and reconciliation path.

**Offchain events consumed/recorded:** `QuoteSelected`, `RiskScreenRequested/Returned/Unavailable`, `PolicyDecided`, `SignerInvoked`, `PaymentSubmitted`, `SettlementObserved`, `ResourceReturned`, `IncidentLabelled`, `RegressionCompleted`, `PolicyApproved/Activated/RolledBack`. Source is the backend's transactional event log; optional chain receipt lookup reconciles settlement. There is no mandatory third-party indexer or live chain subscription.

## 7. Trust model

| Question | Answer and enforced boundary |
| --- | --- |
| Can the agent lie? | It can suggest malicious URL/task/context. Backend restricts actual resource scope, derives quote terms from the 402, authenticates agent identity, and keeps key inaccessible. A fabricated task label cannot raise a cap. |
| Can the frontend lie? | Yes. Browser output is untrusted; backend authorises owners, evaluates policies, and signs only after local checks. |
| Can the backend alter intent? | A compromised backend/store/signer can defeat the promise. This MVP is custodial/centrally trusted for correctness; signatures and onchain receipts do not prove policy compliance to an outsider. |
| Can the sponsor lie or be stale? | Evidence is a provider assertion, not ground truth. Preserve raw response/time, use bounded freshness, treat error/unknown as `HOLD`, and say exactly what was screened. |
| Can a case label lie? | Yes. Only authorised owner may label it; keep source, timestamp and revisions. Replay measures decisions against those labels, not actual prevented losses. |
| Can a quote change? | Yes. Fingerprint ties network, asset, amount, `payTo`, scheme, resource and attempt to decision. Mutation or expiration forces a new check. |
| Can settlement occur without Risksir authorisation? | Not through its protected signer if key and all signing routes are isolated. An exposed payer key, prior signature, or another wallet approval is outside this gate's control. Onchain USDC knows nothing of company policy. |
| Can concurrent spends exceed a daily cap? | They could without serialised reservations. Hold a DB reservation across signing/submission; reconcile it with receipt, expiry and ambiguous states. Never release solely on HTTP timeout. |

**Trusted for availability:** Intercepta API, x402 service, facilitator, RPC/testnet, backend, DB, owner console. Their outage produces hold, pending or no new payment; existing onchain transfers persist.

**Trusted for correctness:** protected signer/key custody, Risksir policy/quote parser, DB active-version and budget transaction, owner approvals and incident labels, Intercepta's signal quality, facilitator validation and USDC contract for actual settlement. Policy correctness is *not* permissionlessly verified by Risksir's own onchain contract.

**Human approval:** authenticated owner with organisation role; approval binds attempt hash, maximum amount, version and expiry. Recheck live evidence and exact terms before a delayed signature. AI may explain/propose but cannot sign, approve or activate.

## 8. Atomicity and independent failures

| Coupled actions | Atomic boundary and partial-failure response |
| --- | --- |
| Decide + authorise signer | A single immutable decision binds quote/evidence/version/expiry. Signer revalidates active version and reservation just before signing. Policy change while pending invalidates old authorisation; it is not a chain-wide atomic lock. |
| Reserve cumulative budget + mark attempt eligible | One serialised DB transaction. If it fails, no signature. Commit on confirmed settlement; release only after confirmed non-settlement or expired unusable authorization. Ambiguity stays reserved until reconciled. |
| USDC debit + merchant credit + nonce use | Same token settlement transaction; failure reverts entire token operation. The HTTP resource response is separate and may fail after payment. |
| Promote policy + change active pointer + log approval | One DB transaction conditioned on matching dataset/report hashes and owner auth. Failure leaves prior policy active. Rollback is a new logged pointer transition. |
| Payment + case write | Cannot be atomic across chain and DB. Persist attempt before signature; reconcile tx/receipt after crash. Case status may temporarily say `ambiguous`, never infer unpaid from missing HTTP response. |
| Payment + service delivery | Cannot be assumed atomic. Record `settled` separately from `resource_received`; do not promise refund or delivery guarantee. |
| Intercepta call + onchain execution | Cannot be atomic or guarantee risk state remains unchanged. Set a short validity window, recheck on material delay/quote mutation, and state the residual time-of-check gap. |

The regression runner, UI, case labelling and later re-screen can fail independently without reversing a settled payment. Intercepta/DB/signer failures on the pre-sign path stop *new* signing. Facilitator failure after signing can cause an ambiguous outcome, requiring receipt/nonce reconciliation before retry.

## 9. Sponsor dependency graph

| Sponsor / exact primitive | Component and exact capability | User capability and removal test | Class |
| --- | --- | --- | --- |
| **Intercepta**, documented W3A API `GET /api/public/v2/extension/account/{address}/quick-scan` with `X-API-KEY`; evaluate `Deep Scan Address` if quick result lacks usable reason/flags. Mainnet `payTo` subject. | Adapter obtains live pre-sign address assessment. The public quick-scan page calls it a toxic score, **not a guaranteed `CLEAR/WARN/BLOCK` schema**. Exact mapping and sandbox access require spike. | Owner sees external risk alter a real signer decision. Removal breaks frozen live-evidence promise and the Intercepta prize requirement. | **CORE** |
| **x402 protocol/SDK**, `@x402/core`, `@x402/fetch`, `@x402/evm` `ExactEvmScheme`, `onBeforePaymentCreation`, `exact` EIP-3009; seller middleware `@x402/express`; x402.org test facilitator; Base Sepolia `eip155:84532` USDC. | Buyer gate handles real 402/selected terms and pre-sign hook; service/facilitator verifies and settles machine payment. | Agent pays a real resource without a human checkout; policy acts at signature boundary. Removal makes it an ordinary risk-dashboard demonstration. x402 is protocol infrastructure, **not an asserted ETHGlobal sponsor prize**. | **CORE** |
| **Base Sepolia / USDC settlement infrastructure**, official test USDC contract above. | Facilitator moves test USDC; receipts show payer/recipient transfer. | Observable money movement. Without a supported chain/token, no real x402 settlement, though this particular network is a selected implementation choice. | **CORE to demo path; network substitution possible** |
| **Intercepta Scan Token / Scan Message**, `GET .../token-intelligence/token/{address}/risks` and `POST .../analysis/signature` accepting EIP-712 fields. | Potential stronger token/auth checks. Token contract allowlist already prevents lookalikes; Scan Message may reject testnet `chainId` or require payload format not generated at the hook. | Adds defence only if proven compatible and decision-changing. Removal leaves required live address screening and core loop. | **STRUCTURALLY USEFUL if feasible; not MVP gate** |

No sponsor is assigned for the offchain replay engine, DB, wallet or frontend. No secondary prize integration is implied. Intercepta Automation Rules exist, but Risksir is **not** claiming they lack custom logic or adaptive global threat signals. The distinct hypothesis is owner-labelled x402 payment cases → reproducible policy replay → approved future signing decisions; overlap still requires direct verification.

### Interaction graph

```text
Owner policy v1 ──→ Risksir buyer gate ←── Agent + real x402 HTTP 402
                           │
                     selected payTo
                           ↓
                 Intercepta live address scan
                           ↓
                deterministic owner policy
                   ├── hold/deny → no signature
                   └── pay → protected signer → x402 facilitator → Base Sepolia USDC
                           │
                   outcome + incident case
                           ↓
             replay candidates → owner approves v2
                           ↓
                  next live-screened x402 decision
```

Intercepta and x402 do **not** directly integrate here. Risksir takes the `payTo` from x402's selected requirement into Intercepta, then controls whether x402 can create a signature. Replay uses stored evidence snapshots and the next payment gets a new live call.

## 10. External dependency register

| Dependency | Required? | Failure risk | Backup / honest response |
| --- | --- | --- | --- |
| Intercepta sandbox key, quota and address-screen endpoint | Yes | Delayed key, quota, schema, errors, mainnet address without useful reason | Obtain key/known-risk examples early; stop signing on outage; do **not** substitute a mocked response for qualifying demo. |
| Sponsor Discord known-risk mainnet address and permitted demo use | Yes for reproducible block | Address unavailable, result changed, cannot be tied to controlled 402 `payTo` | Arrange second known-risk address with sponsor; if unavailable, show honest failure and do not claim qualification. |
| x402 TypeScript SDK packages and pre-sign lifecycle hook | Yes | Hook timing, selected terms mismatch, indirect signer bypass | Manual parse and explicitly guarded client is possible only after a spike proves end-to-end signing and settlement; otherwise architecture gate fails. |
| x402.org test facilitator and `@x402/express` merchant | Yes for chosen path | Verify/settle outage, non-idempotent retry | Test another documented facilitator only if it supports same testnet/scheme; retain signed/ambiguous status and reconcile. |
| Base Sepolia RPC, test ETH and official test USDC | Yes | Faucet, RPC, balance, chain outage | Fund early, keep deterministic funded wallets; recorded fallback labelled as recorded, never as live. |
| Org owner wallet/auth and isolated test payer key | Yes | Key leaked, wrong identity, signer unavailable | Keep key server-side and tiny funded balance; fail closed. Owner UI auth may be simple hackathon role login, but access control must be real. |
| Backend and transactional DB (SQLite/Postgres) | Yes | Crashes, concurrent cap overspend, corrupt state | Single instance transactional SQLite adequate if serialised and persisted; restore from backups; fail closed on DB unavailability. |
| Case fixtures | Yes for replay | Synthetic labels misrepresented as historical truth | Label every case real, sponsor-known-risk, controlled or synthetic; calculate metrics from actual stored records. |
| Indexer, subgraph, oracle, cloud queue, LLM | No | Added moving parts | Omit. Receipt lookup and controlled labelling cover MVP. |

## 11. Technical unknown register

Priority: **P0** can kill the current architecture/qualification; **P1** requires meaningful redesign or differentiation review; **P2** is a local implementation inconvenience. A documentation example is evidence of a supported feature, not a successful integration in Risksir.

| Unknown | Priority | Why it matters | Fastest experiment | Expected success condition |
| --- | --- | --- | --- | --- |
| Sandbox key, address endpoint and response semantics produce a live decisive signal on the actual selected merchant `payTo` | **P0** | No real sponsor-driven pass/block if unavailable or opaque | Obtain key; call quick/deep scan on sponsor known-risk and acceptable mainnet addresses; save raw response/errors and map only observed fields | Two reproducible responses with actionable evidence; blocked case tied to chosen x402 recipient; live API before signing |
| Protected x402 signing boundary is interceptable and non-bypassable | **P0** | Agent or wrapper may sign before checks | Minimal real 402 + SDK `onBeforePaymentCreation` + instrumented signer; mutate quote, timeout API, hold, pass | Allowed branch signs once; held/denied/error/mutated paths sign zero times; only gate owns signer |
| Exact EVM USDC path settles on chosen Base Sepolia facilitator | **P0** | Real payment and receipt required | Tiny funded `exact` seller/buyer call with selected SDK and official USDC | HTTP 402 → valid settlement/tx → paid resource, reproducibly |
| Sponsor-known-risk mainnet address can be associated truthfully with a runnable testnet merchant quote | **P0** | Mainnet scan unrelated to testnet recipient would misrepresent the screen | Use same EVM address as controlled test seller `payTo`; have sponsor confirm acceptable fixture and response | A real quote's `payTo` is precisely the screened mainnet address; known risk causes live hold |
| Signed but unconfirmed payment can be reconciled before reservation release/retry | **P1** | Ambiguous HTTP failure risks duplicate spending or incorrect daily caps | Interrupt between signed retry and receipt; inspect facilitator status, tx/nonce and replay behaviour | Attempt remains reserved/ambiguous until chain evidence resolves, no fresh unsafe signature |
| Concurrent attempts cannot overshoot period limit | **P1** | Individual caps are insufficient under concurrency | Parallel two above-half-budget quotes against one DB | At most one reserves/signs; aggregate reservations+settled spend ≤ cap |
| Owner approval/version activation consistently binds future signer decisions | **P1** | v2 may be cosmetic or stale decision may sign after promotion | Replay two candidates from cases; activate v2; issue new live-screened 402; change policy during pending attempt | Computed report, explicit approval, atomic active pointer and visibly changed later decision; stale approval invalidated |
| Intercepta already offers the same customer-specific historical replay, version comparison and risk-appetite optimisation for x402 | **P1 differentiation gate** | If yes, frozen differentiation must be reopened | Ask sponsor specifically; inspect API/product demonstration, record answer and exact scope | Confirm a defensible gap; if equivalent, return to Step 6/7 rather than claiming novelty |
| EIP-712 Scan Message and token scan accept this testnet authorization and return useful results | **P1 only if made mandatory**, otherwise P2 | Claimed token/auth coverage may be unsupported | Submit actual pre-sign typed payload and official USDC address using allowed chain ID | Compatible live response affects decision; otherwise leave optional and claim only address screening |
| Later risk-state change/alert API exists and is usable | **P2** | Nice feedback trigger, not needed with owner incident label | Re-screen prior address and compare snapshots; ask for webhook/history | Truthful change case if observed; otherwise incident-labelled case supports MVP |
| Exact field names, timeouts, freshness and rate limits | **P2** | Adapter/parser reliability | Capture schema/error/rate responses from a few real calls | Typed parser handles observed variants; unknown → hold |

## 12. MVP architecture

### Required components

1. One x402 paid service on Base Sepolia `exact` USDC and one buyer agent constrained to a resource/task.
2. Risksir buyer gate with strict quote parsing, `onBeforePaymentCreation` enforcement, budget reservation and isolated protected signer.
3. Live Intercepta mainnet `payTo` address screen and raw response capture for **each** real payment decision.
4. Deterministic, typed versioned policy engine and tiny owner console showing quote, evidence, reason, signer count and settlement/delivery separately.
5. Transactional offchain case/policy DB, one authorised incident label path, two candidate rules, actual replay with denominators/provenance, owner approval and activation/rollback.
6. One successful payment; one live-risk hold/block; one replay-approved policy causing a later freshly screened x402 decision to change.

### Optional components

- Deep address scan if quick scan lacks usable reasons; compatible token and EIP-712 message scans if Step 9 proves them.
- Later re-screen trigger; exact same corpus used to demonstrate new evidence, with original response preserved.
- AI analyst that proposes typed candidate policies with no signing/activation rights.

### Remove from MVP

New smart contracts, onchain policy registry, indexer, public risk reputation, credit score, escrow/refund, multi-chain, universal AML, autonomous self-modifying policy, broad agent framework, secondary sponsor filler. A new contract is justified only if a spike establishes a concrete correctness property impossible at the protected signer boundary; that would require explicit architecture review.

### Claim boundaries

- `CLEAR` or low score means no disqualifying observed signal, never guaranteed merchant safety.
- Replay reports counterfactual action on labelled cases, **not** measured financial loss prevented in production.
- Merchant may be paid without usable service delivery; show both states.
- Risksir is trusted offchain governance around an onchain payment, not a trustless policy protocol.
- Official Intercepta prize requirements: live API in payment flow, result changes action, real mainnet address screen despite testnet settlement, pass and block/hold, public repo and API feedback. Eligibility must be rechecked before submission.

## Sources checked

- [ETHGlobal Tokyo 2026 Intercepta prizes and qualification](https://ethglobal.com/events/tokyo2026/prizes)
- [x402 buyer quickstart and spend controls](https://docs.x402.org/getting-started/quickstart-for-buyers)
- [x402 seller quickstart, Base Sepolia example](https://docs.x402.org/getting-started/quickstart-for-sellers)
- [x402 lifecycle hooks](https://docs.x402.org/advanced-concepts/lifecycle-hooks)
- [x402 exact payment scheme](https://docs.x402.org/schemes/exact)
- [x402 network/token support and test facilitator](https://docs.x402.org/core-concepts/network-and-token-support)
- [x402 facilitator flow](https://docs.x402.org/core-concepts/facilitator)
- [Intercepta/W3A Quick Scan Address](https://docs.web3antivirus.io/reference/quick-scan-address)
- [Intercepta/W3A Scan Token](https://docs.web3antivirus.io/reference/scan-token)
- [Intercepta/W3A Scan Message](https://docs.web3antivirus.io/reference/scan-message)
- [Intercepta Automation Rules](https://intercepta.io/products/automation-rules)

# STEP 9 SPIKE QUEUE

Run these in dependency order. Only **P0/P1** uncertainties from §11 are included; experiments should be small and preserve raw outputs.

1. **P0 — Sponsor semantics and fixture linkage.** Get sandbox key and sponsor-known-risk address. Call live address API on the exact intended `payTo` and an acceptable comparator; record schemas and reasons. Prove a controlled merchant can quote that same 20-byte address on Base Sepolia. Stop if the only demonstrated risk subject is unrelated to the quote.
2. **P0 — Protected signer and real x402 settlement.** One `exact` 402 using official Base Sepolia USDC, a live pre-sign hook and instrumented isolated signer. Prove pass → one signature → settlement/paid response; live-risk block/timeout/quote mutation → zero signatures. Confirm no other agent signing route.
3. **P1 — Budget and ambiguous-settlement safety.** Run concurrent attempts against one cap and interrupt a request after signing. Show serialised reservation and receipt/nonce reconciliation before release or retry.
4. **P1 — Regression and promotion end to end.** Replay two candidate typed policies over labelled case snapshots; inspect per-case decisions and computed metrics; approve v2 and prove it changes a *new live-screened* x402 decision. Test pending v1 approval invalidation and rollback.
5. **P1 — Sponsor overlap.** Ask Intercepta whether customer-specific historical x402 payment-policy replay, policy version comparison and risk-appetite optimisation already exist and in what API/product. Record answer and reopen Step 6/7 if the claimed distinction collapses.
6. **Conditional P1 — Expanded token/authorization coverage.** Only if Risksir decides these are essential to its demo claim, submit actual x402 EIP-712 authorization and official test USDC to the documented endpoints. If incompatible, narrow the claim to address screening; do not hold up the frozen minimum flow for an optional check.

**Exit gate:** Do not freeze full architecture or begin full application implementation until P0 passes and P1 has an observed resolution or an explicit, bounded design change.
