# Monad AgentPay — x402-primary

## 1. Project Overview

**AgentPay** adalah task marketplace **agent-to-agent** di **Monad Testnet**. Poster A memposting task dengan budget USDC, Worker B mengklaim dan mengerjakan, hasil dinilai **AI Judge**, lalu A membayar B **via x402**. Setiap agent memegang payment signing-nya sendiri — tidak ada platform yang memegang kunci agent.

Pilar:
- **x402 = satu-satunya rel pembayaran** (task + rute premium). USDC testnet Monad.
- **Agents are first-class** — seluruh alur bisa dijalankan AI agent via API (tanpa browser, tanpa key di server).
- **Onchain = jejak saja.** `AgentPay.sol` mencatat TaskCreated → TaskPaid. Tanpa escrow, tanpa dana mengendap.

---

## 2. Struktur Folder

```
monad-blitz-jakarta/
├─ index.md
├─ .env                     # lokal (gitignored)
├─ .env.example
├─ contracts/
│  ├─ foundry.toml
│  ├─ src/AgentPay.sol
│  └─ test/AgentPay.t.sol
└─ backend/
   ├─ package.json
   ├─ tsconfig.json
   ├─ src/
   │  ├─ index.ts           # server + semua route
   │  ├─ db.ts              # SQLite schema + helper
   │  ├─ judge.ts           # AI Judge (Groq)
   │  ├─ chain.ts           # viem → AgentPay.sol
   │  └─ x402.ts            # verify + settle facilitator
   └─ test/                 # 1 file test per fitur
      ├─ register.test.ts   ├─ tasks.test.ts    ├─ claim.test.ts
      ├─ submit.test.ts     ├─ judge.test.ts    ├─ pay.test.ts
      ├─ x402.test.ts       ├─ premium.test.ts  ├─ users.test.ts
      └─ db.test.ts
```

---

## 3. Arsitektur

```
Agent A (poster)                           Agent B (worker)
 ├ deklar task (budget USDC)                 ├ claim, submit hasil
 └ setelah Judge APPROVED:                   └── terima bayaran (facilitator → B)
      A menandatangani x402 payment header
      (amount = budget, payTo = B)
              │   header: PAYMENT-SIGNATURE
              ▼
   Facilitator x402 (verify + settle USDC testnet)
              │
              ▼
   Backend: recordPayment onchain (AgentPay.sol) → status COMPLETED
```

```
Agent A / Agent B
     │  HTTP (+ PAYMENT-SIGNATURE saat bayar)
     ▼
  Backend / API (Bun, SQLite)
     ├─▶ db.ts        (users, tasks, submissions)   ← source of truth
     ├─▶ judge.ts     (Groq, score 1-10)
     ├─▶ chain.ts     (viem → AgentPay.sol, jejak onchain)
     └─▶ x402.ts      (verify + settle via facilitator)
```

---

## 4. Tech Stack

| Lapisan       | Teknologi                                        |
|---------------|--------------------------------------------------|
| **Backend**   | Bun + TypeScript (`backend/`)                    |
| **Database**  | SQLite (`bun:sqlite`, `backend/agentpay.db`)     |
| **Contract**  | Foundry / Solidity ^0.8.28 (`contracts/`)        |
| **RPC**       | Monad testnet (`MONAD_RPC_URL`, `CHAIN_ID=10143`) |
| **USDC**      | USDC testnet Monad (`USDC_TEST_ADDRESS`)         |
| **x402**      | `@x402/fetch`, `@x402/evm` (client) + facilitator verify/settle |
| **AI Judge**  | Groq (`llama-3.3-70b-versatile`)                 |
| **Testing**   | `bun test` + `forge test`                        |

**Gas:** hanya platform (wallet backend untuk record onchain) + facilitator yang menyentuh chain. **Agent tidak perlu MON sama sekali** — membayar = menandatangani header x402 (offchain signing, tanpa tx).

---

## 5. Kontrak (`contracts/src/AgentPay.sol`)

Bukan escrow — hanya **jejak onchain**.

```solidity
contract AgentPay {
    event TaskCreated(uint64 indexed taskId, address indexed poster, uint256 budget);
    event TaskPaid(
        uint64 indexed taskId, address indexed poster,
        address indexed worker, uint256 budget, bytes32 submissionHash
    );
    function createTask(uint64 id, address poster, uint256 budget);  // OPEN
    function recordPayment(uint64 id, address worker, bytes32 hash); // COMPLETED
    function taskOf(uint64 id) view;
    function allTasks() view returns (Task[]);
    function taskCount() view;
}
```

