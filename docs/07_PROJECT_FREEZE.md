# 07 — PROJECT FREEZE: Closed-Loop Risk Policy for Autonomous x402 Payments

**Decision date:** 26 September 2026 (Europe/London)  
**Decision owner:** Human project owner selected the revised Intercepta direction after challenging earlier threat-memory, forensic-only, and generic payment-firewall concepts.  
**Status:** **Product concept, differentiation hypothesis, and hackathon MVP scope frozen for the next technical verification pass.** Technical feasibility, novelty, product demand, prize eligibility, and Finalist prospects are **not** frozen as proven.  
**Supersedes:** The prior `07_PROJECT_FREEZE.md` direction centred on a scoped buyer guard that performed a one-shot Intercepta check before signing. That pre-sign safety boundary remains necessary, but it is no longer the whole product.  
**Project name:** **Risksir**. This is the chosen public name; product scope and decision gates remain unchanged.  
**Primary partner prize:** ETHGlobal Tokyo 2026, Intercepta — *Safe Agent-to-Agent Payments with x402*.  
**Core product thesis:** **Intercepta detects and explains live onchain risk. Risksir governs how a specific organisation should respond to that risk, tests policy changes against historical payment outcomes, and promotes only validated changes into a versioned payment-policy library.**

> **Plain-language concept:** An organisation defines how much payment risk its autonomous agents are allowed to take. Before every x402 payment, the actual payment terms are screened live with Intercepta and evaluated against the organisation's current policy. When a payment outcome, later risk update, or incident shows that the policy was too permissive or too strict, Risksir does not simply add the wallet to a blacklist. It turns the case into a policy-regression test, replays candidate policy changes against historical good and bad payments, measures the trade-offs, and promotes an approved policy version for future agent payments.

---

## 1. Exactly what is frozen

| Dimension | Frozen decision |
| --- | --- |
| Primary user hypothesis | Security/risk owner, treasury operator, platform engineer, or developer responsible for autonomous buyer agents that can make x402 payments on behalf of an organisation. Actual willingness to adopt remains unverified. |
| Core job | Keep agent payments autonomous while constraining them to the organisation's own risk appetite and continuously improving the payment policy from observed outcomes. |
| Narrow problem | A live risk provider can describe a counterparty or authorization, but the organisation still needs to decide **what that signal means for this agent, this amount, this task and this company's risk tolerance**. Static rules may become too permissive, too strict, or stale as payment behaviour and risk intelligence evolve. |
| Primary promise | Every x402 payment passes through a pre-sign decision point combining **live Intercepta evidence + organisation-owned payment policy + payment context**. Incidents and outcomes can become regression cases. Candidate policy changes are replayed before they are approved and deployed. |
| Core innovation hypothesis | **Closed-loop payment-policy governance for autonomous agents:** incident/outcome → policy diagnosis → candidate change → historical replay → measured trade-offs → approved policy version → future pre-sign enforcement. |
| Intercepta dependency | Intercepta supplies live external risk evidence about the selected payment subject before signing/acceptance. Its result must materially affect at least one real payment decision. |
| x402 dependency | x402 provides the machine payment flow, real `402 Payment Required`, selected payment terms, authorization and settlement path. The project must intercept a real payment decision, not simulate a checkout screen. |
| Knowledge asset | A **Verified Policy Library / Incident Regression Suite**, not a competing threat database. It stores organisation-specific cases, tested policy versions, evidence and measured effects. |
| Default enforcement actions | `PAY`, `CAP`, `HOLD`, `ASK_HUMAN`, or `DENY`, with explicit reasons. Missing or unusable live risk evidence fails closed. |
| AI role | AI may explain incidents or propose candidate rules, but **AI does not directly sign payments or silently deploy new money-moving policy**. Enforcement, replay metrics and signer gating remain deterministic/testable. |
| Product status | Promising sponsor-focused hackathon candidate. Differentiation from Intercepta Automation Rules and from traditional fraud-rule backtesting is still a hypothesis that must survive the immediate technical and sponsor verification pass. |

### Frozen non-claim

This project **does not claim** that Intercepta lacks custom rules, lacks adaptive risk scoring, or fails to update threats. Intercepta publicly documents custom thresholds, custom logic, custom triggers, continuous rule evolution, dynamic risk-state refresh, forensic tracing, and automated responses.

Therefore the project is **not**:

- a replacement risk engine,
- a second scam database,
- a generic wallet blacklist,
- a generic "Intercepta verdict → if red, block" wrapper,
- a claim that company-specific rules alone are novel.

The candidate differentiation is the **organisation-specific policy-learning and regression-governance loop around agent payments**.

---

## 2. Product boundary: Intercepta versus Risksir

### Intercepta is responsible for

