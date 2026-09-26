import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import express from 'express';
import { createSellerApp } from '@risksir/seller';
import type { SellerRoute } from '@risksir/seller';

/** Local test servers. Everything binds to 127.0.0.1 only and nothing touches a live facilitator (TEST_PLAN L3). */
export interface Running {
  url: string;
  close(): Promise<void>;
}

async function listen(server: Server): Promise<Running> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export type SettleMode = 'ok' | 'hangup' | 'fail' | 'error500';

export interface StubFacilitator extends Running {
  calls: { supported: number; verify: number; settle: number };
  settled: { payer: string; to: string; value: string; transaction: string }[];
  mode: { settle: SettleMode };
}

/** Stub of the x402 facilitator HTTP API: GET /supported, POST /verify, POST /settle. */
export async function startStubFacilitator(): Promise<StubFacilitator> {
  const state = {
    calls: { supported: 0, verify: 0, settle: 0 },
    settled: [] as StubFacilitator['settled'],
    mode: { settle: 'ok' as SettleMode },
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/supported') {
        state.calls.supported += 1;
        return send(res, 200, {
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }],
          extensions: [],
          signers: { 'eip155:*': [`0x${'ee'.repeat(20)}`] },
        });
      }
      const body = await readJson(req);
      const payload = (body.paymentPayload as { payload?: { authorization?: { from: string; to: string; value: string } } } | undefined)?.payload;
      const auth = payload?.authorization;
      if (req.method === 'POST' && req.url === '/verify') {
        state.calls.verify += 1;
        return send(res, 200, { isValid: Boolean(auth), payer: auth?.from });
      }
      if (req.method === 'POST' && req.url === '/settle') {
        state.calls.settle += 1;
        if (state.mode.settle === 'hangup') return void req.socket.destroy();
        if (state.mode.settle === 'error500') return send(res, 500, { error: 'facilitator down' });
        if (state.mode.settle === 'fail') {
          return send(res, 200, { success: false, errorReason: 'insufficient_funds', transaction: '', network: 'eip155:84532', payer: auth?.from });
        }
        const transaction = `0x${randomBytes(32).toString('hex')}`;
        state.settled.push({ payer: auth?.from ?? '', to: auth?.to ?? '', value: auth?.value ?? '', transaction });
        return send(res, 200, { success: true, transaction, network: 'eip155:84532', payer: auth?.from });
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, 500, { error: String(err) });
    }
  });
  const running = await listen(server);
  return { ...running, calls: state.calls, settled: state.settled, mode: state.mode };
}

/** The real @risksir/seller app (official @x402/express middleware) pointed at a facilitator. */
export async function startRealSeller(facilitatorUrl: string, routes: SellerRoute[]): Promise<Running> {
  const app = createSellerApp({ facilitatorUrl, routes });
  const server = createServer(app);
  return listen(server);
}

export interface RawRequirement {
  scheme: string;
  network: `${string}:${string}`;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface RawSeller extends Running {
  /** Requests that carried a payment signature header (must stay 0 for every blocked path). */
  paymentHeaders: () => number;
  requests: () => number;
  setAccepts(accepts: RawRequirement[]): void;
}

export const usdcRequirement = (over: Partial<RawRequirement> = {}): RawRequirement => ({
  scheme: 'exact',
  network: 'eip155:84532',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  amount: '50000',
  payTo: `0x${'11'.repeat(20)}`,
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' },
  ...over,
});

/** A hand-built seller returning a real HTTP 402 with an arbitrary `accepts` list, for adversarial quotes. */
export async function startRawSeller(initial: RawRequirement[]): Promise<RawSeller> {
  let accepts = initial;
  let paymentHeaders = 0;
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    if (req.headers['payment-signature']) {
      paymentHeaders += 1;
      return send(res, 200, { ok: true });
    }
    const header = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: `http://${req.headers.host}${req.url}` },
      accepts,
    });
    res.writeHead(402, { 'content-type': 'application/json', 'PAYMENT-REQUIRED': header });
    res.end(JSON.stringify({}));
  });
  const running = await listen(server);
  return { ...running, paymentHeaders: () => paymentHeaders, requests: () => requests, setAccepts: (a) => void (accepts = a) };
}

/** A seller whose handler succeeds (HTTP 200) but returns no usable body: payment settles, delivery does not (INV-014). */
export async function startEmptyBodySeller(facilitatorUrl: string, payTo: string): Promise<Running> {
  const app = express();
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register('eip155:84532', new ExactEvmScheme());
  app.use(
    paymentMiddleware(
      { 'GET /paid/report/empty': { accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:84532', payTo }], description: 'empty', mimeType: 'application/json' } },
      server,
    ),
  );
  app.get('/paid/report/empty', (_req, res) => {
    res.status(200).type('application/json').send('null');
  });
  return listen(createServer(app));
}
