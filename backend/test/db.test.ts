import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db";
import type { Task } from "../src/db";

describe("db", () => {
  test("migrate creates tables", async () => {
    const db = createDb();
    const tables = await db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .then((rs) => rs.map((r) => (r as { name: string }).name));
    expect(tables).toEqual(["submissions", "tasks", "users"]);
  });

  test("insert user task submission roundtrip", async () => {
    const db = createDb();
    await db.query("INSERT INTO users (address, registered_at) VALUES (?, ?)").run(
      "0xA1",
      "now",
    );
    const task = await db
      .query(
        `INSERT INTO tasks (poster, title, description, budget_usd, status, created_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?) RETURNING *`,
      )
      .get("0xA1", "t", "d", 5.0, "now") as Task;
    const id = task.id;
    await db.query(
      "INSERT INTO submissions (task_id, content, score, at) VALUES (?, ?, ?, ?)",
    ).run(id, "hasil", 8, "now");

    const sub = await db
      .query("SELECT * FROM submissions WHERE task_id = ?")
      .get(id) as { content: string; score: number };
    expect(sub.content).toBe("hasil");
    expect(sub.score).toBe(8);
    expect((await db.query("SELECT * FROM users").all()).length).toBe(1);
  });
});