- Current onchain risk intelligence.
- Wallet, token, contract, signature/message or transaction screening where supported by the documented API.
- Risk reasons such as sanctions/AML exposure, scam/phishing attribution, stolen-funds exposure, token authenticity, drainer or malicious activity indicators.
- Dynamic risk-state updates as behaviour, provenance and global threat intelligence evolve.
- Entity/cluster/fund-flow evidence where the product/API exposes it.
- Existing programmable automation capabilities on Intercepta's own platform.

### Risksir is responsible for

- Representing an organisation's **risk appetite for autonomous payments**.
- Combining live Intercepta signals with local payment context.
- Mapping that combined context to `PAY / CAP / HOLD / ASK_HUMAN / DENY`.
- Recording the decision, policy version, payment context and outcome.
- Detecting that a previous policy decision deserves review because of a later incident/outcome/risk-state change.
- Generating or accepting candidate policy changes.
- **Replaying candidate policy versions against a historical/controlled regression suite.**
- Measuring security and operational trade-offs.
- Requiring approval before a candidate becomes active policy.
- Versioning and retaining verified payment-policy knowledge for future agent decisions.

### One-sentence separation

> **Intercepta learns what is dangerous. Risksir learns how this organisation's agents should respond to danger.**

This separation is part of the freeze. If real Intercepta capabilities already include the same organisation-specific historical replay, policy optimisation and deployment loop, the differentiation claim must be reopened.

---

## 3. The company risk profile

The product does **not** reduce company settings to a cosmetic `LOW / MEDIUM / HIGH` toggle.

The minimum risk profile should express concrete operating constraints, for example:

```yaml
organisation:
  name: ExampleCo

risk_appetite:
  max_single_payment_usdc: 100
  max_daily_agent_loss_tolerance_usdc: 500
  max_unknown_counterparty_payment_usdc: 10

  sanctions_policy: zero_tolerance

  first_time_counterparty:
    default_action: cap
    cap_usdc: 10

  intercepta_warn:
    below_usdc: 2
    action: pay
    above_usdc: 2
    action: ask_human

  intercepta_block:
    action: deny

operations:
  max_manual_reviews_per_day: 20
  target_auto_approval_rate: 0.95
```

This schema is illustrative. It is **not** a claim about Intercepta's actual field names or score semantics.

The implemented MVP must derive its real fields only after observing the live Intercepta responses available during the hackathon.

---

## 4. Core closed-loop mechanism

### 4.1 Forward path — pre-sign risk decision

```text
OWNER / COMPANY
defines risk appetite
        |
        v
AUTONOMOUS AGENT
requests paid resource
        |
        v
REAL x402 402 RESPONSE
        |
        v
SELECTED PAYMENT REQUIREMENT
        |
        +----------------------+
        |                      |
        v                      v
LOCAL PAYMENT CONTEXT     LIVE INTERCEPTA
amount / asset / task     payTo / token /
history / policy state    authorization where supported
        |                      |
        +----------+-----------+
                   |
                   v
           POLICY DECISION
                   |
       +-----------+-----------+-----------+-----------+
       |           |           |           |           |
      PAY         CAP         HOLD      ASK HUMAN     DENY
                   |
                   v
            PROTECTED SIGNER
```

The agent never gets an unguarded route to the payer key.

A blocked or held transaction must produce **zero signer calls**.

### 4.2 Feedback path — outcome and incident capture

After a payment attempt, record:

- selected quote,
- Intercepta evidence actually returned,
- active policy version,
- resulting action,
- whether signing occurred,
- settlement state,
- service/delivery outcome where observable,
- later dispute or incident status,
- later Intercepta risk-state change if re-screened,
- human override if one occurred.

A case can be reopened when new evidence indicates that the old decision should be reviewed.

### 4.3 Regression path — policy learning

```text
INCIDENT / OUTCOME
       |
       v
"Did our payment policy behave correctly?"
       |
       v
POLICY FAILURE / POLICY FRICTION ANALYSIS
       |
       v
CANDIDATE POLICY CHANGE
       |
       v
HISTORICAL REPLAY
       |
       +-----------------------------+
       |             |               |
       v             v               v
loss prevented   false positives   review load
       |             |               |
       +-------------+---------------+
                     |
                     v
              COMPARE TRADE-OFFS
                     |
             +-------+-------+
             |               |
          REJECT           APPROVE
                             |
                             v
                   VERIFIED POLICY LIBRARY
                             |
                             v
                      POLICY VERSION N+1
```

### 4.4 What is learned

The system does **not** primarily learn:

```text
wallet 0xABC = bad
```

It learns organisation-specific decision knowledge, for example:

```text
Policy Case #017

Context:
- first-time counterparty
- payment amount > 20 USDC
- Intercepta verdict = WARN
- indirect-risk reason present

Old policy:
- allow WARN below 100 USDC

Observed issue:
- unacceptable loss / incident

Candidate:
- cap first payment at 2 USDC
- ask human above 20 USDC

Regression:
- historical incidents prevented: 8 / 9
- legitimate payments changed: 3.2%
- additional manual reviews: 4 / day
- simulated capital delayed: 1.8%

Status:
VERIFIED
```

