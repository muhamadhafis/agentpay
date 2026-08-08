import { describe, expect, test } from "bun:test";
import { makeX402, paymentRequired } from "../src/x402";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

const payload = (over = {}) => ({
  x402Version: 2,
  resource: { url: "http://t/tasks/1/pay", description: "pay", mimeType: "application/json" },
  accepted: {
    scheme: "exact",
    network: "eip155:10143",
    amount: "5000000",
    asset: "0xusdc",
    payTo: "0xworker",
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
  },
  payload: { signature: "0x123", authorization: { from: "0xa1", to: "0xworker", value: "5000000", validAfter: "0", validBefore: "9999999999", nonce: "0x00" } },
  ...over,
});

describe("x402 server-side", () => {
  test("tanpa header PAYMENT-SIGNATURE → tidak valid", async () => {
    const x = makeX402({ getSignature: () => null });
    const r = await x.verify(new Request("http://t"));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing PAYMENT-SIGNATURE header");
  });

  test("header bukan base64 → tidak valid", async () => {
    const x = makeX402({ getSignature: () => "!!!not-base64!!!" });
    const r = await x.verify(new Request("http://t"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("bad signature");
  });

  test("verify facilitator setuju → valid + payer", async () => {
    const x = makeX402({
      getSignature: () => b64(payload()),
      verify: async () => ({ ok: true, sender: "0xa1" }),
    });
    const r = await x.verify(new Request("http://t"));
    expect(r.ok).toBe(true);
    expect(r.sender).toBe("0xa1");
  });

  test("verify facilitator tolak → tidak valid", async () => {
    const x = makeX402({
      getSignature: () => b64(payload()),
      verify: async () => ({ ok: false, reason: "insufficient_funds" }),
    });
    const r = await x.verify(new Request("http://t"));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_funds");
  });

  test("settle facilitator sukses → tx", async () => {
    const x = makeX402({
      getSignature: () => b64(payload()),
      settle: async () => ({ ok: true, tx: "0xtx123" }),
    });
    const r = await x.settle(new Request("http://t"));
    expect(r.ok).toBe(true);
    expect(r.tx).toBe("0xtx123");
  });

  test("settle tanpa header → gagal", async () => {
    const x = makeX402({ getSignature: () => null });
    const r = await x.settle(new Request("http://t"));
    expect(r.ok).toBe(false);
  });

  test("requirements exact: payTo, amount micro, asset USDC, network monad testnet", () => {
    const req = paymentRequired("0xworker", 0.01, "http://t/tasks/1/pay");
    expect(req.x402Version).toBe(2);
    expect(req.accepts).toHaveLength(1);
    const a = req.accepts[0];
    expect(a.scheme).toBe("exact");
    expect(a.network).toBe("eip155:10143");
    expect(a.amount).toBe("10000");
    expect(a.payTo).toBe("0xworker");
    expect(a.asset).toBe(process.env.USDC_TEST_ADDRESS ?? "");
    expect(a.extra).toEqual({ name: "USDC", version: "2" });
  });
});
