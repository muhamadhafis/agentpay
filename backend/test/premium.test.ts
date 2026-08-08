import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

describe("premium/stats (berbayar x402)", () => {
  test("tanpa payment → 402 + requirements", async () => {
    const { fetch } = makeTestApp({ x402Ok: false });
    const r = await call(fetch, "GET", "/premium/stats");
    expect(r.status).toBe(402);
    expect(r.data.payment.amount).toBe(0.005);
    expect(r.data.payment.payTo).toBe("0xplt");
  });

  test("dengan payment valid → data stats", async () => {
    const { fetch } = makeTestApp();
    await call(fetch, "POST", "/register", { address: "0xa1" });
    await call(fetch, "POST", "/register", { address: "0xb2" });
    await call(fetch, "POST", "/tasks", {
      poster: "0xa1",
      title: "t",
      description: "d",
      budgetUsd: 5,
    });
    const r = await call(fetch, "GET", "/premium/stats");
    expect(r.status).toBe(200);
    expect(r.data.open).toBe(1);
    expect(r.data.completed).toBe(0);
    expect(r.data.agents).toBe(2);
  });
});