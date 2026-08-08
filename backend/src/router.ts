import { createApp, list, register as regFn, createTask, claim, submit, pay, history, premiumStats, type App } from "./app";
import { createDb } from "./db";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

// satu handler → dipakai index.ts (prod, port 3000) dan test (inject)
export const makeRouter = (app: App) =>
  async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    const method = req.method;

    if (pathname === "/health" && method === "GET") return json({ ok: true });

    // static frontend: / dan /app.js (file di ../../frontend/)
    if (
      method === "GET" &&
      (pathname === "/" || pathname === "/docs" || pathname === "/dev" || pathname === "/app.js" || pathname === "/style.css" || pathname === "/docs.css")
    ) {
      const file =
        pathname === "/" ? "index.html" : pathname === "/docs" || pathname === "/dev" ? "docs.html" : pathname.slice(1);
      const f = await Bun.file(new URL(`../../frontend/${file}`, import.meta.url)).exists();
      if (!f) return json({ error: "not found" }, 404);
      const mime = file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
      return new Response(await Bun.file(new URL(`../../frontend/${file}`, import.meta.url)).text(), {
        headers: { "content-type": mime },
      });
    }

    // konfigurasi publik untuk frontend (usdc, network, chainId, explorer)
    if (pathname === "/config" && method === "GET")
      return json({
        usdc: process.env.USDC_TEST_ADDRESS ?? "",
        network: "eip155:10143",
        chainId: 10143,
        usdcName: "USDC",
        usdcVersion: "2",
        rpcUrl: process.env.MONAD_RPC_URL ?? "",
        agentpay: process.env.AGENTPAY_ADDRESS ?? "",
        explorer: "https://testnet.monadscan.com",
      });

    // balance USDC proxy (frontend butuh readContract tanpa CDN viem)
    if (pathname.startsWith("/balance/") && method === "GET") {
      const addr = pathname.slice("/balance/".length);
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return json({ error: "bad address" }, 400);
      const b = await app.balanceUsdc(addr);
      return b === null ? json({ error: "balance unavailable" }, 502) : json({ balance: b });
    }

    if (pathname === "/register" && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { address?: string };
      if (!body.address) return json({ error: "address required" }, 400);
      const r = await regFn(app, body.address);
      if (r.ok) app.notify();
      return r.ok ? json(r.user) : json({ error: r.error }, 409);
    }

    if (pathname === "/tasks" && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        poster?: string;
        title?: string;
        description?: string;
        budgetUsd?: number;
      };
      const r = await createTask(app, body);
      if (r.ok) app.notify();
      return r.ok ? json(r.task, 201) : json({ error: r.error }, 400);
    }

    if (pathname === "/tasks" && method === "GET") {
      return json({ tasks: await list(app, new URL(req.url).searchParams.get("status") ?? undefined) });
    }

    const m = pathname.match(/^\/tasks\/(\d+)\/(\w+)$/);
    if (m && method === "POST") {
      const id = Number(m[1]);
      const action = m[2];
      if (action === "claim") {
        const body = (await req.json().catch(() => ({}))) as { worker?: string };
        if (!body.worker) return json({ error: "worker required" }, 400);
        const r = await claim(app, id, body.worker);
        if (r.ok) app.notify();
        const status = r.error === "task not found" ? 404 : 409;
        return r.ok ? json(r.task) : json({ error: r.error }, status);
      }
      if (action === "submit") {
        const body = (await req.json().catch(() => ({}))) as { content?: string };
        if (!body.content) return json({ error: "content required" }, 400);
        const r = await submit(app, id, body.content);
        if (r.ok) app.notify();
        if (r.ok) return json(r.task);
        const status = r.error === "task not found" ? 404 : r.error === "task not in progress" ? 409 : 400;
        return json({ error: r.error }, status);
      }
      if (action === "pay") {
        const r = await pay(app, id, req);
        if (r.ok) app.notify();
        return r.ok
          ? json({ task: r.task, tx: r.tx })
          : "hint" in r
            ? new Response(JSON.stringify(r.hint), {
              status: 402,
              headers: { "content-type": "application/json" },
            })
            : json({ error: r.error }, 409);
      }
    }

    const u = pathname.match(/^\/users\/(.+)\/tasks$/);
    if (u && method === "GET") return json(await history(app, u[1]));

    if (pathname === "/premium/stats") {
      const r = await premiumStats(app, req);
      if (!r.ok)
        return new Response(JSON.stringify(r.requirements), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      return json(r.data);
    }

    return json({ error: "not found" }, 404);
  };

// prod wiring: bun.serve + app dengan dependency nyata (lihat real deps di bawah)
export const startServer = (app: App) =>
  Bun.serve({
    port: 3000,
    fetch: makeRouter(app),
  });

// entri prod: dependency asli (chain viem, judge groq, x402 facilitator)
import { makeChain, usdcBalanceOf } from "./chain";
import { makeJudge } from "./judge";
import { makeX402 } from "./x402";

export const createProdApp = (): App =>
  createApp({
    // DB: Turso bila env terisi; selain itu file lokal (DB_PATH / agentpay.sql).
    db: createDb(
      process.env.DB_PATH ??
        (process.env.TURSO_URL && process.env.TURSO_TOKEN ? undefined : "agentpay.sql"),
    ),
    chain: makeChain(),
    judge: makeJudge(),
    x402: makeX402(),
    payTo: process.env.X402_PAY_TO_ADDRESS ?? "",
    threshold: Number(process.env.AI_JUDGE_THRESHOLD ?? 7),
    balanceUsdc: usdcBalanceOf,
  });