import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

let port;
let base;
const token = "kdb-api-test-owner";
let temporaryDirectory;
let server;
let startupError = "";

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer() {
  let latestError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (startupError) throw new Error(startupError);
    try {
      const response = await fetch(`${base}/api/store`);
      if (response.ok) return;
    } catch (error) { latestError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw latestError || new Error("KDB test server did not start.");
}

async function request(url, options = {}) {
  const response = await fetch(`${base}${url}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { response, body: await response.json() };
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kdb-hb-api-"));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, PORT: String(port), ADMIN_TOKEN: token, KDB_STORE_PATH: path.join(temporaryDirectory, "store.json") },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => { startupError += chunk; });
  await waitForServer();
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("public payload is filtered and owner routes require the configured token", async () => {
  const publicStore = await request("/api/store");
  assert.equal(publicStore.response.status, 200);
  assert.equal(publicStore.body.products.length, 3);
  assert.equal("orders" in publicStore.body, false);
  const denied = await request("/api/admin/store");
  assert.equal(denied.response.status, 401);
  const session = await request("/api/admin/session", { method: "POST", body: JSON.stringify({ token }) });
  assert.equal(session.response.status, 200);
});

test("owner operations protect commerce data while COD order totals remain server-calculated", async () => {
  const adminHeaders = { "x-kdb-admin-token": token };
  const order = await request("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      fullName: "KDB Integration Customer",
      phone: "0555000000",
      wilayaCode: "16",
      deliveryType: "domicile",
      baladiya: "القصبة",
      lines: [{ productId: "fringe", variantId: "fringe-standard", quantity: 1, price: 1 }],
    }),
  });
  assert.equal(order.response.status, 201);
  assert.equal(order.body.order.paymentMethod, "COD");
  assert.equal(order.body.order.total, 12500);
  assert.equal(order.body.order.baladiya, "القصبة");

  const status = await request(`/api/admin/orders/${order.body.order.id}`, {
    method: "PATCH", headers: adminHeaders, body: JSON.stringify({ status: "confirmed", notes: "Phone confirmation complete." }),
  });
  assert.equal(status.response.status, 200);
  assert.equal(status.body.order.status, "confirmed");
  assert.equal(status.body.order.notes, "Phone confirmation complete.");

  const media = await request("/api/admin/media", {
    method: "PUT", headers: adminHeaders, body: JSON.stringify({ id: "test-media", name: "Integration asset", url: "https://example.com/kdb.jpg", provider: "test", usage: "hero", section: "homepage", tags: ["test"] }),
  });
  assert.equal(media.response.status, 200);
  assert.equal(media.body.media.id, "test-media");

  const delivery = await request("/api/admin/delivery/16", {
    method: "PATCH", headers: adminHeaders, body: JSON.stringify({ domicileFee: 700, stopDeskFee: 350, enabled: true, free: false }),
  });
  assert.equal(delivery.response.status, 200);
  assert.equal(delivery.body.rule.domicileFee, 700);

  const analytics = await request("/api/admin/analytics", { headers: adminHeaders });
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.body.analytics.confirmedRevenue, 12500);
  assert.ok(analytics.body.analytics.mediaCount >= 3);
});

test("owner content, catalogue, configuration and recovery routes operate on the isolated repository", async () => {
  const adminHeaders = { "x-kdb-admin-token": token };
  const settings = await request("/api/admin/settings", {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ announcement: "COD only", storeOpen: true, identity: { storeName: "KDB Test", contactPhone: "0555000000" }, presentation: { heroInterval: 5000 }, catalog: { searchEnabled: true }, delivery: { handlingDays: "2–4 days" }, marketing: { consentTitle: "Privacy" }, seo: { title: "KDB Test" } }),
  });
  assert.equal(settings.response.status, 200);
  assert.equal(settings.body.settings.identity.storeName, "KDB Test");

  const content = await request("/api/admin/content", {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ about: { title: "Test room", body: "A valid owner-authored content test." }, projects: [], statistics: [{ id: "test-stat", label: "Wilayas", value: "58", visible: true }], certifications: [], sectionVisibility: { projects: false } }),
  });
  assert.equal(content.response.status, 200);
  assert.equal(content.body.content.about.title, "Test room");

  const hero = await request("/api/admin/heroes", {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ id: "test-hero", kicker: "Test", name: "Test hero", description: "A valid owner-controlled hero body.", action: "View", href: "#shop", image: "https://example.com/hero.jpg", mobileImage: "https://example.com/mobile.jpg", fallbackImage: "https://example.com/fallback.jpg", enabled: true, position: 1, textTone: "dark" }),
  });
  assert.equal(hero.response.status, 200);
  assert.equal(hero.body.hero.id, "test-hero");

  const category = await request("/api/admin/categories", {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ id: "test-category", name: "Test category", description: "Test category record", image: "https://example.com/category.jpg", visible: true, position: 3, navigation: true, colorFilterVisible: true }),
  });
  assert.equal(category.response.status, 200);
  const collection = await request("/api/admin/collections", {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ id: "test-collection", name: "Test collection", description: "Test collection record", image: "https://example.com/collection.jpg", visible: true, position: 3, productIds: [] }),
  });
  assert.equal(collection.response.status, 200);

  const product = await request("/api/admin/products", {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ id: "test-product", name: "Test product", categoryId: "test-category", navigationCategory: "test-category", sku: "KDB-TEST-02", material: "Wool", description: "A valid KDB test product.", price: 5000, stock: 3, status: "draft", position: 3, image: "https://example.com/product.jpg", variants: [{ id: "test-product-standard", name: "Standard", sku: "KDB-TEST-02", price: 5000, stock: 3, available: true }], gallery: ["https://example.com/product.jpg"], colors: [], attributes: [], collectionIds: ["test-collection"], tags: ["test"] }),
  });
  assert.equal(product.response.status, 200);
  assert.equal(product.body.product.variants[0].sku, "KDB-TEST-02");

  const team = await request("/api/admin/team", {
    method: "PUT", headers: adminHeaders, body: JSON.stringify({ id: "test-team", name: "Test operator", role: "Operations", phone: "0555111111", active: true }),
  });
  assert.equal(team.response.status, 200);
  assert.equal(team.body.member.role, "Operations");

  const bulk = await request("/api/admin/delivery/bulk", {
    method: "PUT", headers: adminHeaders, body: JSON.stringify({ mode: "stop_desk", delta: 25, enabledOnly: true }),
  });
  assert.equal(bulk.response.status, 200);
  assert.equal(bulk.body.deliveryRules[0].stopDeskFee, 25);
  const reset = await request("/api/admin/delivery/reset", { method: "POST", headers: adminHeaders, body: "{}" });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.body.deliveryRules[0].stopDeskFee, 0);

  const backup = await request("/api/admin/backup", { headers: adminHeaders });
  assert.equal(backup.response.status, 200);
  assert.equal(backup.body.store.schemaVersion, 2);
  const restore = await request("/api/admin/restore", { method: "PUT", headers: adminHeaders, body: JSON.stringify({ store: backup.body.store }) });
  assert.equal(restore.response.status, 200);

  for (const [kind, id] of [["heroes", "test-hero"], ["products", "test-product"], ["categories", "test-category"], ["collections", "test-collection"], ["media", "test-media"], ["team", "test-team"]]) {
    const removed = await request(`/api/admin/${kind}/${id}`, { method: "DELETE", headers: adminHeaders });
    assert.equal(removed.response.status, 200);
  }
});
