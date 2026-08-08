// AgentPay frontend — vanilla JS, wallet via window.ethereum (MetaMask etc.).
const $ = (s) => document.querySelector(s);
const toast = (msg, err = false) => {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", err);
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 4000);
};

let address = null;
let cfg = null;
let filter = "semua";
let allTasks = [];

const api = async (method, path, body, headers = {}) => {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

const eth = () => {
  if (!window.ethereum) throw new Error("Wallet not found. Install MetaMask.");
  return window.ethereum;
};

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const fmtDate = (iso) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---- wallet ----
const setWalletUi = () => {
  if (address) {
    $("#btnConnect").textContent = short(address);
    $("#btnConnect").classList.add("connected");
  } else {
    $("#btnConnect").textContent = "Connect wallet";
    $("#btnConnect").classList.remove("connected");
    $("#usdcBal").textContent = "— USDC";
  }
};

const connect = async () => {
  // connected → click = disconnect
  if (address) {
    const e = window.ethereum;
    try { await e.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch { /* wallet tanpa revoke — abaikan */ }
    address = null;
    setWalletUi();
    toast("Wallet disconnected");
    refresh();
    return;
  }
  const e = eth();
  const [a] = await e.request({ method: "eth_requestAccounts" });
  address = a.toLowerCase();
  setWalletUi();
  // register silently — no extra button needed
  api("POST", "/register", { address }).catch(() => {});
  refresh();
};

// ---- balance USDC ----
const refreshBalance = async () => {
  if (!address || !cfg) return;
  const r = await api("GET", `/balance/${address}`);
  $("#usdcBal").textContent = r.data?.balance ? `$${(Number(r.data.balance) / 1e6).toFixed(2)} USDC` : "— USDC";
};

// ---- post task (dialog) ----
$("#btnPost").onclick = () => {
  if (!address) return toast("Connect your wallet first", true);
  $("#postDlg").showModal();
};
$("#postDlg").querySelector("form").onsubmit = async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const btn = $("#btnPostOk");
  btn.disabled = true;
  const r = await api("POST", "/tasks", {
    poster: address,
    title: f.get("title"),
    description: f.get("description"),
    budgetUsd: Number(f.get("budget")),
  });
  btn.disabled = false;
  if (r.status === 201) {
    toast(`Task #${r.data.id} posted ✓`);
    ev.target.reset();
    $("#postDlg").close();
    refresh();
  } else toast(r.data?.error ?? "failed to post task", true);
};

// close dialogs: any [data-close] element closes its dialog
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = () => document.getElementById(b.dataset.close)?.close();
});

// ---- list: compact card, expand saat diklik ----
const renderTask = (t) => {
  const el = document.createElement("div");
  el.className = "item";
  el.innerHTML = `
    <button class="item-head" aria-expanded="false">
      <span class="item-title">${escapeHtml(t.title)}</span>
      <span class="item-brief">
        <span class="item-date">${fmtDate(t.created_at)}</span>
        <span class="item-reward">$${Number(t.budget_usd).toFixed(2)}</span>
        <span class="status s-${t.status}">${t.status.replace("_", " ")}</span>
        <span class="chev">▾</span>
      </span>
    </button>
    <div class="item-detail">
      <div class="item-grid">
        <div class="kv"><span class="k">poster</span><span class="v">${short(t.poster)}</span></div>
        <div class="kv"><span class="k">reward</span><span class="v">$${Number(t.budget_usd).toFixed(2)} USDC</span></div>
        ${t.worker ? `<div class="kv"><span class="k">worker</span><span class="v">${short(t.worker)}</span></div>` : ""}
        ${t.score != null ? `<div class="kv"><span class="k">score</span><span class="v">${t.score}/10</span></div>` : ""}
        <div class="kv"><span class="k">created</span><span class="v">${fmtDate(t.created_at)}</span></div>
        ${t.chain_id != null ? `<div class="kv"><span class="k">onchain</span><span class="v">#${t.chain_id}</span></div>` : ""}
      </div>
      <div class="item-block">
        <span class="k">description</span>
        <p class="item-desc">${escapeHtml(t.description ?? "")}</p>
      </div>
      ${t.judgement_reason ? `
      <div class="item-block">
        <span class="k">AI verdict</span>
        <p class="item-reason">“${escapeHtml(t.judgement_reason)}”</p>
      </div>` : ""}
      ${scanLinks(t)}
      <div class="item-actions"></div>
    </div>`;
  const head = el.querySelector(".item-head");
  head.onclick = () => {
    const open = el.classList.toggle("open");
    head.setAttribute("aria-expanded", String(open));
  };

  const acts = el.querySelector(".item-actions");
  if (t.status === "OPEN") {
    const b = btn("Claim", "ghost", async () => {
      const r = await api("POST", `/tasks/${t.id}/claim`, { worker: address });
      if (r.status !== 200) toast(r.data?.error ?? "claim failed", true);
      refresh();
    });
    acts.appendChild(b);
  }
  if (t.status === "IN_PROGRESS" && t.worker === address) {
    const input = document.createElement("input");
    input.placeholder = "Your work: text or github.com/… link";
    const b = btn("Submit", "ghost", async () => {
      if (!input.value.trim()) return toast("Add your work first", true);
      const r = await api("POST", `/tasks/${t.id}/submit`, { content: input.value });
      if (r.status !== 200) toast(r.data?.error ?? "submit failed", true);
      refresh();
    });
    acts.append(input, b);
  }
  if (t.status === "APPROVED" && t.poster === address) {
    const b = btn("Pay", "primary", async () => payTask(t));
    acts.appendChild(b);
  }
  return el;
};

const btn = (label, cls, onClick) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = cls ? `btn btn-${cls}` : "btn btn-ghost";
  b.onclick = onClick;
  return b;
};

const escapeHtml = (s) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- MonadScan links ----
const scanLink = (hash, label) =>
  `<a class="scan" target="_blank" rel="noopener" href="${cfg.explorer}/tx/${hash}" title="${hash}">↗ ${label}</a>`;

const scanLinks = (t) => {
  const parts = [];
  if (t.tx_create) parts.push(scanLink(t.tx_create, "create"));
  if (t.tx_claim) parts.push(scanLink(t.tx_claim, "claim"));
  if (t.tx_approve) parts.push(scanLink(t.tx_approve, "approve"));
  if (t.tx_pay) parts.push(scanLink(t.tx_pay, "pay"));
  if (t.chain_id != null)
    parts.push(
      `<a class="scan" target="_blank" rel="noopener" href="${cfg.explorer}/address/${cfg.agentpay}#code" title="Kontrak AgentPay">↗ chain #${t.chain_id}</a>`,
    );
  return parts.length
    ? `<div class="item-links"><span class="k">onchain</span><span class="links">${parts.join("")}</span></div>`
    : "";
};

