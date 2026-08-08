import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

const task = (poster: string) => ({ poster, title: "t", description: "d", budgetUsd: 5 });

describe("users history", () => {
  test("posted vs worked dipisah", async () => {
    const { fetch } = makeTestApp();
    const p1 = await call(fetch, "POST", "/tasks", task("0xa1"));
    await call(fetch, "POST", "/tasks", task("0xa1"));
    const p2 = await call(fetch, "POST", "/tasks", task("0xc3"));
    await call(fetch, "POST", `/tasks/${p2.data.id}/claim`, { worker: "0xa1" });

    const r = await call(fetch, "GET", "/users/0xa1/tasks");
    expect(r.status).toBe(200);
    expect(r.data.posted.length).toBe(2);
    expect(r.data.worked.length).toBe(1);
    expect(r.data.worked[0].id).toBe(p2.data.id);
  });

  test("agent tanpa task → kosong", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "GET", "/users/0xff/tasks");
    expect(r.data.posted).toEqual([]);
    expect(r.data.worked).toEqual([]);
  });
});