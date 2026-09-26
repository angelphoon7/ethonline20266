# Target Prize Anchor — Intercepta: Safe Agent-to-Agent Payments with x402

**Primary target:** ETHGlobal Tokyo 2026 — Intercepta, *Safe Agent-to-Agent Payments with x402*.

Risksir is first and foremost an Intercepta-powered safety layer inside an autonomous x402 buyer flow.

For every real payment attempt:

1. An autonomous buyer agent receives an x402 payment requirement for an API, dataset, compute resource or other paid service.
2. Before the payer can sign, the selected payment is screened with a live Intercepta API call.
3. Intercepta evidence about the actual payment subject is evaluated together with the organisation's active payment policy.
4. The result directly produces one of five actions: `PAY`, `CAP`, `HOLD`, `ASK_HUMAN`, or `DENY`.
5. A held or denied payment produces zero payer-signing calls.
6. The demo includes both a successful payment and a payment blocked or held because of visible Intercepta evidence.

This pre-sign decision path is the project's load-bearing sponsor integration and exists independently of the regression subsystem.

## Differentiation beyond the baseline bounty

A one-shot `Intercepta → allow/block` flow satisfies the core safety problem but is not the complete Risksir product.

Risksir adds a second feedback loop:

`payment outcome / incident → policy diagnosis → candidate policy → historical replay → measured trade-offs → approved policy version → next x402 payment`

The regression subsystem does not replace Intercepta's threat intelligence.

- Intercepta determines what risk evidence is known at the moment of payment.
- Risksir determines how a particular organisation should act on that evidence and whether its own payment policy should evolve after observing real outcomes.

Therefore:

> **Intercepta detects risk. Risksir governs and continuously validates how an autonomous payer reacts to that risk.**

The target-track demo must prove the Intercepta pre-sign decision first. The regression loop is the project's differentiation, not a substitute for the sponsor's required payment-screening flow.
