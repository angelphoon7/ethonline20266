# ETHGlobal Tokyo 2026 — Hackathon Master Context

> **Purpose:** Operating constitution for every researcher, strategist, architect, developer, QA agent, and mock judge working on this project. Read this file before producing downstream work.
>
> **Status:** This document defines decision standards. It does **not** validate a market problem, identify an idea, endorse a sponsor, or state the official rules for ETHGlobal Tokyo 2026. Sponsor names, tracks, prizes, deadlines, eligibility, technical capabilities, and judging criteria remain **unverified** until sourced in later research.

## 1. Objective and success condition

Build an ETHGlobal Tokyo 2026 project with a realistic chance of performing strongly in overall judging and relevant sponsor tracks. Aim for a specific, evidenced user problem; a timely reason to solve it; an understandable product promise; a technically credible and interesting mechanism; a working end-to-end prototype; a visible live demo; and sponsor integrations that make the product materially better.

A strong concept should be expressible in about 30–60 seconds: **who has the problem, what fails today, what the user does, which mechanism changes the outcome, and what the user gets.** The judge should be able to identify a memorable technical insight and see that insight operate in the demo. Novelty alone does not establish product value.

Use this order of work: **validate the problem → compare solution concepts → test technical feasibility → freeze the architecture → build and verify a narrow end-to-end product → prepare the submission.** Each transition is controlled by the gates in §10. The human makes the final decision at every consequential choice.

## 2. Project philosophy

### Begin with a concrete user problem

Identify a user or developer, a repeatable situation, an action they are trying to take, the failure or friction, and the consequence. Describe current workarounds and why they fall short. Do not start by selecting a sponsor or a fashionable category and inventing a pain point around it.

Require a credible answer to **“Why now?”** Possible forms include a newly available primitive, changed user behavior, an emerging workflow, or a documented limitation becoming more consequential. A claim of urgency needs evidence; it cannot rest on trend language.

### Make every major component earn its place

For each blockchain, contract, token, agent, model, indexer, verifier, oracle, API, and sponsor protocol, state what it makes possible. Ask whether the same user outcome could be delivered as well with a simpler Web2 system or without that component. Use the smallest architecture that still supports the actual product promise. Do not confuse technical complexity with judge appeal.

An existing category can be a good fit when the problem or mechanism is materially different. Likewise, a new mechanism is valuable only if it improves a real outcome.

### Build for an observable result

The intended core flow is **user action → protocol or system behavior → verifiable state change → visible user outcome**. Make the transition understandable without requiring judges to infer it from code, dashboards, or a lengthy explanation.

## 3. Research methodology and evidence rules

Later research must date its findings, link direct sources, and separate **observed fact**, **interpretation**, and **unverified hypothesis**. Verify changeable facts against current sources. Do not treat this document or earlier AI output as evidence that a problem exists.

Prioritize official documentation and code, GitHub issues and pull requests, protocol and governance forums, developer discussions, changelogs, security reports, incident reports, technical posts, ETHGlobal project pages and submissions, and direct user or developer accounts. X and Reddit can reveal problems or workarounds, but the author, context, date, and representativeness matter. A single social post is a lead, not market validation.

For each proposed problem, collect:

1. **Affected user and workflow:** who encounters it, in which action, and how often or under what conditions.
2. **Evidence trail:** dated, linked examples; independent corroboration where possible; any contradictory evidence.
3. **Current workaround:** what people do today and its measurable or plausible cost, risk, delay, trust burden, or access barrier.
4. **Classification:** recurring user problem, developer inconvenience, infrastructure limitation, UX issue, transient bug, intentional design tradeoff, already-solved issue, or speculation.
5. **Why now:** a sourced change or condition that makes action timely.
6. **Unknowns:** claims needing an interview, experiment, code inspection, or sponsor clarification.

Search specifically for existing products, prior ETHGlobal submissions, maintained repositories, and protocol features that may already solve the problem. Compare mechanisms and user outcomes, not just names. Record negative findings and counterevidence. If evidence is thin, say so and narrow the claim instead of inflating it.

Evidence is strongest when independent sources converge on a specific workflow and costly workaround. Popularity, likes, sponsor marketing, and a technically interesting limitation are insufficient on their own.

## 4. Sponsor landscape and integration standard

**Current landscape status: unverified.** No ETHGlobal Tokyo 2026 sponsor roster, track, prize, eligibility rule, SDK capability, testnet behavior, or submission requirement is asserted here. A later research stage must build a dated sponsor and track register from official event pages, track descriptions, sponsor documentation, and working examples. Capture source links, exact requirements, permitted networks, access and approval dependencies, relevant limitations, judging language, and the last verification date. Recheck before architecture freeze and submission.

Consider sponsor *roles* only after a user outcome has been defined. These are capability categories, **not a claim that any such sponsor is present**:

