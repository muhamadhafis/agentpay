import { makeRouter, createProdApp } from "../src/router";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import fs from "node:fs";
import path from "node:path";

// Demo E2E: agent A (wallet 2) buat task → agent B (wallet 3) claim+kerja →
// AI judge → kalau lolos A bayar B. Semua lewat API, kontrak di chain nyata.
// Contoh: bun scripts/e2e-real.ts  (butuh .env terisi + .env bikinan sendiri)
const root = path.resolve(import.meta.dir, "..", "..");
const envRaw = fs.readFileSync(path.join(root, ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  const v = line.slice(i + 1).trim();
  if (!(k in process.env)) process.env[k] = v;
}
const get = (k: string) => process.env[k] ?? "";
const priv = (k: string) =>
  ("0x" + (get(k) ?? "").replace(/^0x/, "")) as `0x${string}`;

const log = (s: string, d?: unknown) => console.log("\n▸", s, d === undefined ? "" : JSON.stringify(d, null, 0));

const main = async () => {
  // default: DB lokal temp supaya e2e tidak mencemari data; E2E_TURSO=1 → pakai Turso.
  if (!process.env.E2E_TURSO) process.env.DB_PATH = `/tmp/agentpay-e2e-${Date.now()}.db`;
  const app = createProdApp();
  const fetch = makeRouter(app);
  const req = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(
      new Request(`http://test${p}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, data: (await res.json().catch(() => null)) as any };
  };

  const w2 = privateKeyToAccount(priv("SAMPLE_PRIVATE_KEY_WALLET_2"));
  const w3 = privateKeyToAccount(priv("SAMPLE_PRIVATE_KEY_WALLET_3"));
  const aAddr = w2.address;
  const bAddr = w3.address;

  log("1. register A & B");
  log("  A:", aAddr);
  log("  B:", bAddr);
  await req("POST", "/register", { address: aAddr });
  await req("POST", "/register", { address: bAddr });

  log("2. A buat task (onchain createTask + DB)");
  const t = await req("POST", "/tasks", {
    poster: aAddr,
    title: "Buat haiku tentang Monad",
    description: "Tulis haiku 3 baris, tema blockchain Monad",
    budgetUsd: 0.01,
  });
  const task = t.data;
  log("  task:", { id: task.id, chain_id: task.chain_id, status: task.status });

  log("3. B lihat daftar OPEN & claim");
  const open = await req("GET", "/tasks?status=OPEN");
  log("  OPEN:", open.data.tasks.map((x) => x.id));
  const cl = await req("POST", `/tasks/${task.id}/claim`, { worker: bAddr });
  log("  setelah claim:", cl.data?.status);

  log("4. B submit hasil → AI Judge");
  const sub = await req("POST", `/tasks/${task.id}/submit`, {
    content: "Monads async, / lambat tapi pasti, / dalam satu blok.",
  });
  log("  judge:", { status: sub.data?.status, score: sub.data?.score });

  if (sub.data?.status !== "APPROVED") {
    log("!skor di bawah threshold — tidak dibayar", { score: sub.data?.score, reason: sub.data?.judgement_reason });
    return;
  }

  log("5. A bayar B otomatis (x402 + recordPayment onchain)");
  // 5a. minta bayar → server jawab 402 + payment requirements
  const first = await fetch(
    new Request(`http://test/tasks/${task.id}/pay`, { method: "POST", headers: { "content-type": "application/json" } }),
  );
  if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${await first.text()}`);
  const paymentRequired = (await first.json()) as {
    accepts: { amount: string; asset: string; payTo: string; network: string; extra: { name: string; version: string } }[];
    resource: { url: string };
  };
  const acc = paymentRequired.accepts[0];
  log("  requirements:", { amount: acc.amount, payTo: acc.payTo });

  // 5b. A (poster) tanda tangani EIP-3009 TransferWithAuthorization
  const usdc = acc.asset as `0x${string}`;
  const wA = privateKeyToAccount(priv("SAMPLE_PRIVATE_KEY_WALLET_2"));
  const now = Math.floor(Date.now() / 1000);
  const domain = { name: acc.extra.name, version: acc.extra.version, chainId: 10143, verifyingContract: usdc };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;
  const auth = {
    from: wA.address,
    to: acc.payTo,
    value: BigInt(acc.amount),
    validAfter: now - 60,
    validBefore: now + 120,
    nonce: ("0x" + Math.random().toString(16).slice(2).padStart(64, "0")) as `0x${string}`,
  };
  const signature = await (wA as LocalAccount).signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: auth,
  });
  const paymentPayload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: acc,
    payload: {
      signature,
      authorization: {
        from: auth.from,
        to: auth.to,
        value: auth.value.toString(),
        validAfter: auth.validAfter.toString(),
        validBefore: auth.validBefore.toString(),
        nonce: auth.nonce,
      },
    },
  };
  const sigHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  log("  signature EIP-3009:", signature.slice(0, 20) + "…");

  // 5c. ulangi dengan PAYMENT-SIGNATURE → server verify+settle via facilitator → onchain
  const pay = await req("POST", `/tasks/${task.id}/pay`, {}, { "PAYMENT-SIGNATURE": sigHeader });
  log("  pay:", { status: pay.data?.task?.status, tx: pay.data?.tx });

  log("6. history A & B");
  const ha = await req("GET", `/users/${aAddr}/tasks`);
  const hb = await req("GET", `/users/${bAddr}/tasks`);
  log("  A posted:", ha.data.posted.map((t) => ({ id: t.id, status: t.status })));
  log("  B worked:", hb.data.worked.map((t) => ({ id: t.id, status: t.status })));
  log("\n✅ Selesai — task", task.id, "status", pay.data?.task?.status);
};

main().catch((e) => {
  console.error("E2E gagal:", e);
  process.exit(1);
});