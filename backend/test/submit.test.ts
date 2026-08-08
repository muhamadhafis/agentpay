import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

const task = { poster: "0xa1", title: "t", description: "d", budgetUsd: 5 };

const upload = async (fetch: ReturnType<typeof makeTestApp>["fetch"], judgeScore?: number) => {
  const created = await call(fetch, "POST", "/tasks", task);
  await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
  const r = await call(
    fetch,
    "POST",
    `/tasks/${created.data.id}/submit`,
    { content: "submission content longer than twenty bytes" },
  );
  return { id: created.data.id, r };
};

describe("submit + status", () => {
  test("judge score tinggi → APPROVED", async () => {
    const { fetch } = makeTestApp({ judge: { score: 9 } });
    const { r } = await upload(fetch);
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("APPROVED");
    expect(r.data.score).toBe(9);
  });

  test("judge score rendah → REJECTED", async () => {
    const { fetch } = makeTestApp({ judge: { score: 3 } });
    const { r } = await upload(fetch);
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("REJECTED");
  });

  test("submit saat bukan IN_PROGRESS → 409", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/submit`, { content: "x" });
    expect(r.status).toBe(409);
  });

  test("submit tanpa content → 400", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/submit`, {});
    expect(r.status).toBe(400);
  });

  test("submit URL non-GitHub → 400", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/submit`, {
      content: "https://example.com/x",
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("GitHub");
  });

  test("submit campur teks+link → 400", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/submit`, {
      content: "saya kerjakan di https://github.com/a/b",
    });
    expect(r.status).toBe(400);
  });

  test("submit link GitHub → judge menerima isi README", async () => {
    let judgedContent = "";
    const { fetch } = makeTestApp({
      judge: { score: 9, capture: (c) => (judgedContent = c) },
      fetchReadme: async () => "README PANJANG SEKALI UNTUK TUGAS",
    });
    const created = await call(fetch, "POST", "/tasks", task);
    await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/submit`, {
      content: "https://github.com/owner/repo-name",
    });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("APPROVED");
    expect(judgedContent).toBe("README PANJANG SEKALI UNTUK TUGAS");
  });
});