| Possible role | Question for a candidate integration |
| --- | --- |
| Execution or settlement | Does it make a necessary transaction or coordinated outcome possible? |
| Identity or verification | Does it enforce a user promise that would otherwise fail? |
| Indexing or discovery | Does it find or prove relevant state at the needed time and scale? |
| Coordination or interoperability | Does it connect parties, states, or networks the workflow needs? |
| Privacy or security | Does it protect required information or trust assumptions? |
| Liquidity or pricing | Does it provide a real economic capability the user needs? |
| Compute, data, or automation | Does it perform a necessary decision or action reliably? |

For every proposed sponsor, write an **integration contract**: (a) exact product step; (b) concrete protocol feature and verified documentation; (c) data or asset entering and leaving; (d) transaction, API call, or proof to show; (e) access, chain, fee, latency, and failure assumptions; and (f) the user-visible effect if that sponsor is removed. The most useful test is: **Would removing it make an important part of the core user promise impossible or materially weaker?** If it merely removes a logo, decorative data, an unrelated payment, or a convenience, reconsider the integration.

Several protocols may combine well when each contributes a distinct required primitive. More sponsors do not automatically improve the project. Select tracks for which the actual build satisfies the official requirements; never claim eligibility from an SDK import or a slide. Distinguish a feature genuinely used by the core flow from an optional demo embellishment.

## 5. Idea evaluation framework

Do not start with a summed numerical score. Write an evidence-based comparison, call out decisive weaknesses, and label uncertainty. Apply the same questions to every candidate:

| Dimension | Questions to answer | Evidence of strength |
| --- | --- | --- |
| User pain | Who experiences it, how often, and what happens if nothing changes? | Specific workflow, consequence, repeated credible signals. |
| Existing workaround | What do users do today, and what does it cost? | Manual, fragmented, unsafe, slow, trust-heavy, inaccessible, or capital-inefficient process demonstrated with evidence. |
| Web3 necessity | What does decentralized state, ownership, verification, composability, or settlement uniquely enable? | A user outcome materially weakened by a conventional implementation. |
| Technical insight | Is the mechanism non-obvious and causally linked to the result? | A precise explanation of how the primitives unlock the outcome. |
| Sponsor fit | What does each sponsor do in the critical path? | Verified features and a compelling removal test. |
| Buildability | Can the riskiest path be proven and an integrated MVP finished in the available time? | A bounded scope, available access, and a feasible implementation path. |
| Demo quality | Can a judge see the state change and understand the result? | A repeatable, legible live flow with a truthful fallback. |
| Novelty | What already exists, and what is substantively different? | Comparison of the actual mechanism and user benefit. |
| Judge comprehension | Can a first-time listener repeat the problem and result after 30–60 seconds? | One concrete example and little prerequisite explanation. |
| Expansion potential | Could the prototype grow into a believable product? | A credible next user segment or workflow without assuming instant network scale. |

An attractive sponsor combination cannot compensate for absent user pain. A novel mechanism cannot compensate for an unavailable API. When candidates trade off on these dimensions, explain the tradeoff and recommend the **next experiment**, not a premature winner.

## 6. Buildability and technical boundaries

Scope the MVP to one complete, judgeable user journey and its essential failure cases. Use known primitives and a thin end-to-end path before adding secondary features. Confirm the actual hackathon duration and official build rules later; do not invent time or eligibility constraints.

Prefer ideas that work with a small seeded test set or clearly labeled simulation. Avoid depending on substantial external liquidity, a large live user network, unavailable privileged APIs, production ZK infrastructure built from scratch, complex offchain services with no stabilization time, or favorable behavior from unaudited third parties. A seeded demo can establish mechanism feasibility; it cannot prove market adoption or real liquidity.

Before committing to an architecture, verify the hardest assumptions through documentation or a minimal executable spike: network and contract compatibility; access and rate limits; signatures and permissions; assets, fees, and settlement behavior; latency; indexing freshness; interoperability; and what happens when a service fails. Record what runs onchain, offchain, and in the client, plus who is trusted to do what.

Match safeguards to the flow: for assets and permissions, consider authorization, replay protection, atomicity or partial failure, accounting, and recovery. Do not introduce elaborate security infrastructure without a risk it actually addresses. Label mocks, hardcoded data, and centralized demo services honestly; do not present a local simulation as a live protocol integration.

## 7. Demo and submission requirements

Design the demo alongside the product. It should show the initial state, user action, sponsor-relevant mechanism, resulting state, and user benefit in the allotted presentation time. Make the cause of the result visible through a suitable UI, transaction, proof, event, or state inspection. Prioritize a deterministic happy path plus one meaningful constraint or failure case if it clarifies the mechanism.

Prepare test accounts, balances, fixtures, network configuration, links, and a repeatable reset procedure. Rehearse the full live path. Have a truthful recorded or local fallback for network failure and label any mocked steps. A polished animation can help comprehension but cannot substitute for a working core flow.

