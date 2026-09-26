# DEMO_AND_SUBMISSION — M-011 / M-012 instructions

Use these instructions when running milestone M-011 (demo hardening) or M-012 (submission). No marketing copy. Every claim must match the implementation and the recorded evidence.

---

## A. `DEMO_RUNBOOK.md` (M-011)

1. **Demo objective.** The single promise the audience must understand: *Intercepta tells the agent what is risky. Risksir makes sure the organisation's payment policy learns from what happened.*
2. **Prerequisites.** Env var names (never values), payer balance, the running processes, seeded state and network.
3. **Clean start.** Exact commands, for example `pnpm demo:reset` and `pnpm demo:seed`, that bring the system to a known state.
4. **Preflight.** Run `pnpm demo:smoke`. It checks the seller's 402, Intercepta reachability, the facilitator, the payer balance, the active policy version and the seeded cases.
5. **Canonical demo, Scenes 1–5 from 07 §18.** For each step, write down:
   - what the presenter does
   - what the audience sees
   - what happens technically
   - which evidence proves the claim: a tx hash, `signerCalls=0`, a raw Intercepta response, the policy version

   Target timing for the 4-minute live version. Screens: the owner console plus one Basescan tab. No slides after the opening.

   | Time | Segment | Evidence on screen |
   | --- | --- | --- |
   | 15s | Opening problem line: "A $0.20 API call and a $5,000 payment should not react identically to the same risk warning." | — |
   | 15s | Scene 1: the ExampleCo risk profile | policy v1 in the header |
   | 45s | Scene 2: agent → 402 → live Intercepta → PAY → sign → settle | Intercepta timestamp before signer; `signer calls: 1`; Basescan tx |
   | 45s | Scene 3 (**prize moment**): risky `payTo` → live Intercepta reasons → DENY or HOLD | visible risk reasons; **`signer calls: 0`** |
   | 60s | Scene 4: label incident → RUN POLICY REGRESSION → candidate A vs B → approve B | metrics with denominators and provenance mix; v2 created |
   | 30s | Scene 5: new payment, fresh live screen → v2 decision differs from v1 | v1 → v2 in the header; changed action |
   | 10s | Closing line (07 §18) | — |
6. **Sponsor evidence.** Make the live Intercepta call visible to judges. Show the request time, the screened address and the returned fields, and make clear it happens **before** the signer.
7. **Failure demo (one only).** Simulate an Intercepta timeout: the result is HOLD and the signer count is 0.
8. **Recovery.** What to do for each common failure: faucet or balance, facilitator down, Intercepta 429, the console won't load.
9. **Reset.** How to restore the known state between runs.
10. **Degraded backup.** What can still be shown if the API or testnet is down. Label every recorded or mocked part as such. Add a HUMAN step: **before judging, screen-record one full live run of Scenes 1–5** to use as the backup video, and label it "recorded" if you play it.
11. **Timed scripts.** A 2-minute version and a 4-minute version. Check the current ETHGlobal rules for the exact video length.
12. **Presentation rules.**
    - Demo the running product, not the development framework (CLAUDE.md, prompts, agent loop).
    - Don't open code unless a judge asks. When they do, open the GitHub file links from the README.
    - Mention the agent-built workflow at most once, and only if asked how the project was built.
13. **Judge Q&A prep.** Give short, truthful answers backed by the repo's evidence:
    - *"Doesn't Intercepta already have Automation Rules?"* Intercepta decides what is risky. Risksir governs how this organisation acts on that risk, and turns incidents into regression tests that must pass replay and owner approval before a policy changes. Cite the verbatim answer in `docs/spikes/SPIKE_E_OVERLAP.md` if it exists. If it doesn't, don't claim a confirmed gap.
    - *"The risky address is on mainnet but you pay on testnet?"* The mainnet address is screened and the settlement happens on Base Sepolia. These are separate observations, as the sponsor rules allow (08 §1, "Critical distinction").
    - *"What if Intercepta is down?"* The system fails closed: HOLD, zero signer calls. Show the failure demo.
14. **Final pre-demo checklist.**

## B. `README.md` (M-012)

- A one-sentence summary (07 §25).
- The problem, then the solution flow diagram.
- **Where the sponsor integration lives.** Give file paths with line anchors for:
  - the Intercepta API call
  - the policy decision point
  - the signer gate
  - the regression engine
- Setup: install, env names, funding, run commands, tests (`pnpm verify`, `pnpm test:live`).
- The trust model and claim boundaries (08 §12). Say plainly what CLEAR does **not** mean.
- Known limitations, and how the regression dataset's provenance is labelled.
- **Intercepta API feedback: 3–5 lines**, based only on the actual experience recorded in `docs/spikes/`. Mark it `DRAFT — human to review before submission`.
- At the very end, add one line: "Built with an autonomous Claude Code workflow (`CLAUDE.md`, `prompts/`)." Nothing more about the framework.

## C. `FINAL_VALIDATION.md` (M-012)

- Take the 07 §27 checklist line by line. Mark each line PASS or FAIL, with evidence: a command, a file path or a tx hash.
- Take the prize-anchor points 1–6 the same way, PASS or FAIL with evidence.
- Take every AC from `SPEC.md` the same way.
- If anything fails, set `AGENT_STATUS: HUMAN_REQUIRED` and list what is missing. Never mark something PASS without evidence.
