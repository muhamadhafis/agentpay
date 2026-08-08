import { makeRouter } from "../src/router";
import { createApp } from "../src/app";
import { createChain } from "../src/chain";

// Server test: in-memory DB + stub chain/judge/x402 (tanpa network).
export const makeTestApp = (opts: {
  judge?: { score?: number; reason?: string; capture?: (content: string) => void };
  x402Ok?: boolean;
  threshold?: number;
  fetchReadme?: (owner: string, repo: string) => Promise<string | null>;
  payer?: string;
  balanceUsdc?: (address: string) => Promise<string | null>;
} = {}) => {
  let taskId = 0;
  const app = createApp({
    chain: {
      createTask: async () => ({ taskId: ++taskId, tx: "0xcreate" }),
      claimTask: async () => ({ tx: "0xclaim" }),
      setApproved: async () => ({ tx: "0xapprove" }),
      recordPayment: async () => ({ tx: "0xstub" }),
    },
    judge: {
      judge: async (content: string, title: string) => {
        opts.judge?.capture?.(content);
        const score = opts.judge?.score ?? Math.min(10, Math.max(1, Math.floor(content.length / 20)));
        return { score, reason: opts.judge?.reason ?? `stub judge for "${title}"` };
      },
    },
    x402: {
      verify: async () =>
        opts.x402Ok === false ? { ok: false } : { ok: true, sender: opts.payer ?? "0xa1" },
      settle: async () => (opts.x402Ok === false ? { ok: false } : { ok: true, tx: "0xsettled" }),
      requirements: (payTo, amountUsd) => ({ payment: { amount: amountUsd, payTo, network: "eip155:10143" } }),
    },
    payTo: "0xplt",
    threshold: opts.threshold ?? 7,
    fetchReadme: opts.fetchReadme ?? (async () => null),
    balanceUsdc: opts.balanceUsdc ?? (async () => "1234567"),
  });
  const fetch = makeRouter(app);
  return { app, fetch };
};

export const call = async (
  fetch: (req: Request) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
) => {
  const res = await fetch(
    new Request(`http://test${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const data: any = await res.json().catch(() => null);
  return { status: res.status, data };
};