---

## 5. Why regression testing is central

The product is **not merely a knowledge base**.

The knowledge store is an output of the process.

The primary mechanism is:

> **Every meaningful payment-policy failure can become a regression case. Every policy change must demonstrate its effect before deployment.**

Software-engineering analogy:

```text
software bug
→ regression test
→ verified fix
→ release
```

becomes:

```text
payment-policy failure
→ payment regression case
→ verified policy change
→ policy deployment
```

### Required regression questions

For each candidate policy:

1. Would it have prevented or reduced known bad outcomes?
2. How many legitimate historical payments would change action?
3. How much valid payment value would be capped, delayed or denied?
4. How many additional human reviews would it create?
5. Does it accidentally weaken another existing policy?
6. Does it remain consistent with the organisation's declared risk appetite?
7. Does it still require a live Intercepta call at the real pre-sign decision?

### Important prior-art boundary

Historical rule backtesting is **not itself novel**. Traditional payment-fraud platforms such as Stripe Radar already support rule backtesting and risk settings.

The novelty hypothesis is narrower:

> **Apply a regression-governed, organisation-specific policy loop to autonomous x402 payments, using live Intercepta intelligence at the actual machine-signing boundary.**

Do not pitch generic regression testing as a new invention.

---

## 6. Verified Policy Library / Incident Regression Suite

### Purpose

Persist organisation-specific, validated decision knowledge.

### Minimum stored objects

#### A. `RiskProfile`

```text
organisation_id
risk_appetite_version
payment limits
review capacity
hard prohibitions
effective_from
approved_by
```

#### B. `PaymentCase`

```text
case_id
timestamp
x402 quote snapshot
payTo
asset
amount
service/task context
Intercepta response snapshot
policy_version
decision
signer_called
settlement/outcome
later incident label
later risk-state evidence
```

#### C. `CandidatePolicy`

```text
candidate_id
originating_case_ids
conditions
action
rationale
generated_by
created_at
```

#### D. `RegressionResult`

```text
candidate_id
dataset_version
bad_cases_affected
good_cases_affected
loss_prevented
false_positive_proxy
human_review_delta
capital_delayed
conflicts
```

#### E. `VerifiedPolicy`

```text
policy_version
rules
source_candidates
approval
regression_summary
effective_from
rollback_target
```

### What the library is not

- Not a public universal fraud reputation database.
- Not a replacement for Intercepta's global threat intelligence.
- Not an autonomous LLM memory that can change payment authority without review.
- Not a claim that a payment classified as safe is guaranteed legitimate.

---

## 7. Incident and feedback triggers

The MVP does not need every possible trigger.

### Trigger A — live pre-sign Intercepta decision

Required for the sponsor track.

A current payment receives a real live result that changes the action.

### Trigger B — later risk-state change on a prior counterparty

Candidate mechanism:

```text
stored previous payment
        |
periodic / explicit re-screen
        |
Intercepta response changed materially
        |
open policy review case
```

Intercepta publicly states that entity risk states are dynamically refreshed as behaviour, provenance and threat data change.

The hackathon API's support for historical states, alerts or webhooks is **not yet established**. If unavailable, the project can store every original response and compare it with a later re-screen.

### Trigger C — explicit organisation incident/dispute label

An authorised human marks a prior payment as a harmful or unacceptable outcome.

This is a valid input to policy regression, but the product must not depend solely on user reporting.

### Trigger D — observable service/payment outcome failure

Examples may include settlement ambiguity, paid-but-no-usable-result, or other measurable failure.

This should only be used where the outcome can be represented truthfully. The project must not pretend that x402 settlement proves service quality.

### MVP choice

Implement **A + one of B/C**.

Do not build four incomplete trigger systems merely to increase feature count.

---

## 8. Decision semantics

A live Intercepta result alone is not necessarily the final action.

The decision engine evaluates:

```text
Intercepta evidence
+
organisation risk profile
+
payment context
+
counterparty/payment history
+
active verified policy version
```

### Example only

| Intercepta evidence | Local context | Organisation policy | Result |
| --- | --- | --- | --- |
| CLEAR | Known counterparty, 0.50 USDC | Within all limits | PAY |
| CLEAR | First-time counterparty, 60 USDC | First payment max = 10 | CAP / ASK HUMAN |
| WARN | 0.20 USDC low-value API | WARN allowed below 1 | PAY or CAP |
| WARN | 500 USDC procurement | WARN above 100 requires review | HOLD / ASK HUMAN |
| BLOCK | Any | Hard zero-tolerance rule | DENY |
| Missing/error | Any | Fail-closed | HOLD |

These rows are product examples, not Intercepta's official score mapping.

---

## 9. Architecture and trust boundary

### Actors/components

1. **Organisation Risk Owner**
   - defines risk appetite,
   - approves/rolls back policy versions,
   - reviews high-risk payment decisions.

