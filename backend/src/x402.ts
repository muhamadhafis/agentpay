import type { X402 } from "./app";

// Skema x402 v2 "exact" di Monad testnet (USDC, EIP-3009).
// Server: decode PAYMENT-SIGNATURE → verify di facilitator → settle → transfer onchain.

const NETWORK = "eip155:10143";
const MAX_TIMEOUT = 60;
// lazy: dibaca saat dipakai (test & script memuat .env setelah import)
const usdcAddress = () => process.env.USDC_TEST_ADDRESS ?? "";

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface PaymentPayload {
  x402Version: number;
  resource: { url: string; description?: string; mimeType?: string };
  accepted: PaymentRequirements;
  payload: { signature: string; authorization: Authorization };
}

interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export const microAmount = (amountUsd: number) => Math.round(amountUsd * 1e6).toString();

// Requirements yang dikirim saat 402 — format PaymentRequired v2.
export const paymentRequired = (payTo: string, amountUsd: number, resourceUrl: string) => ({
  x402Version: 2,
  resource: { url: resourceUrl, description: "AgentPay task payment", mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: NETWORK,
      amount: microAmount(amountUsd),
      asset: usdcAddress(),
      payTo,
      maxTimeoutSeconds: MAX_TIMEOUT,
      extra: { name: "USDC", version: "2" },
    },
  ],
});

// Decode header PAYMENT-SIGNATURE (base64 dari PaymentPayload) + validasi accepted vs requirement.
const decodeSignature = (raw: string): PaymentPayload => {
  const json = Buffer.from(raw, "base64").toString("utf8");
  const payload = JSON.parse(json) as PaymentPayload;
  if (payload.x402Version !== 2) throw new Error("unsupported x402 version");
  return payload;
};

const callFacilitator = async (url: string, endpoint: "verify" | "settle", paymentPayload: PaymentPayload) => {
  const res = await fetch(`${url}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: paymentPayload.accepted,
    }),
  });
  return (await res.json()) as { isValid: boolean; payer?: string; invalidReason?: string; transaction?: string };
};

export const makeX402 = (opts: {
  facilitatorUrl?: string;
  getSignature?: (req: Request) => string | null;
  verify?: (req: Request) => Promise<{ ok: boolean; sender?: string; reason?: string }>;
  settle?: (req: Request) => Promise<{ ok: boolean; tx?: string; reason?: string }>;
} = {}): X402 => {
  const facilitatorUrl = opts.facilitatorUrl ?? process.env.X402_FACILITATOR_URL;
  const getSignature = opts.getSignature ?? ((req) => req.headers.get("PAYMENT-SIGNATURE"));

  // default nyata: tanya facilitator /verify
  const verifyReal: X402["verify"] = async (req) => {
    const sig = getSignature(req);
    if (!sig || !sig.trim()) return { ok: false, reason: "missing PAYMENT-SIGNATURE header" };
    try {
      const payload = decodeSignature(sig);
      const r = await callFacilitator(facilitatorUrl as string, "verify", payload);
      return r.isValid ? { ok: true, sender: r.payer } : { ok: false, reason: r.invalidReason ?? "invalid payment" };
    } catch (e) {
      return { ok: false, reason: `bad signature: ${(e as Error).message}` };
    }
  };

  const settleReal: X402["settle"] = async (req) => {
    const sig = getSignature(req);
    if (!sig) return { ok: false, reason: "missing PAYMENT-SIGNATURE header" };
    try {
      const payload = decodeSignature(sig);
      const r = await callFacilitator(facilitatorUrl as string, "settle", payload);
      // settle responden pakai {success, transaction} — bukan {isValid}
      if ((r as { success?: boolean }).success === true) return { ok: true, tx: r.transaction };
      return { ok: false, reason: r.invalidReason ?? r.payer ?? "settle failed" };
    } catch (e) {
      return { ok: false, reason: `bad signature: ${(e as Error).message}` };
    }
  };

  const verify = opts.verify ?? verifyReal;
  const settle = opts.settle ?? settleReal;

  return {
    verify,
    settle,
    requirements: (payTo, amountUsd, resourceUrl) => paymentRequired(payTo, amountUsd, resourceUrl ?? "http://agentpay/task/pay"),
  };
};
