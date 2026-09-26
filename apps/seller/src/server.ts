import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import express from 'express';
import type { Express } from 'express';

/**
 * The x402 paid service (a counterparty: untrusted from Risksir's point of view). One route per variant, each with
 * its own `payTo` taken from SELLER_PAY_TO_SAFE / _RISKY / _ALT. Uses the official @x402/express middleware with the
 * `exact` EVM scheme on Base Sepolia. Prices are money strings such as "$0.05" (USDC, 6 decimals).
 */
export const SELLER_NETWORK = 'eip155:84532' as const;

export type SellerVariant = 'safe' | 'risky' | 'alt';

export interface SellerRoute {
  variant: SellerVariant;
  payTo: string;
  /** Money string, e.g. "$0.05". Must stay within OPERATIONAL_GUARDRAILS section 4 (at most 0.10 USDC). */
  price: string;
}

export interface SellerConfig {
  facilitatorUrl: string;
  routes: SellerRoute[];
}

export const routePath = (variant: SellerVariant): string => `/paid/report/${variant}`;

export function createSellerApp(config: SellerConfig): Express {
  const app = express();

  const routes = Object.fromEntries(
    config.routes.map((r) => [
      `GET ${routePath(r.variant)}`,
      {
        accepts: [{ scheme: 'exact', price: r.price, network: SELLER_NETWORK, payTo: r.payTo }],
        description: `Risksir demo report (${r.variant})`,
        mimeType: 'application/json',
      },
    ]),
  );

  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl })).register(
    SELLER_NETWORK,
    new ExactEvmScheme(),
  );
  app.use(paymentMiddleware(routes, server));

  for (const r of config.routes) {
    app.get(routePath(r.variant), (_req, res) => {
      res.json({ report: `demo report for ${r.variant}`, variant: r.variant, payTo: r.payTo });
    });
  }
  return app;
}
