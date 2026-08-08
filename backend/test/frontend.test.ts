import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

describe("frontend static + helpers", () => {
  test("GET / → index.html", async () => {
    const { fetch } = makeTestApp();
    const res = await fetch(new Request("http://test/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AgentPay");
  });

  test("GET /app.js → javascript", async () => {
    const { fetch } = makeTestApp();
    const res = await fetch(new Request("http://test/app.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  test("GET /config → usdc + chainId", async () => {
    const { fetch } = makeTestApp();
    const { data } = await call(fetch, "GET", "/config");
    expect(data.chainId).toBe(10143);
    expect(typeof data.usdc).toBe("string");
  });

  test("GET /balance/:addr → balance via app.balanceUsdc", async () => {
    const { fetch } = makeTestApp();
    const res = await call(fetch, "GET", "/balance/0x1111111111111111111111111111111111111111");
    expect(res.status).toBe(200);
    expect(res.data.balance).toBe("1234567");
  });

  test("GET /balance saat unavailable → 502", async () => {
    const { fetch } = makeTestApp({ balanceUsdc: async () => null });
    const r1 = await call(fetch, "GET", "/balance/0x2222222222222222222222222222222222222222");
    expect(r1.status).toBe(502);
  });

  test("GET /balance/format-salah → 400", async () => {
    const { fetch } = makeTestApp();
    const res = await call(fetch, "GET", "/balance/nope");
    expect(res.status).toBe(400);
  });
});