2. **Autonomous Buyer Agent**
   - requests a task-related paid service,
   - receives a real x402 quote,
   - cannot directly access the payment key.

3. **x402 Buyer / Quote Parser**
   - parses and selects supported payment requirements,
   - rejects unsupported or mutated requirements.

4. **Intercepta Adapter**
   - calls live Intercepta API before payment signing,
   - passes only documented payloads,
   - preserves response/reason evidence.

5. **Policy Engine**
   - combines live risk evidence with local payment context and active policy,
   - produces deterministic action.

6. **Protected Signer**
   - accepts only policy-approved bounded payment terms,
   - rechecks amount/asset/recipient/network before signing.

7. **Case/Event Store**
   - stores decision snapshots and outcomes for later replay.

8. **Regression Engine**
   - replays candidate policy versions against the current regression suite,
   - computes trade-off metrics,
   - has no authority to sign payments.

9. **Verified Policy Registry**
   - stores versioned, approved policies,
   - supports rollback and audit history.

10. **Optional Policy Analyst Agent**
    - explains cases or proposes candidate changes,
    - may not deploy or sign autonomously.

### Critical boundary

```text
Agent / LLM
    X
    | no direct key
    v
Policy Decision Point
    |
approved bounded intent
    v
Protected Signer
```

Any route that lets the agent or an x402 convenience wrapper sign before the policy decision breaks the product.

---

## 10. Why Intercepta and x402 are load-bearing

### Intercepta

The project needs a trustworthy live external risk input at the payment decision.

Current official hackathon requirements explicitly expect a live Intercepta API call **before** payment is signed or accepted, and the result must decide what happens next.

The product should screen the actual selected subject supported by the API, including `payTo` and, where technically compatible, token/payment authorization checks.

Removing Intercepta must materially weaken the core demo.

### x402

The product is about autonomous machine payments, not a dashboard.

A real x402 flow supplies:

- the paid resource request,
- a real HTTP 402,
- machine-readable payment requirements,
- payment authorization,
- retry/settlement path,
- a concrete pre-sign decision boundary.

The core promise is demonstrated only when policy changes what happens to an actual x402 payment attempt.

---

## 11. Sponsor fit without checklist stuffing

### Required core sponsor fit

- Live Intercepta call in the payment flow.
- Before signing/acceptance.
- Result changes the payment action.
- One successful payment.
- One held/blocked payment with visible reason.
- Real mainnet address risk subject even if payment settles on testnet.
- Public GitHub repository and required API feedback.

### Natural extension of booth guidance

The Intercepta team additionally suggested use cases such as:

- forensics/investigations,
- trustworthy onchain data enrichment,
- credit scoring,
- traditional/institutional finance.

These are **guidance, not mandatory features**.

The frozen product uses the **institutional risk-management idea naturally** through:

- organisation-specific risk appetite,
- versioned policy governance,
- measurable exposure/review trade-offs,
- auditability.

Forensics may be used only if the live API exposes useful evidence needed to explain or reopen a case.

Credit scoring is **not** part of the MVP.

A separate threat-data enrichment product is **not** part of the MVP.

---

## 12. Prior art and defensible positioning

### Intercepta itself

Intercepta already publicly describes:

- continuous risk-state refresh,
- full-archive identity graph,
- cross-chain provenance and behavioural history,
- custom automation thresholds,
- custom logic,
- custom triggers,
- continuous rule evolution,
- actions such as pause, flag, freeze, notify and firewall.

Therefore:

> **"Custom rules on top of Intercepta" is not sufficient differentiation.**

### Traditional payment fraud systems

Stripe Radar already supports:

- custom fraud rules,
- business-specific risk settings,
- historical backtesting,
- balancing fraud prevention against false positives/revenue.

Therefore:

> **"We invented payment-rule backtesting" is not a defensible claim.**

### Agent/x402 security

Adjacent public products already describe risk layers around x402, policy/evidence enforcement and payment screening.

Examples include t54 X402 Secure and other buyer-side x402 risk/firewall tools.

Therefore:

> **"First safe x402 payment layer" is excluded.**

### Defensible differentiation hypothesis today

The strongest currently defensible candidate is:

> **An organisation-specific closed-loop risk-policy system for autonomous x402 agents in which live Intercepta evidence controls the signing decision, while incidents/outcomes are converted into payment-policy regression cases and approved policy versions.**

This remains a hypothesis until two things are verified:

1. Intercepta does not already provide the same historical replay/policy-optimisation workflow for this use case.
2. The implementation demonstrates meaningful behaviour beyond a static rule editor.

---

## 13. Product novelty test

The project only deserves the stronger positioning if the demo proves all four layers:

### Layer 1 — live risk evidence

```text
Intercepta
→ real verdict/reasons
```

### Layer 2 — company-specific context

```text
same risk signal
+
different amount / counterparty state / risk appetite
→ different authorised action
```

### Layer 3 — regression-governed change

```text
incident
→ candidate policy
→ replay historical suite
→ measured trade-offs
```

