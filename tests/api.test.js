import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../api/index.js";
import { buildEstimate } from "../api/lib/quote-engine.js";

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

test("quote engine calculates prices from the canonical catalogue, not client values", () => {
  const business = { cityTier:"1", segment:"micro", employees:2, sites:1 };
  const estimate = buildEstimate(business, [{sku:"P01",quantity:2,monthlyMin:0,monthlyMax:0,setupFee:0}]);
  assert.equal(estimate.monthlyMin, 1998);
  assert.equal(estimate.monthlyMax, 2398);
  assert.equal(estimate.setupTotal, 0);
  assert.equal(estimate.contractMonths, 12);
  assert.equal(estimate.items[0].monthlyMin, 999);
  assert.equal(estimate.pricingSource, "CASE_CATALOGUE_ESTIMATE");
});

test("quote engine rejects a dependent service without its base connectivity", () => {
  const business = { cityTier:"1", segment:"prof", employees:2, sites:1 };
  assert.throws(() => buildEstimate(business, [{sku:"P09",quantity:1}]), /requires a compatible base connectivity service/);
});

test("quote engine accepts a valid dependent bundle and calculates setup fees", () => {
  const business = { cityTier:"1", segment:"prof", employees:2, sites:1 };
  const estimate = buildEstimate(business, [{sku:"P01",quantity:1},{sku:"P09",quantity:1}]);
  assert.equal(estimate.monthlyMin, 1498);
  assert.equal(estimate.monthlyMax, 1798);
  assert.equal(estimate.setupTotal, 1500);
});

test("quote engine requires a GSTIN format for catalogue products that require one", () => {
  const business = { cityTier:"1", segment:"prof", employees:5, sites:1 };
  assert.throws(() => buildEstimate(business, [{sku:"P03",quantity:1}]), /requires a GSTIN/);
  const estimate = buildEstimate({...business,gstin:"22AAAAA0000A1Z5"}, [{sku:"P03",quantity:1}]);
  assert.equal(estimate.monthlyMin, 3999);
});

test("quote engine rejects duplicate and unknown SKUs", () => {
  const business = { cityTier:"1", segment:"micro", employees:2, sites:1 };
  assert.throws(() => buildEstimate(business, [{sku:"P01",quantity:1},{sku:"P01",quantity:2}]), /only once/);
  assert.throws(() => buildEstimate(business, [{sku:"FAKE",quantity:1}]), /Unknown catalogue service/);
});
