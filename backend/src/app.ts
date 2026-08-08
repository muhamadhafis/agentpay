import { createDb, type Db, type Task } from "./db";

export interface Chain {
  createTask(poster: string, budgetUsd: number): Promise<{ taskId: number; tx?: string }>;
  claimTask(taskId: number, worker: string): Promise<{ tx?: string }>;
  setApproved(taskId: number, rejected?: boolean): Promise<{ tx?: string }>;
  recordPayment(taskId: number, hash: string): Promise<{ tx: string }>;
}

export interface Judge {
  judge(content: string, title: string): Promise<{ score: number; reason: string }>;
}

export interface X402 {
  verify(req: Request): Promise<{ ok: boolean; sender?: string; reason?: string }>;
  settle(req: Request): Promise<{ ok: boolean; tx?: string; reason?: string }>;
  requirements(payTo: string, amountUsd: number, resourceUrl?: string): Record<string, unknown>;
}

export interface App {
  db: Db;
  chain: Chain;
  judge: Judge;
  x402: X402;
  payTo: string;
  threshold: number;
  fetchReadme(owner: string, repo: string): Promise<string | null>;
  balanceUsdc(address: string): Promise<string | null>;
  notify(): void;
}

export const createApp = (opts: { db?: Db; chain?: Chain; judge?: Judge; x402?: X402; payTo?: string; threshold?: number; fetchReadme?: (owner: string, repo: string) => Promise<string | null>; balanceUsdc?: (address: string) => Promise<string | null>; notify?: () => void } = {}): App => ({
  db: opts.db ?? createDb(),
  chain: opts.chain ?? null as unknown as Chain, // index.ts inject yang nyata; test inject stub
  judge: opts.judge ?? null as unknown as Judge,
  x402: opts.x402 ?? null as unknown as X402,
  payTo: opts.payTo ?? "",
  threshold: opts.threshold ?? 7,
  fetchReadme: opts.fetchReadme ?? fetchGithubReadme,
  balanceUsdc: opts.balanceUsdc ?? (async () => null),
  notify: opts.notify ?? (() => {}),
});

// submit hanya menerima plain text ATAU satu link github — tidak campur.
const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

export type SubmissionKind = { type: "text"; content: string } | { type: "github"; owner: string; repo: string } | null;

export const classifySubmission = (content: string): SubmissionKind => {
  const c = content.trim();
  if (!c) return null;
  if (c.includes("://")) {
    const m = c.match(GITHUB_RE);
    if (m) {
      const [, owner, repo] = m;
      return { type: "github", owner, repo };
    }
    return null;
  }
  return { type: "text", content: c };
};

// fetch isi README via raw GitHub (tanpa auth, cukup untuk demo).
// ponytail: raw.githubusercontent tidak kena rate-limit API; pendekatan paling sederhana.
const fetchGithubReadme = async (owner: string, repo: string): Promise<string | null> => {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

// --- domain ops (dipakai router; test memanggil router via HTTP) ---

export const register = async (app: App, address: string) => {
  const clean = address.toLowerCase();
  if (await app.db.query("SELECT 1 FROM users WHERE address = ?").get(clean))
    return { ok: false, error: "already registered" };
  await app.db
    .query("INSERT INTO users (address, registered_at) VALUES (?, ?)")
    .run(clean, new Date().toISOString());
  return { ok: true, user: { address: clean } };
};

export const list = async (app: App, status?: string) =>
  (status
    ? await app.db.query("SELECT * FROM tasks WHERE status = ? ORDER BY id").all(status)
    : await app.db.query("SELECT * FROM tasks ORDER BY id").all()) as Task[];

export const createTask = async (
  app: App,
  input: { poster?: string; title?: string; description?: string; budgetUsd?: number },
) => {
  if (!input.poster || !input.title || !input.description || typeof input.budgetUsd !== "number" || input.budgetUsd <= 0)
    return { ok: false, error: "poster, title, description, budgetUsd>0 required" };
  // onchain dulu → dapat id kontrak + tx hash; barulah simpan DB (DB tetap source of truth).
  const { taskId, tx: txCreate } = await app.chain.createTask(input.poster, input.budgetUsd);
  const task = await app.db
    .query(
      `INSERT INTO tasks (poster, title, description, budget_usd, status, chain_id, tx_create, created_at)
       VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?) RETURNING *`,
    )
    .get(input.poster, input.title, input.description, input.budgetUsd, taskId, txCreate ?? null, new Date().toISOString()) as Task;
  return { ok: true, task };
};

export const claim = async (app: App, id: number, worker: string) => {
  const t = await app.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!t) return { ok: false, error: "task not found" };
  if (t.status !== "OPEN") return { ok: false, error: "task not open" };
  const { tx: txClaim } = await app.chain.claimTask(t.chain_id ?? id, worker.toLowerCase());
  const task = await app.db
    .query("UPDATE tasks SET worker = ?, status = 'IN_PROGRESS', tx_claim = ? WHERE id = ? RETURNING *")
    .get(worker.toLowerCase(), txClaim ?? null, id) as Task;
  return { ok: true, task };
};