### Layer 4 — versioned future enforcement

```text
approved policy v2
→ changes a later pre-sign x402 decision
```

If only Layer 1 works, the product is a sponsor integration.

If Layers 1–2 work, it is a configurable payment guard.

If Layers 1–4 work, the closed-loop product thesis is demonstrated.

---

## 14. Hackathon MVP

### MUST demonstrate

1. **Organisation risk profile**
   - one explicit organisation,
   - one agent payment use case,
   - bounded payment limits and at least one contextual policy.

2. **Real x402 payment path**
   - actual 402 payment requirement,
   - supported official x402 buyer/server path,
   - testnet settlement acceptable.

3. **Protected pre-sign boundary**
   - the agent cannot bypass the guard,
   - blocked/held path results in zero signing calls.

4. **Live Intercepta decision**
   - screen the actual selected `payTo`,
   - show live verdict/reasons,
   - one case passes,
   - one case is held/blocked because of live evidence.

5. **Decision trace**
   - show:
     - quote,
     - risk evidence,
     - active policy version,
     - final action,
     - signer call yes/no,
     - settlement/outcome.

6. **One policy-regression case**
   - start from a labelled incident or controlled historical case,
   - propose at least two candidate policy changes,
   - replay them against a small but explicit good/bad case suite,
   - show trade-off metrics.

7. **Policy promotion**
   - approve one candidate,
   - save it as policy version N+1,
   - show that the new policy changes a later payment decision.

8. **Public repository**
   - README points to:
     - Intercepta call,
     - policy decision point,
     - signer gate,
     - regression engine,
   - include 3–5 lines of Intercepta API feedback.

### SHOULD demonstrate

- A later re-screen where a previous counterparty's Intercepta state/reasons differ from the stored earlier snapshot.
- A rollback from policy N+1 to policy N.
- Fail-closed behaviour on Intercepta timeout/error.
- Quote mutation invalidates the previous risk decision.
- Token scan / payment-authorization scan if actual documented payload compatibility is verified.
- Regression metrics including:
  - bad-case prevention,
  - legitimate-payment disruption,
  - manual-review delta,
  - value delayed/denied.

### COULD demonstrate

- An LLM-based policy analyst that explains **why** a candidate changed, without controlling enforcement.
- Multiple organisation profiles producing different decisions from the same live risk evidence.
- Forensic evidence links attached to incident cases if the API exposes them cleanly.

### DO NOT build for the MVP

- Universal fraud detection.
- New onchain threat graph competing with Intercepta.
- Credit bureau / universal agent credit score.
- Public reputation marketplace.
- Broad institutional AML suite.
- Multi-sponsor integrations added only for prize count.
- Escrow/refund protocol.
- Autonomous policy self-modification without approval.
- Large ML model trained from fake hackathon data.
- MCP/skills layer unless a concrete build dependency emerges.
- Generic postmortem dashboard with no future payment effect.

---

## 15. Regression dataset strategy

A hackathon project will not have thousands of organic production x402 payments.

Therefore the regression layer must be honest about its evidence.

### Dataset may contain

1. **Real live demo payments**
   - stored exactly as observed.

2. **Sponsor-provided known-risk mainnet addresses**
   - used as controlled adversarial cases,
   - explicitly labelled as fixtures.

3. **Controlled payment-context variants**
   - different amounts,
   - first-time versus known counterparty,
   - different organisation policies.

4. **Synthetic/constructed historical cases**
   - permitted for demonstrating the replay engine,
   - must be clearly labelled synthetic,
   - cannot be presented as real market validation.

### The replay engine must not fake Intercepta

If a historical case requires an Intercepta response:

- use a stored real response,
- or make a live call where appropriate,
- or clearly mark the field as fixture data for regression-engine demonstration.

Mocked risk responses **cannot** replace the live sponsor qualification path.

---

## 16. Regression metrics

The MVP should calculate a small, auditable set.

### Security

- `bad_cases_prevented`
- `bad_value_prevented`
- `bad_value_remaining`

### Friction

- `good_cases_changed`
- `good_value_delayed_or_denied`
- `human_reviews_added`

### Autonomy

- `auto_approval_rate`
- `hold_rate`
- `deny_rate`

### Comparison

```text
Policy v1
vs
Candidate v2
vs
Candidate v3
```

No opaque "AI safety score" is required.

The value is in transparent trade-offs.

---

## 17. Example regression scenario

### Current policy v1

```text
IF Intercepta = BLOCK
  → DENY

IF Intercepta = WARN
  AND amount <= 100 USDC
  → PAY

IF Intercepta = CLEAR
  → PAY
```

### Incident

```text
first-time counterparty
amount = 80 USDC
Intercepta at payment time = WARN
old policy → PAY
later outcome = organisation-labelled incident
```

### Candidate A

```text
WARN
→ DENY
```

Replay result:

```text
bad cases prevented: high
legitimate payments affected: very high
```

Reject.