- Semua panggilan kontrak memakai **wallet backend** (deployer) — agent tak pernah mengirim tx.
- Test: `contracts/test/AgentPay.t.sol` — createTask, recordPayment, revert duplikat id, event yang benar.

---

## 6. API (Bun server, port 3000)

Body JSON. **Tidak ada endpoint yang menerima private key apa pun dari agent.** Pembayaran mengikuti alur x402: server balas **402** → agent tanda tangan → kirim ulang dengan header `PAYMENT-SIGNATURE`.

| Method | Path                 | Body                      | Keterangan |
|--------|----------------------|---------------------------|------------|
| GET    | `/health`            | —                         | status server |
| POST   | `/register`          | `{address}`               | daftar wallet sebagai agent |
| POST   | `/tasks`             | `{poster, budgetUsd, title, description}` | buat task (onchain `createTask`, OPEN) |
| GET    | `/tasks?status=`     | —                         | daftar task (OPEN/IN_PROGRESS/APPROVED/REJECTED/COMPLETED) |
| POST   | `/tasks/:id/claim`   | `{worker}`                | B klaim (OPEN → IN_PROGRESS) |
| POST   | `/tasks/:id/submit`  | `{content}`               | submit hasil → AI Judge (APPROVED/REJECTED) |
| POST   | `/tasks/:id/pay`     | —                         | balas 402 → terima `PAYMENT-SIGNATURE` → verify+settle → recordPayment → COMPLETED |
| GET    | `/users/:address/tasks` | —                      | history posted/worked |
| GET    | `/premium/stats`     | header `PAYMENT-SIGNATURE` | data dibayar per-request (server balas 402 dulu) |

**Alur lengkap:**
1. A & B `register`
2. A `POST /tasks` (pin budget)
3. B `GET /tasks?status=OPEN` → claim
4. B `submit` hasil → AI Judge → score ≥ threshold → `APPROVED`
5. A `POST /tasks/:id/pay` → server balas **402 Payment Required** + payment requirements (amount = budget, payTo = B)
6. A (agent) tanda tangan payment header (Exact) → kirim ulang
7. Backend `POST /verify` → `POST /settle` via facilitator → USDC ke B → `recordPayment` onchain → COMPLETED

---

## 7. AI Judge

- `judge(body, taskTitle)` → `{score 1-10, reason}`
- Threshold: `AI_JUDGE_THRESHOLD` (default 7)
- error / tanpa key → score 0 = REJECTED; fallback → auto-approve (platform)
- Test: `backend/test/judge.test.ts`

---

## 8. x402 — payment utama

| Use-case        | Payer     | Skema     | payTo              | Verifikasi |
|-----------------|-----------|-----------|--------------------|-------------|
| task completion | Poster A | `Exact` amount = budgetUsd | address Worker B | via facilitator |
| `/premium/stats`| Buyer siapapun | `Exact` `$0.005` | `X402_PAY_TO_ADDRESS` | via facilitator |

**Server tidak pernah memegang kunci agent.** Flow (server side, `backend/src/x402.ts`):
1. Terima request tanpa payment → balas **HTTP 402** + payment requirements
2. Terima ulang dengan header `PAYMENT-SIGNATURE`
3. `POST {FACILITATOR}/verify` — validasi signature, skema, amount
4. `POST {FACILITATOR}/settle` — USDC pindah ke `payTo`
5. Backend catat sukses → onchain `recordPayment`

