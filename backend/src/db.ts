import { Database } from "bun:sqlite";
import { createClient } from "@libsql/client";

// tipe bind parameter: cukup luas supaya muat bun:sqlite & libsql
// (number | string | bigint | null | typed array | object)
// ponytail: query app hanya pakai string/number/null — Uint8Array etc. tidak dipakai.
type Bind = string | number | bigint | null;

export type Status =
  | "OPEN"
  | "IN_PROGRESS"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED";

export interface User {
  address: string;
  registered_at: string;
}

export interface Task {
  id: number;
  poster: string;
  worker: string | null;
  title: string;
  description: string;
  budget_usd: number;
  status: Status;
  submission_content: string | null;
  score: number | null;
  judgement_reason: string | null;
  task_hash: string | null;
  chain_id: number | null;
  tx_create: string | null;
  tx_claim: string | null;
  tx_approve: string | null;
  tx_pay: string | null;
  created_at: string;
}

export interface Submission {
  task_id: number;
  content: string;
  score: number;
  reason: string | null;
  at: string;
}

// Antarmuka DB umum — semua method async supaya satu API untuk bun:sqlite (lokal,
// dipakai test/e2e) dan Turso (prod cloud). Pola: db.query(sql).get/all/run(...args).
export interface Db {
  query(sql: string): {
    get<T = Record<string, unknown>>(...args: Bind[]): Promise<T | undefined>;
    all<T = Record<string, unknown>>(...args: Bind[]): Promise<T[]>;
    run(...args: Bind[]): Promise<{ changes: number; lastInsertRowid: number }>;
  };
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    address TEXT PRIMARY KEY,
    registered_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    poster TEXT NOT NULL,
    worker TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget_usd REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    submission_content TEXT,
    score INTEGER,
    judgement_reason TEXT,
    task_hash TEXT,
    chain_id INTEGER,
    tx_create TEXT,
    tx_claim TEXT,
    tx_approve TEXT,
    tx_pay TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS submissions (
    task_id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    score INTEGER NOT NULL,
    reason TEXT,
    at TEXT NOT NULL
  );
`;

// migrasi kolom tx_* (DB lama) — idempoten
const MIGRATIONS = ["tx_create", "tx_claim", "tx_approve", "tx_pay"];

// ---- backend lokal (bun:sqlite) — test & e2e ----
export const createLocalDb = (path = ":memory:"): Db => {
  const db = new Database(path, { create: true });
  db.run(SCHEMA);
  for (const col of MIGRATIONS) {
    try {
      db.run(`ALTER TABLE tasks ADD COLUMN ${col} TEXT`);
    } catch {
      /* kolom sudah ada */
    }
  }
  return {
    query: (sql) => {
      const stmt = db.query(sql);
      return {
        get: async (...args) => stmt.get(...args) as never,
        all: async (...args) => stmt.all(...args) as never,
        run: async (...args) => {
          const r = stmt.run(...args);
          return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
        },
      };
    },
    close: () => db.close(),
  };
};

// ---- backend Turso (libSQL cloud) — prod ----
export const createTursoDb = (url: string, authToken: string): Db => {
  const client = createClient({ url, authToken });
  return {
    query: (sql) => ({
      get: async (...args) => {
        const res = await client.execute({ sql, args });
        return res.rows[0] as never;
      },
      all: async (...args) => {
        const res = await client.execute({ sql, args });
        return res.rows as never;
      },
      run: async (...args) => {
        const res = await client.execute({ sql, args });
        return { changes: res.rowsAffected, lastInsertRowid: Number(res.lastInsertRowid ?? 0) };
      },
    }),
    close: () => {},
  };
};

// pilih backend: Turso bila env lengkap, kalau tidak → lokal.
// ponytail: DB_PATH eksplisit (test/e2e) menang atas Turso.
export const createDb = (path?: string): Db => {
  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_TOKEN;
  if (!path && tursoUrl && tursoToken) return createTursoDb(tursoUrl, tursoToken);
  return createLocalDb(path ?? ":memory:");
};
