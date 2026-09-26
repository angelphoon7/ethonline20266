# Risksir

A closed-loop risk-policy engine for autonomous x402 buyer agents. Live Intercepta evidence decides whether an agent's x402 payment is signed. Incidents become regression cases, and only replay-tested, owner-approved policy versions govern future payments.

Target: ETHGlobal Tokyo 2026, Intercepta prize *Safe Agent-to-Agent Payments with x402*.

**Live site:** https://REPLACE-WITH-VERCEL-URL.vercel.app (static showcase of recorded evidence from Base Sepolia test runs; it never signs, pays or calls Intercepta).

> **Status: under construction.** Nothing here is live-verified yet. See [`HANDOFF.md`](HANDOFF.md) for the current state and [`EXECUTION_PLAN.md`](EXECUTION_PLAN.md) for milestones. This README is completed in M-012 (Intercepta file map, claim boundaries, API feedback).

## Setup

Requirements: Node >= 20 and pnpm 12 (via corepack).

```bash
corepack pnpm install
cp .env.example .env        # fill in values; never commit .env
git config core.hooksPath .githooks
```

## Test

```bash
corepack pnpm verify        # offline: typecheck + lint + tests
LIVE=1 corepack pnpm test:live   # live checks; spends Intercepta calls and testnet funds within OPERATIONAL_GUARDRAILS.md
```

## Documents

| File | Purpose |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Binding engineering contract (acceptance criteria and invariants) |
| [`DECISIONS.md`](DECISIONS.md) | Architecture decision records |
| [`TEST_PLAN.md`](TEST_PLAN.md) | How each AC and INV is proven |
| [`OPERATIONAL_GUARDRAILS.md`](OPERATIONAL_GUARDRAILS.md) | Hard limits (networks, spend, secrets) |
| [`AGENTS.md`](AGENTS.md) | Technical operating guide |