The final submission should explain the specific problem and evidence, how the mechanism works, which sponsor capabilities are actually used, how to run or verify the demo, technical decisions and trust assumptions, and known limitations. Verify the current official ETHGlobal and sponsor requirements before writing eligibility claims or submitting.

## 8. Anti-patterns and rejection signals

Actively challenge:

- “AI + blockchain” with no separate necessity for each component.
- Generic agent marketplaces, prediction markets, wallets, DeFi dashboards, yield optimizers, or tokenized assets without a distinctive problem and mechanism.
- Sponsor logos assembled into a product with no causal integration.
- Unrelated token payments or data displays added for track eligibility.
- A blockchain design whose user promise works equally well with an ordinary database.
- A technically elaborate system whose benefit cannot be seen or explained in the demo.
- A project dependent on speculative network effects, unavailable access, or unrealistic liquidity.
- A copied winner with superficial branding or protocol substitutions.
- A solution built around a one-off bug or a single complaint presented as a broad market.
- An architecture expanded faster than the riskiest assumption can be tested.

These are prompts to investigate, not automatic bans on whole categories. A familiar category can succeed if its user pain, mechanism, and demonstrated result are genuinely strong.

## 9. Human–AI operating model

The human selects the problem, chooses the final idea and tradeoffs, and approves major changes of scope. AI serves as researcher, analyst, product strategist, Web3 engineer, adversarial reviewer, architect, developer, QA engineer, and mock judge. AI should produce concrete artifacts and tests, challenge its own recommendations, and make uncertainties visible.

Every later agent should:

1. Read this document and identify the current decision gate before work begins.
2. Cite and date changeable external claims; separate verified facts from hypotheses and assumptions.
3. Give the strongest counterargument to any significant proposal, including existing alternatives and simpler implementations.
4. Specify what would falsify its recommendation and what small test resolves the biggest unknown.
5. Preserve decision history: what was accepted, rejected, changed, and why. Revisit a gate if new evidence undermines it.
6. Keep outputs usable by the next agent: clear inputs, decisions, open questions, owners where applicable, and the proposed next action.

An AI-generated prompt is a tool for directing work, not a substitute for source inspection, experiments, or human judgment. Rephrasing an AI claim through another AI does not count as independent validation.

## 10. Decision gates

At each gate, record **evidence, open risks, decision, and next test**. Outcomes are **proceed**, **iterate**, or **stop**; “proceed” does not imply certainty. The human makes the final call. Do not quietly carry an unresolved critical assumption into a later stage.

| Gate | Required evidence or artifact | Proceed when | Iterate or stop when |
| --- | --- | --- | --- |
| **1. Problem validation** | Defined user, workflow, consequence, dated evidence trail, current workaround, classification, why-now hypothesis, and counterevidence. | A specific recurring or materially important problem is supported beyond one anecdote, and the workaround has a credible cost. | The pain is speculative, one-off, already handled adequately, or disconnected from a reachable user. Gather better evidence or reframe. |
| **2. Idea validation** | Several distinct solution approaches compared against §5; existing-product and previous-submission search; plain-language promise; preliminary sponsor removal tests; demo storyboard. | One concept has a credible user outcome, substantive difference, comprehensible insight, and a plausible route to a visible demo. | Novelty is cosmetic, Web3 or sponsor roles are ornamental, or judges cannot understand the result. Revise or reject. |
| **3. Technical feasibility** | Current official capability and track checks; dependency list; minimal spike for highest-risk protocol path; contract, offchain, and UI boundary sketch; failure and access assumptions. | The critical path works or has a concrete, low-risk implementation plan with required access and networks available. | A required primitive is unavailable, the core relies on unproven integration, or hidden trust and costs break the promise. Narrow or change the design. |
| **4. Architecture freeze** | Chosen user journey, component and data-flow diagram, sponsor integration contracts, trust and asset flows, test plan, scope exclusions, and demo storyboard. | Every component has a reason, the critical path is technically credible, and the smallest complete product is specified. | A key dependency is still unknown or architecture is expanding without improving the core outcome. Resolve and re-review. |
| **5. Feature freeze** | Integrated end-to-end MVP, working critical transactions or proofs, repeatable fixtures, essential correctness checks, and a demo run-through. | The core outcome works reliably enough to rehearse; remaining effort can focus on defects, clarity, and submission. | The end-to-end flow is broken. Remove optional work and repair the core. After this gate, allow only fixes needed for correctness, demo reliability, or submission compliance. |
| **6. Submission readiness** | Rehearsed live demo and labeled fallback; usable repo and setup steps; required links and media; sourced sponsor claims; known limitations; checked official deadlines and rules. | A judge can understand, run or inspect, and verify the genuine product outcome and relevant integrations within the actual judging process. | The demo depends on hidden manual steps, claims exceed implementation, or required submission items or eligibility checks are missing. Fix before submitting. |

**Revision rule:** When new evidence invalidates an earlier decision, return to the relevant gate. The purpose of these gates is to prevent avoidable commitments, not to prevent sensible iteration.
