import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../api/index.js";

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("health endpoint reports service and integration readiness", async () => {
  const response = await fetch(baseUrl + "/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "udyam-api");
  assert.equal(typeof body.integrations.database, "boolean");
});

test("review queue is protected by authentication", async () => {
  const response = await fetch(baseUrl + "/api/kyc/queue");
  assert.equal(response.status, 401);
});

test("admin audit endpoint is protected by authentication", async () => {
  const response = await fetch(baseUrl + "/api/admin/audit");
  assert.equal(response.status, 401);
});

test("WhatsApp webhook fails closed when signature secret is not configured", async () => {
  const previous = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  try {
    const response = await fetch(baseUrl + "/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [] })
    });
    assert.equal(response.status, 503);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = previous;
  }
});
