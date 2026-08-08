import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

const task = { poster: "0xa1", title: "t", description: "d", budgetUsd: 5 };

const approvedUntil = async (fetch: ReturnType<typeof makeTestApp>["fetch"]) => {
  const created = await call(fetch, "POST", "/tasks", task);
  await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
  await call(fetch, "POST", `/tasks/${created.data.id}/submit`, { content: "x".repeat(200) });
  return created.data.id;
};

describe("pay (x402)", () => {
  test("pay APPROVED → COMPLETED + tx", async () => {
    const { fetch } = makeTestApp();
    const id = await approvedUntil(fetch);
    const r = await call(fetch, "POST", `/tasks/${id}/pay`);
    expect(r.status).toBe(200);
    expect(r.data.task.status).toBe("COMPLETED");
    expect(r.data.tx).toBe("0xsettled");
  });

  test("payer bukan poster → 409", async () => {
    const { fetch } = makeTestApp({ payer: "0xother" });
    const id = await approvedUntil(fetch);
    const r = await call(fetch, "POST", `/tasks/${id}/pay`);
    expect(r.status).toBe(409);
    expect(r.data.error).toContain("payer");
  });

  test("tanpa x402 valid → 402 + requirements", async () => {
    const { fetch } = makeTestApp({ x402Ok: false });
    const id = await approvedUntil(fetch);
    const r = await call(fetch, "POST", `/tasks/${id}/pay`);
    expect(r.status).toBe(402);
    expect(r.data.payment.amount).toBe(5);
  });

  test("pay ulang (sudah COMPLETED) → 409", async () => {
    const { fetch } = makeTestApp();
    const id = await approvedUntil(fetch);
    await call(fetch, "POST", `/tasks/${id}/pay`);
    const r = await call(fetch, "POST", `/tasks/${id}/pay`);
    expect(r.status).toBe(409);
  });

  test("pay sebelum APPROVED (masih IN_PROGRESS) → 409", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/pay`);
    expect(r.status).toBe(409);
  });
});