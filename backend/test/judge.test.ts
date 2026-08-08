import { describe, expect, test } from "bun:test";
import { makeJudge } from "../src/judge";

const stubFetch = (content: string, status = 200) =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
    )) as unknown as typeof fetch;

describe("judge", () => {
  test("stub: skor dari panjang content (1-10)", async () => {
    const judge = makeJudge({ apiKey: "" });
    const r = await judge.judge("a short answer", "task");
    expect(r.score).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeLessThanOrEqual(10);
    const long = await judge.judge("x".repeat(200), "task");
    expect(long.score).toBeGreaterThanOrEqual(8);
  });

  test("groq (key ada, fetch mocked): JSON valid → score dipakai", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = stubFetch('{"score": 8, "reason": "baik"}');
    try {
      const judge = makeJudge({ apiKey: "test-key" });
      const r = await judge.judge("result", "title");
      expect(r.score).toBe(8);
      expect(r.reason).toBe("baik");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("groq kronologis: HTTP error → score 0", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = stubFetch("err", 500);
    try {
      const judge = makeJudge({ apiKey: "test-key" });
      const r = await judge.judge("x", "t");
      expect(r.score).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("groq: JSON rusak → score 0", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = stubFetch("not json");
    try {
      const judge = makeJudge({ apiKey: "test-key" });
      const r = await judge.judge("x", "t");
      expect(r.score).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("tanpa key → fallback deterministik", async () => {
    const judge = makeJudge({ apiKey: "" });
    expect(typeof (await judge.judge("halo", "t")).score).toBe("number");
  });
});