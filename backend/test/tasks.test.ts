import { describe, expect, test } from "bun:test";
import { makeTestApp, call } from "./helpers";

const task = { poster: "0xa1", title: "Write a haiku", description: "about berlin", budgetUsd: 5 };

describe("tasks (create + list)", () => {
  test("create → status OPEN", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "POST", "/tasks", task);
    expect(r.status).toBe(201);
    expect(r.data.status).toBe("OPEN");
    expect(typeof r.data.id).toBe("number");
  });

  test("create invalid body (400)", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "POST", "/tasks", { title: "x" });
    expect(r.status).toBe(400);
  });

  test("list all and filter by status", async () => {
    const { fetch } = makeTestApp();
    await call(fetch, "POST", "/tasks", task);
    const all = await call(fetch, "GET", "/tasks?status=OPEN");
    expect(all.data.tasks.length).toBe(1);
    const empty = await call(fetch, "GET", "/tasks?status=COMPLETED");
    expect(empty.data.tasks.length).toBe(0);
  });

  test("list empty", async () => {
    const { fetch } = makeTestApp();
    const r = await call(fetch, "GET", "/tasks");
    expect(r.data.tasks).toEqual([]);
  });
});