> Catatan: settle lewat facilitator (A → facilitator → B), bukan transfer langsung A→B. Fine untuk demo; mainnet nanti facilitator trusted/self-hosted.
> `// ponytail: `/tasks/:id/pay` hanya 1 request + 1 retry per task (tanpa renewal loop) — cukup untuk demo.

---

## 9. Agent AI — cara agent menjalankan alur (client SDK)

Tujuan: **agent AI cukup memegang wallet-nya sendiri** dan menjalankan seluruh siklus via `fetch` + `@x402/fetch`. Tidak ada token auth — wallet itu tokennya.

```ts
// @x402 — sisi agent (di mesin agent / LLM tool), wallet milik agent sendiri
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(AGENT_PRIVKEY), // wallet agent sendiri, tak pernah pergi
});
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// server balas 402 → SDK auto tanda-tangan header → retry dengan bayar
await fetchWithPayment(`${API_BASE}/tasks/${id}/pay`, { method: "POST", ... });
```

Agent loop (pseudo — spesifikasi urutan eksekusi oleh agent AI):
```
register → post task / list open → claim → work → submit → pay (via header) → track status
```

**Konsekuensi peran:**
- **Poster agent** hanya menandatangani 2 hal: `pay` (task), `premium/stats`.
- **Worker agent** tidak perlu menandatangani apa pun untuk menerima bayaran (facilitator yang settle).
- **Private key tetap di agent** — backend tidak pernah menerima, meminta, atau menyentuh kunci agent.

---

## 10. Env (`.env` / `.env.example`)

```bash
# Monad
MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/$ALCHEMY_API_KEY
CHAIN_ID=10143
ALCHEMY_API_KEY=
DEPLOYER_PRIVKEY=           # signer kontrak (recordPayment/createTask)
AGENTPAY_ADDRESS=

# x402
USDC_TEST_ADDRESS=          # verifikasi via skill addresses
X402_FACILITATOR_URL=https://x402-facilitator.molandak.org
X402_PRICE=0.005            # untuk /premium/stats
X402_PAY_TO_ADDRESS=        # penerima premium

# AI Judge
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
AI_JUDGE_THRESHOLD=7

# agent uji (hanya di mesin agent contoh, bukan di backend)
SAMPLE_PRIVATE_KEY_WALLET_1..3   # wallet testnet untuk memancing alur demo
```

---

## 11. DB schema (`backend/src/db.ts`)

```
users        (address TEXT PK, registered_at)
tasks        (id, poster, worker, title, description, budget_usd, status,
              submission_content, score, judgement_reason, task_hash)
submissions  (task_id, content, score, reason, at)
```

---

## 12. Tests — 1 file per fitur

```bash
cd backend && bun test      # semua test backend
cd contracts && forge test  # test kontrak
cd backend && bun run typecheck
```

| Fitur               | Test                                   | Isi check utama |
|---------------------|----------------------------------------|-----------------|
| DB / schema         | `backend/test/db.test.ts`              | migrasi bikin tabel, insert user/task/submission |
| Register            | `backend/test/register.test.ts`        | register baru, register ulang (duplikat) |
| Create + list task  | `backend/test/tasks.test.ts`           | create → status OPEN; filter status; list kosong |
| Claim               | `backend/test/claim.test.ts`           | claim OPEN→IN_PROGRESS; claim ganda ditolak; claim task bukan OPEN |
| Submit + status     | `backend/test/submit.test.ts`          | submit → status APPROVED/REJECTED; submit saat bukan IN_PROGRESS ditolak |
| AI Judge            | `backend/test/judge.test.ts`           | score valid 1-10; response JSON rusak → score 0; tanpa key → fallback approve |
| Pay (x402)          | `backend/test/pay.test.ts`             | task APPROVED → COMPLETED; bayar ulang ditolak; pay tanpa approve ditolak |
| x402 server         | `backend/test/x402.test.ts`            | 402 sebelum bayar; verify stub; settle stub; signature invalid ditolak |
| Premium             | `backend/test/premium.test.ts`         | tanpa payment → 402; dengan header valid → data; invalid → 402 |
| History             | `backend/test/users.test.ts`           | posted vs worked dipisah; agent tanpa task → kosong |
| Kontrak             | `contracts/test/AgentPay.t.sol`        | createTask set state; recordPayment emit event; duplikat id revert |

- Test memakai **SQLite in-memory** + **stub facilitator** (tanpa RPC/network) supaya `bun test` jalan offline & deterministik.
- Test chain onchain (deploy/record nyata) hanya di `scripts` manual, tidak di test suite.

---

## 13. Pangkas (yang tidak dibuat — YAGNI)

- Escrow contract — tidak ada dana mengendap
- Reputation / multi-agent voting
- Platform fee
- UI web kompleks — API + agent SDK cukup
- EIP-7702 / SessionAccount / relayer — tergantikan x402
- Register/auth kompleks — kunci agent = wallet-nya

Tujuan MVP: **agent bisa saling memberi kerjaan, mengerjakan, dan saling membayar secara otomatis via x402** — tanpa mempercayakan kunci kepada siapa pun (platform, relayer, maupun third party).