### Candidate B

```text
WARN
AND first-time counterparty
AND amount > 20 USDC
→ CAP at 5 USDC
```

Replay result:

```text
bad value materially reduced
legitimate payment disruption limited
manual review load acceptable
```

Candidate may be approved.

### Policy v2

Candidate B becomes active only after approval.

The next matching x402 attempt is evaluated using v2 **plus a new live Intercepta call**.

---

## 18. Demo script

### Scene 1 — establish the company

Show:

```text
ExampleCo Risk Profile
- max single payment: 100 USDC
- first-time counterparty limit: 10 USDC
- BLOCK: deny
- WARN above 20: review/cap
```

Do not spend demo time on a large settings dashboard.

### Scene 2 — successful autonomous x402 payment

Agent requests a paid resource.

```text
HTTP 402
→ quote parsed
→ local checks pass
→ live Intercepta scan
→ policy v1 = PAY
→ protected signer called once
→ payment settles
→ result shown
```

### Scene 3 — sponsor qualification hold/block

A separate permitted quote reaches the guard.

```text
local checks pass
→ live Intercepta known-risk result
→ policy = DENY/HOLD
→ signer call count = 0
→ visible reason
```

This is the mandatory Intercepta judging moment.

### Scene 4 — show why this is more than a firewall

Open a prior incident case.

```text
Policy v1 made an unacceptable decision.
```

Click:

```text
RUN POLICY REGRESSION
```

Compare candidate A and B.

Display:

```text
loss/bad-case reduction
false-positive proxy
manual-review change
legitimate value delayed
```

Approve the stronger balanced candidate.

### Scene 5 — policy evolution

```text
Policy v1 → Policy v2
```

A new x402 payment arrives.

Same organisation, same protected signer, live Intercepta call.

Policy v2 produces a different `CAP / HOLD / ASK_HUMAN` decision.

### Final line

> **Intercepta tells the agent what is risky. Risksir makes sure the organisation's payment policy learns from what happened.**

---

## 19. Security and functional invariants

| Invariant | Minimum verification |
| --- | --- |
| Live Intercepta before signing | Every real demo payment invokes the supported Intercepta screen before signer authorization. |
| No bypass | Agent and convenience wrapper have no direct payer-key route. |
| Held/denied means zero signing | Log/assert signer call count = 0. |
| Quote integrity | Recipient, network, asset, amount or expiry mutation invalidates prior approval. |
| Policy version is explicit | Every decision stores the exact policy version. |
| Regression cannot move money | Replay engine has no signer capability. |
| Candidate policy cannot silently deploy | Explicit approval/promotion step required. |
| Fail closed on missing live evidence | Intercepta timeout/error/unknown → hold, not pay. |
| Historical evidence is honest | Real, sponsor fixture and synthetic cases are labelled distinctly. |
| No false assurance | CLEAR means no known disqualifying signal under the observed evidence; it is not proof of merchant honesty or delivery. |
| Settlement and delivery separated | Payment success is reported separately from service-quality outcome. |
| Rollback exists | A bad policy version can be deactivated and prior version restored. |

---

## 20. Open technical questions that must not be guessed

### Intercepta API

1. What exact fields/verdicts/reasons are returned by the hackathon endpoints?
2. Can the API expose underlying entity/cluster/provenance evidence or only current risk?
3. Can the API tell when/why a risk state changed?
4. Is historical risk state queryable?
5. Are there alerts/webhooks for risk-state changes?
6. If not, is periodic re-screening acceptable within the sandbox limits?
7. Which endpoint should be used for:
   - `payTo`,
   - canonical token validation,
   - payment authorization/message?

### Intercepta product overlap

Ask directly:

> **Do Intercepta Automation Rules currently support historical replay/backtesting of customer-defined payment policies against prior transactions/outcomes, policy version comparison, or optimisation against a customer-specific risk appetite?**

This answer is a **novelty gate**.

### x402

1. Exact buyer SDK/version.
2. Exact supported scheme/network/token.
3. Where signing occurs in the client flow.
4. Whether the signer can be replaced/wrapped safely before signature.
5. Exact settlement evidence available after retry.
6. Quote mutation/replay semantics.

---

## 21. Evidence ledger at freeze

