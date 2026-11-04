import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import app from "../api/index.js";
import { buildEstimate } from "../api/lib/quote-engine.js";
import { encryptSensitive, decryptSensitive, tokenizeSensitive } from "../api/lib/crypto-vault.js";

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

test("customer-facing inline JavaScript parses without syntax errors", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const scripts = [];
  let cursor = 0;
  while ((cursor = html.indexOf("<script>", cursor)) >= 0) {
    const start = cursor + "<script>".length;
    const end = html.indexOf("</script>", start);
    if (end < 0) break;
    scripts.push(html.slice(start, end));
    cursor = end + "</script>".length;
  }
  assert.ok(scripts.length > 0, "expected at least one inline application script");
  for (const script of scripts) new Function(script[1]);
});

test("sensitive values are AES-GCM encrypted and deterministically tokenized", () => {
  const previousEncryption = process.env.DATA_ENCRYPTION_KEY;
  const previousToken = process.env.TOKENIZATION_SECRET;
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.TOKENIZATION_SECRET = "test-tokenization-secret-which-is-long-enough";
  try {
    const value = "22AAAAA0000A1Z5";
    const first = encryptSensitive(value, "gstin");
    const second = encryptSensitive(value, "gstin");
    assert.equal(decryptSensitive(first.ciphertext), value);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(first.token, second.token);
    assert.notEqual(tokenizeSensitive(value, "gstin"), tokenizeSensitive(value, "udyam"));
  } finally {
    if (previousEncryption === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousEncryption;
    if (previousToken === undefined) delete process.env.TOKENIZATION_SECRET;
    else process.env.TOKENIZATION_SECRET = previousToken;
  }
});
