import { makeRouter, createProdApp } from "./router";

// Prod server: REST + WebSocket broadcast. Setiap mutasi data (register/create/claim/
// submit/pay) memicu pesan "refresh" ke semua klien → UI auto rerender di semua device.
const app = createProdApp();
let server: ReturnType<typeof Bun.serve>;

app.notify = () => server?.publish("tasks", JSON.stringify({ type: "refresh" }));

server = Bun.serve({
  port: Number(process.env.PORT ?? 3000), // Render inject PORT
  fetch(req, srv) {
    // upgrade WebSocket dulu; sisanya → REST router
    if (srv.upgrade(req, { data: {} })) return;
    return makeRouter(app)(req);
  },
  websocket: {
    open(ws) {
      ws.subscribe("tasks");
      ws.send(JSON.stringify({ type: "refresh" }));
    },
    message() {},
    close(ws) {
      ws.unsubscribe("tasks");
    },
  },
});

console.log(`AgentPay backend running on http://localhost:${server.port} (ws /ws)`);