// ---- filter pills ----
const FILTERS = {
  semua: () => allTasks,
  terbuka: () => allTasks.filter((t) => t.status === "OPEN"),
  selesai: () => allTasks.filter((t) => t.status === "COMPLETED"),
  milik: () =>
    address
      ? allTasks.filter((t) => t.poster === address || t.worker === address)
      : [],
};

const EMPTY_TEXT = {
  semua: "No tasks yet.",
  terbuka: "No open tasks.",
  selesai: "No completed tasks.",
  milik: "No tasks of yours yet.",
};

$("#pills").addEventListener("click", (ev) => {
  const pill = ev.target.closest(".pill");
  if (!pill) return;
  filter = pill.dataset.filter;
  $("#pills").querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === pill));
  renderList();
});

const renderList = () => {
  const tasks = FILTERS[filter]();
  $("#taskList").replaceChildren(...tasks.map(renderTask));
  const empty = $("#taskEmpty");
  empty.textContent = EMPTY_TEXT[filter];
  empty.classList.toggle("hidden", tasks.length > 0);
};

const refresh = async () => {
  refreshBalance();
  const r = await api("GET", "/tasks");
  allTasks = (r.data?.tasks ?? []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  renderList();
};

// ---- pay: x402 flow (402 → sign EIP-3009 → retry PAYMENT-SIGNATURE) ----
const payTask = async (t) => {
  const dlg = $("#payDlg");
  $("#payInfo").innerHTML =
    `Pay <b>$${Number(t.budget_usd).toFixed(2)} USDC</b> to <b>${short(t.worker)}</b> for task <b>#${t.id}</b>?`;
  dlg.showModal();
  dlg.querySelector("form").onsubmit = async (ev) => {
    ev.preventDefault();
    dlg.close();
    try {
      await doPay(t);
    } catch (err) {
      toast(err.message, true);
    }
  };
};

const doPay = async (t) => {
  const e = eth();
  // 1. minta → 402 + requirements
  const first = await api("POST", `/tasks/${t.id}/pay`);
  if (first.status !== 402) throw new Error(first.data?.error ?? "state task berubah");
  const req = first.data;
  const acc = req.accepts[0];

  // 2. sign EIP-3009 TransferWithAuthorization via wallet
  const now = Math.floor(Date.now() / 1000);
  const nonce = "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const auth = {
    from: address,
    to: acc.payTo,
    value: acc.amount,
    validAfter: String(now - 60),
    validBefore: String(now + 120),
    nonce,
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    domain: {
      name: acc.extra?.name ?? "USDC",
      version: acc.extra?.version ?? "2",
      chainId: cfg.chainId,
      verifyingContract: acc.asset,
    },
    message: auth,
  };
  const signature = await e.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(typedData)],
  });

  // 3. build payment payload → header base64 → retry
  const payload = {
    x402Version: 2,
    resource: req.resource,
    accepted: acc,
    payload: { signature, authorization: auth },
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const r = await api("POST", `/tasks/${t.id}/pay`, undefined, { "PAYMENT-SIGNATURE": b64 });
  if (r.status === 200) {
    toast(`Task #${t.id} paid ✓ tx ${short(r.data.tx)}`);
  } else {
    toast(r.data?.error ?? "payment failed", true);
  }
  refresh();
};

// ---- real-time: WS broadcast from server → auto re-render on all devices ----
let ws = null;
const connectWs = () => {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === "refresh") refresh();
    } catch { /* abaikan pesan tak dikenal */ }
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
};

// ---- init ----
$("#btnConnect").onclick = connect;

const init = async () => {
  cfg = (await api("GET", "/config")).data;
  const e = window.ethereum;
  if (e) {
    try {
      const [a] = await e.request({ method: "eth_accounts" });
      if (a) {
        address = a.toLowerCase();
        setWalletUi();
        api("POST", "/register", { address }).catch(() => {});
      }
    } catch { /* wallet exists but locked — keep Connect button */ }
    e.on("accountsChanged", () => location.reload());
    e.on("disconnect", () => { address = null; setWalletUi(); refresh(); });
  }
  refresh();
  connectWs();
};
init();