export const submit = async (app: App, id: number, content: string) => {
  const t = await app.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!t) return { ok: false, error: "task not found" };
  if (t.status !== "IN_PROGRESS") return { ok: false, error: "task not in progress" };

  const kind = classifySubmission(content);
  if (!kind) return { ok: false, error: "content must be plain text or a GitHub URL" };

  let judged = content;
  if (kind.type === "github") {
    const readme = await app.fetchReadme(kind.owner, kind.repo);
    if (readme) judged = readme;
    else {
      const { tx } = await app.chain.setApproved(t.chain_id ?? id, true);
      const task = await app.db
        .query(
          `UPDATE tasks SET status = 'REJECTED', score = 0, judgement_reason = ?, submission_content = ?, tx_approve = ?
           WHERE id = ? RETURNING *`,
        )
        .get("cannot fetch GitHub repo", content, tx ?? null, id) as Task;
      return { ok: true, task };
    }
  }

  const { score, reason } = await app.judge.judge(judged, t.title);
  const status = score >= app.threshold ? "APPROVED" : "REJECTED";
  const { tx: txApprove } = await app.chain.setApproved(t.chain_id ?? id, status === "REJECTED");
  const task = await app.db
    .query(
      `UPDATE tasks SET status = ?, score = ?, judgement_reason = ?, submission_content = ?, tx_approve = ?
       WHERE id = ? RETURNING *`,
    )
    .get(status, score, reason, content, txApprove ?? null, id) as Task;
  return { ok: true, task };
};

export const pay = async (app: App, id: number, req: Request) => {
  const t = await app.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!t) return { ok: false, error: "task not found" };
  if (t.status !== "APPROVED") return { ok: false, error: "task not approved" };

  const check = await app.x402.verify(req);
  if (!check.ok)
    return {
      ok: false,
      error: "payment required",
      hint: app.x402.requirements(t.worker!, t.budget_usd, new URL(req.url).pathname),
    };

  // pembayar harus poster (A membayar B/worker)
  if (check.sender && check.sender.toLowerCase() !== t.poster.toLowerCase())
    return { ok: false, error: "payer must be the task poster" };

  const settled = await app.x402.settle(req);
  if (!settled.ok)
    return { ok: false, error: `settle failed: ${settled.reason ?? "unknown"}` };

  const worker = t.worker!;
  const hash = Bun.CryptoHasher.hash("sha256", `${id}:${worker}:${t.budget_usd}`).toString("hex");
  const { tx } = await app.chain.recordPayment(t.chain_id ?? id, hash);
  const payTx = settled.tx ?? tx;
  const task = await app.db
    .query("UPDATE tasks SET status = 'COMPLETED', task_hash = ?, tx_pay = ? WHERE id = ? RETURNING *")
    .get(hash, payTx, id) as Task;
  return { ok: true, task, tx: payTx };
};

export const history = async (app: App, address: string) => {
  const clean = address.toLowerCase();
  const posted = await app.db.query("SELECT * FROM tasks WHERE poster = ? ORDER BY id").all(clean) as Task[];
  const worked = await app.db.query("SELECT * FROM tasks WHERE worker = ? ORDER BY id").all(clean) as Task[];
  return { posted, worked };
};

export const premiumStats = async (app: App, req: Request) => {
  const check = await app.x402.verify(req);
  if (!check.ok) return { ok: false as const, requirements: app.x402.requirements(app.payTo, 0.005) };
  const stats = {
    open: await app.db.query("SELECT COUNT(*) c FROM tasks WHERE status='OPEN'").get("") as { c: number },
    completed: await app.db.query("SELECT COUNT(*) c FROM tasks WHERE status='COMPLETED'").get("") as { c: number },
    agents: await app.db.query("SELECT COUNT(*) c FROM users").get("") as { c: number },
  };
  return { ok: true as const, data: { open: stats.open.c, completed: stats.completed.c, agents: stats.agents.c } };
}