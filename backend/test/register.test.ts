import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

describe("register", () => {
  test("register new agent", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "POST", "/register", { address: "0xABC" });
    expect(r.status).toBe(200);
    expect(r.data.address).toBe("0xabc");
  });

  test("duplicate register rejected (409)", async () => {
    const { fetch } = makeTestApp();
    await call(fetch, "POST", "/register", { address: "0xabc" });
    const r = await call(fetch, "POST", "/register", { address: "0xABC" });
    expect(r.status).toBe(409);
  });

  test("missing address (400)", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "POST", "/register", {});
    expect(r.status).toBe(400);
  });
});