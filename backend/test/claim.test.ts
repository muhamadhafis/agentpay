import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

const task = { poster: "0xa1", title: "t", description: "d", budgetUsd: 5 };

describe("claim", () => {
  test("claim OPEN → IN_PROGRESS", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("IN_PROGRESS");
    expect(r.data.worker).toBe("0xb2");
  });

  test("double claim ditolak (409)", async () => {
    const { fetch } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xc3" });
    expect(r.status).toBe(409);
  });

  test("claim task yg bukan OPEN (COMPLETED) ditolak", async () => {
    const { fetch, app } = makeTestApp();
    const created = await call(fetch, "POST", "/tasks", task);
    app.db.query("UPDATE tasks SET status='COMPLETED' WHERE id=?").run(created.data.id);
    const r = await call(fetch, "POST", `/tasks/${created.data.id}/claim`, { worker: "0xb2" });
    expect(r.status).toBe(409);
  });

  test("claim task tak ada → 404", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "POST", "/tasks/999/claim", { worker: "0xb2" });
    expect(r.status).toBe(404);
  });
});