| Item | State at this decision |
| --- | --- |
| Intercepta requires a live pre-sign/pre-accept API call that changes the payment action | **Confirmed** from current ETHGlobal Tokyo 2026 prize page. |
| Working x402 flow may use testnet | **Confirmed**. |
| One successful and one blocked/held demo path required | **Confirmed**. |
| Mainnet addresses must be screened even if payment runs on testnet | **Confirmed**. |
| Intercepta Risk Screener dynamically refreshes entity risk state | **Confirmed** from current Intercepta product page. |
| Intercepta has custom thresholds, logic and triggers | **Confirmed** from Automation Rules. |
| Intercepta continuously evolves rules from global threat intelligence | **Confirmed** from Automation Rules. |
| Intercepta Flow Tracer supports investigation/case evidence | **Confirmed** from current product page. |
| Intercepta supports organisation-specific historical payment-policy backtesting | **Not established from public material inspected. Must ask.** |
| Intercepta supports customer risk-appetite optimisation | **Not established. Must ask.** |
| Intercepta hackathon API exposes historical risk-state change events/webhooks | **Not established. Must verify.** |
| Generic payment-rule backtesting already exists in traditional finance/payment fraud | **Confirmed**; Stripe Radar is clear prior art. |
| Closed-loop policy regression is novel specifically for x402/agent payments | **Unproven differentiation hypothesis.** |
| Real customer demand for this workflow | **Unverified.** |
| Real historical x402 corpus available to the team | **Not established. MVP must use transparent controlled/synthetic cases where necessary.** |
| Safe protected signer integration with selected x402 SDK | **Must be spiked immediately.** |

---

## 22. Kill conditions / reopen conditions

### KILL / materially pivot if

1. A live Intercepta result cannot be placed before the actual x402 signer.
2. The selected x402 flow can bypass the guard.
3. The team cannot produce one real passed payment and one real live-risk hold/block.
4. Regression results are entirely hard-coded and do not replay policy against actual case records.
5. Intercepta confirms it already provides substantially the same:
   - customer-specific historical replay,
   - policy version comparison,
   - risk-appetite optimisation,
   - agent-payment enforcement loop.

### REOPEN differentiation if

- the product becomes only a settings dashboard,
- the policy library becomes only a blacklist,
- the regression engine never affects a later real payment decision,
- an LLM directly changes enforcement without deterministic validation,
- the team adds unrelated sponsor features to create artificial complexity.

---

## 23. Immediate Step 8/9 technical spikes

### Spike A — live Intercepta semantics

Goal:

```text
real address
→ real API call
→ inspect exact schema/reasons
→ documented action mapping
```

Pass criteria:

- at least one known-safe/acceptable subject,
- at least one sponsor-known-risk subject,
- reasons visible,
- response can be stored and replayed.

### Spike B — protected x402 signing path

Goal:

```text
real 402
→ parse quote
→ risk decision
→ signer only after approval
```

Pass criteria:

- allowed branch settles,
- denied branch signs zero times,
- quote mutation invalidates approval.

### Spike C — minimum regression engine

Build a simple case schema and evaluator.

Input:

```text
PaymentCase[]
Policy v1
CandidatePolicy[]
```

Output:

```text
decision per case
bad-case prevention
good-case disruption
review load
value affected
```

No AI required.

### Spike D — policy version lifecycle

Implement:

```text
draft
→ regression-tested
→ approved
→ active
→ superseded / rolled back
```

### Spike E — sponsor overlap verification

Ask Intercepta directly about:

- historical rule replay,
- customer-specific backtesting,
- risk-appetite optimisation,
- risk-state history/webhooks.

Record the answer verbatim in project notes.

---

## 24. Build order after spikes pass

### Phase 1 — payment correctness

1. Real x402 buyer/server.
2. Protected signer.
3. Live Intercepta address screen.
4. Pass and block demo.

### Phase 2 — company policy

5. Risk profile schema.
6. Deterministic policy engine.
7. Decision/audit trace.

### Phase 3 — regression loop

8. Case store.
9. Incident label/reopen flow.
10. Candidate policy representation.
11. Historical replay.
12. Metrics comparison.
13. Human approval.
14. Policy version activation.

### Phase 4 — demo polish

15. One clear organisation story.
16. One pass.
17. One sponsor-risk block.
18. One incident regression.
19. One promoted policy changing a later decision.
20. README qualification checklist.

---

## 25. README positioning

### One-sentence summary

> **Risksir is a closed-loop risk-policy engine for x402 agents: Intercepta supplies live payment risk, while each organisation can test, version and improve how its agents respond to that risk before money is signed.**

### Problem

Autonomous agents need more than a universal risk verdict.

The same risk signal can legitimately produce different actions depending on:

- payment value,
- counterparty familiarity,
- business context,
- organisation risk appetite,
- operational capacity for human review.

Static policies also need a disciplined way to improve after incidents without overcorrecting and blocking normal commerce.

### Solution

```text
Live Intercepta risk
+
organisation risk profile
+
active verified policy
→ payment decision

incident/outcome
→ candidate policy
→ regression replay
→ measured trade-offs
→ approved policy version
→ future decision
```

---

## 26. Pitch positioning

### 15-second version

> **Intercepta tells an agent what is risky. Risksir decides what that risk means for this company, then regression-tests every policy change before it can affect future x402 payments.**

### 30-second version

> Autonomous agents are starting to spend real money, but a global risk score is not the same as a company's risk appetite. A 20-cent API call and a $5,000 treasury payment should not respond identically to the same warning. Risksir puts live Intercepta intelligence at the x402 signing boundary, combines it with organisation-specific policy, and turns incidents into regression tests. Policy changes are replayed against historical good and bad cases before they are approved and used on the next payment.

### Core line

> **Every incident becomes a regression test. Every validated lesson becomes payment policy.**

### What not to say

Do not say:

- "Intercepta only has generic rules."
- "Intercepta cannot learn new threats."
- "We built the first threat knowledge base."
- "We invented fraud-rule backtesting."
- "Our AI knows better than Intercepta."
- "CLEAR means safe."
- "Our policy automatically becomes production because the AI proposed it."

---

## 27. Demo acceptance checklist

Before freezing implementation as submission-ready:

- [ ] Real x402 `402 Payment Required`.
- [ ] Exact selected quote displayed.
- [ ] Live Intercepta call occurs before signer.
- [ ] One successful payment.
- [ ] One Intercepta-driven hold/block.
- [ ] Zero signer calls on blocked path.
- [ ] Company risk profile is explicit.
- [ ] Active policy version displayed.
- [ ] At least one incident/regression case exists.
- [ ] At least two candidate policies replayed.
- [ ] Metrics are calculated from case data, not hard-coded UI text.
- [ ] One candidate approved as a new policy version.
- [ ] New policy changes a later payment decision.
- [ ] Rollback is possible.
- [ ] Synthetic/controlled cases clearly labelled.
- [ ] Public repo contains setup/testing instructions.
- [ ] README points to Intercepta integration files.
- [ ] README contains required 3–5 lines of Intercepta API feedback.

---

## 28. Freeze integrity

The next architecture/implementation document may define:

- exact schemas,
- exact Intercepta endpoints,
- exact x402 SDK,
- policy DSL,
- regression algorithm,
- storage,
- signer interface,
- UI flow,
- tests.

It must **not** silently add:

- MCP/skills,
- credit scoring,
- public reputation,
- multi-sponsor dependencies,
- a new threat-detection model,
- escrow,
- universal institutional compliance,
- unsupervised policy self-modification.

Those require an explicit reopen of this freeze.

### Final frozen product statement

> **Risksir is an organisation-specific, closed-loop payment risk-control system for autonomous x402 agents. Every real payment is screened live with Intercepta before signing and evaluated under the organisation's active payment policy. When incidents or later evidence show that policy was wrong, the system converts those cases into regression tests, compares candidate policy changes against historical good and bad payments, and promotes only approved, measured changes into a versioned policy library. Intercepta remains the source of live onchain risk intelligence; Risksir governs how a particular organisation learns to act on that intelligence.**

---

## 29. Sources checked on 26 September 2026

### Official sponsor/event

- ETHGlobal Tokyo 2026 — Intercepta prize and qualification requirements:  
  https://ethglobal.com/events/tokyo2026/prizes

### Intercepta

- Risk Screener — dynamic risk-state refresh, identity graph, provenance, behaviour and entity risk:  
  https://intercepta.io/products/risk-screener

- Automation Rules — custom thresholds, custom logic, custom triggers, continuous rule evolution and automated actions:  
  https://intercepta.io/products/automation-rules

- Flow Tracer — investigations, graph expansion, evidence and saved/shared cases:  
  https://intercepta.io/products/flow-tracer

- Intercepta platform overview:  
  https://intercepta.io/

### x402

- Buyer quickstart linked by ETHGlobal/Intercepta:  
  https://docs.x402.org/getting-started/quickstart-for-buyers

- Seller quickstart linked by ETHGlobal/Intercepta:  
  https://docs.x402.org/getting-started/quickstart-for-sellers

### Relevant prior art / comparison

- Stripe Radar Rules — custom payment-fraud rules and historical backtesting:  
  https://stripe.com/gb/guides/radar-rules-101

- Stripe — continuous fraud-management / modelling / backtesting workflow:  
  https://stripe.com/guides/improve-fraud-management-with-radar-and-stripe-data

- t54 X402 Secure — adjacent x402 risk/evidence layer:  
  https://docs.t54.ai/docs/products/x402-secure

---

## 30. Final decision

**PROCEED TO TECHNICAL SPIKE, NOT FULL BUILD BLINDLY.**

The product logic is mature enough to freeze for implementation testing.

The project is promising because it moves beyond a one-shot x402 risk check and beyond a generic rule editor into a closed-loop governance model:

```text
INTERCEPTA
live risk intelligence
        ↓
COMPANY RISK POLICY
        ↓
x402 decision
        ↓
OUTCOME / INCIDENT
        ↓
REGRESSION TEST
        ↓
VERIFIED POLICY VERSION
        ↓
next x402 decision
```

However, the strongest differentiation depends on one unresolved sponsor-overlap question:

> **Does Intercepta already provide customer-specific historical replay/backtesting and risk-appetite-driven policy optimisation?**

Until that is answered, novelty remains a hypothesis.

If the answer is **no**, proceed with the closed-loop regression product.

If the answer is **yes**, reopen Step 6/7 immediately rather than disguising product overlap with more features.
