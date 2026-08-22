/**
 * ADR: KDB owner-controlled HTTP API
 *
 * Problem: the public KDB room and the owner control room need the same source
 * of truth while keeping customers away from private operations and data tools.
 * Decision: expose a small REST boundary with public discovery/order routes and
 * explicit owner-token routes for each bounded operational domain.
 * Consequence: storage is replaceable, business validation is centralized, and
 * no browser client receives private order, backup, or configuration payloads.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAnalytics,
  OrderValidationError,
  validateCart,
  validateDeliveryRule,
  validateHeroSlide,
  validateMedia,
  validateNamedRecord,
  validateOrderInput,
  validateOrderStatus,
  validateProductInput,
  validateSettingsPatch,
} from "./domain.mjs";
import { deliveryBaseline, getStore, persist, recordActivity, replaceStore, snapshot } from "./store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4175);
const adminToken = process.env.ADMIN_TOKEN || "kdb-local-admin";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };

function json(response, code, payload) {
  response.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new OrderValidationError("Request body is too large.");
  }
  try { return JSON.parse(raw || "{}"); } catch { throw new OrderValidationError("Invalid request body."); }
}

function isAdmin(request) {
  return request.headers["x-kdb-admin-token"] === adminToken;
}

function pathParts(pathname) {
  return pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function itemById(records, id) {
  return records.find((item) => item.id === id) ?? null;
}

async function serveStatic(request, response, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(path.join(root, "public", requestPath));
  if (!safePath.startsWith(path.join(root, "public"))) return json(response, 403, { error: "Forbidden" });
  try {
    const data = await readFile(safePath);
    response.writeHead(200, { "content-type": mime[path.extname(safePath).toLowerCase()] || "application/octet-stream" });
    response.end(data);
  } catch { json(response, 404, { error: "Not found" }); }
}

function mergeSettings(store, patch) {
  store.settings = {
    ...store.settings,
    ...patch,
    identity: { ...store.settings.identity, ...patch.identity },
    presentation: { ...store.settings.presentation, ...patch.presentation },
    catalog: { ...store.settings.catalog, ...patch.catalog },
    delivery: { ...store.settings.delivery, ...patch.delivery },
    marketing: { ...store.settings.marketing, ...patch.marketing },
    seo: { ...store.settings.seo, ...patch.seo },
  };
  return store.settings;
}

function normalizeOrderNotes(value) {
  return String(value ?? "").trim().slice(0, 2000);
}

async function upsertRecord(store, collection, input, validator, label) {
  const records = store[collection];
  const existing = input.id ? itemById(records, String(input.id)) : null;
  const record = validator(input, existing || {});
  const index = records.findIndex((item) => item.id === record.id);
  if (index >= 0) records[index] = record; else records.unshift(record);
  await recordActivity(`${collection}.saved`, `${label}: ${record.name || record.title || record.id}`);
  await persist();
  return record;
}

async function deleteRecord(store, collection, id, label) {
  const index = store[collection].findIndex((item) => item.id === id);
  if (index < 0) throw new OrderValidationError(`${label} was not found.`);
  const [removed] = store[collection].splice(index, 1);
  await recordActivity(`${collection}.deleted`, `${label}: ${removed.name || removed.id}`);
  await persist();
  return removed;
}

async function createOrder(input) {
  const store = await getStore();
  if (!store.settings.storeOpen) throw new OrderValidationError("KDB is not accepting COD orders at the moment.");
  const delivery = validateOrderInput(input);
  const lines = validateCart(input.lines, store.products);
  const rule = store.deliveryRules.find((item) => item.code === delivery.wilayaCode);
  if (!rule?.enabled) throw new OrderValidationError("Delivery is not available for the selected wilaya.");
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const deliveryFee = rule.free || (store.settings.delivery.freeDeliveryThreshold > 0 && subtotal >= store.settings.delivery.freeDeliveryThreshold) ? 0 : (delivery.deliveryType === "domicile" ? rule.domicileFee : rule.stopDeskFee);
  for (const line of lines) {
    const product = store.products.find((item) => item.id === line.productId);
    const variant = product.variants.find((item) => item.id === line.variantId);
    variant.stock -= line.quantity;
    product.stock = product.variants.reduce((sum, item) => sum + item.stock, 0);
    product.updatedAt = new Date().toISOString();
  }
  const order = {
    id: `KDB-${String(store.orders.length + 1).padStart(4, "0")}`,
    ...delivery,
    lines,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    status: "requested",
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.orders.unshift(order);
  await recordActivity("order.created", `${order.id} / ${order.wilayaCode} / ${order.deliveryType}`);
  await persist();
  return order;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const parts = pathParts(pathname);

    if (request.method === "GET" && pathname === "/api/store") return json(response, 200, await snapshot(true));
    if (request.method === "GET" && parts[0] === "api" && parts[1] === "products" && parts[2]) {
      const store = await snapshot(true);
      const product = itemById(store.products, parts[2]);
      return product ? json(response, 200, { product }) : json(response, 404, { error: "Product not found." });
    }
    if (request.method === "POST" && pathname === "/api/orders") return json(response, 201, { order: await createOrder(await body(request)) });
    if (request.method === "POST" && pathname === "/api/admin/session") {
      const input = await body(request);
      if (input.token !== adminToken) return json(response, 401, { error: "Administration access was not accepted." });
      return json(response, 200, { ok: true, role: "owner" });
    }

    if (!pathname.startsWith("/api/admin")) return serveStatic(request, response, pathname);
    if (!isAdmin(request)) return json(response, 401, { error: "Administration access is required." });
    const store = await getStore();

    if (request.method === "GET" && pathname === "/api/admin/store") return json(response, 200, await snapshot(false));
    if (request.method === "GET" && pathname === "/api/admin/analytics") return json(response, 200, { analytics: buildAnalytics(store) });
    if (request.method === "GET" && pathname === "/api/admin/backup") return json(response, 200, { exportedAt: new Date().toISOString(), schemaVersion: store.schemaVersion, store: await snapshot(false) });
    if (request.method === "PUT" && pathname === "/api/admin/restore") {
      const input = await body(request);
      if (!input.store || typeof input.store !== "object") throw new OrderValidationError("A valid KDB backup is required.");
      const restored = await replaceStore(input.store);
      await recordActivity("backup.restored", "KDB data backup restored.");
      await persist();
      return json(response, 200, { store: restored });
    }
    if (request.method === "PUT" && pathname === "/api/admin/settings") {
      const settings = mergeSettings(store, validateSettingsPatch(await body(request)));
      await recordActivity("settings.updated", "Store settings were saved.");
      await persist();
      return json(response, 200, { settings });
    }
    if (request.method === "PUT" && pathname === "/api/admin/content") {
      const input = await body(request);
      const content = input && typeof input === "object" ? input : {};
      store.content = {
        ...store.content,
        about: { ...store.content.about, ...(content.about || {}) },
        projects: Array.isArray(content.projects) ? content.projects.slice(0, 100) : store.content.projects,
        statistics: Array.isArray(content.statistics) ? content.statistics.slice(0, 40) : store.content.statistics,
        certifications: Array.isArray(content.certifications) ? content.certifications.slice(0, 40) : store.content.certifications,
        sectionVisibility: { ...store.content.sectionVisibility, ...(content.sectionVisibility || {}) },
      };
      await recordActivity("content.updated", "Public content controls were saved.");
      await persist();
      return json(response, 200, { content: store.content });
    }
    if (request.method === "PUT" && pathname === "/api/admin/heroes") {
      const input = await body(request);
      const existing = input.id ? itemById(store.content.heroSlides, String(input.id)) : null;
      const hero = validateHeroSlide(input, existing || {});
      const index = store.content.heroSlides.findIndex((item) => item.id === hero.id);
      if (index >= 0) store.content.heroSlides[index] = hero; else store.content.heroSlides.push(hero);
      store.content.heroSlides.sort((a, b) => a.sortOrder - b.sortOrder);
      await recordActivity("hero.saved", `Hero slide: ${hero.title}`);
      await persist();
      return json(response, 200, { hero });
    }
    if (request.method === "DELETE" && parts[2] === "heroes" && parts[3]) {
      const index = store.content.heroSlides.findIndex((item) => item.id === parts[3]);
      if (index < 0) throw new OrderValidationError("Hero slide was not found.");
      if (store.content.heroSlides.length <= 1) throw new OrderValidationError("KDB needs at least one hero slide.");
      const [hero] = store.content.heroSlides.splice(index, 1);
      await recordActivity("hero.deleted", `Hero slide: ${hero.title}`);
      await persist();
      return json(response, 200, { ok: true });
    }
    if (request.method === "PUT" && pathname === "/api/admin/products") return json(response, 200, { product: await upsertRecord(store, "products", await body(request), validateProductInput, "Product") });
    if (request.method === "DELETE" && parts[2] === "products" && parts[3]) return json(response, 200, { product: await deleteRecord(store, "products", parts[3], "Product") });
    if (request.method === "PUT" && pathname === "/api/admin/categories") {
      const input = await body(request);
      const category = await upsertRecord(store, "categories", input, (record, existing) => ({ ...validateNamedRecord(record, "Category", existing), parentId: record.parentId || null, navigation: record.navigation !== false, colorFilterVisible: record.colorFilterVisible !== false }), "Category");
      return json(response, 200, { category });
    }
    if (request.method === "DELETE" && parts[2] === "categories" && parts[3]) return json(response, 200, { category: await deleteRecord(store, "categories", parts[3], "Category") });
    if (request.method === "PUT" && pathname === "/api/admin/collections") {
      const input = await body(request);
      const collection = await upsertRecord(store, "collections", input, (record, existing) => ({ ...validateNamedRecord(record, "Collection", existing), productIds: Array.isArray(record.productIds) ? record.productIds.slice(0, 100).map(String) : (existing.productIds || []) }), "Collection");
      return json(response, 200, { collection });
    }
    if (request.method === "DELETE" && parts[2] === "collections" && parts[3]) return json(response, 200, { collection: await deleteRecord(store, "collections", parts[3], "Collection") });
    if (request.method === "PUT" && pathname === "/api/admin/media") return json(response, 200, { media: await upsertRecord(store, "media", await body(request), validateMedia, "Media asset") });
    if (request.method === "DELETE" && parts[2] === "media" && parts[3]) return json(response, 200, { media: await deleteRecord(store, "media", parts[3], "Media asset") });
    if (request.method === "PUT" && pathname === "/api/admin/team") {
      const input = await body(request);
      const member = await upsertRecord(store, "team", input, (record, existing) => ({ ...existing, id: String(record.id || existing.id || crypto.randomUUID()), name: String(record.name || "").trim().slice(0, 160), role: String(record.role || "Operator").trim().slice(0, 120), phone: String(record.phone || "").trim().slice(0, 40), active: record.active !== false, createdAt: existing.createdAt || new Date().toISOString() }), "Team directory entry");
      return json(response, 200, { member });
    }
    if (request.method === "DELETE" && parts[2] === "team" && parts[3]) return json(response, 200, { member: await deleteRecord(store, "team", parts[3], "Team member") });
    if (request.method === "PATCH" && parts[2] === "orders" && parts[3]) {
      const input = await body(request);
      const order = itemById(store.orders, parts[3]);
      if (!order) throw new OrderValidationError("Order was not found.");
      if (input.status !== undefined) order.status = validateOrderStatus(input.status);
      if (input.notes !== undefined) order.notes = normalizeOrderNotes(input.notes);
      order.updatedAt = new Date().toISOString();
      await recordActivity("order.updated", `${order.id} → ${order.status}`);
      await persist();
      return json(response, 200, { order });
    }
    if (request.method === "PATCH" && parts[2] === "delivery" && parts[3]) {
      const input = await body(request);
      const existing = store.deliveryRules.find((rule) => rule.code === parts[3]);
      const rule = validateDeliveryRule({ ...input, code: parts[3] }, existing);
      store.deliveryRules[store.deliveryRules.findIndex((item) => item.code === rule.code)] = rule;
      await recordActivity("delivery.updated", `${rule.code} delivery rule updated`);
      await persist();
      return json(response, 200, { rule });
    }
    if (request.method === "PUT" && pathname === "/api/admin/delivery/bulk") {
      const input = await body(request);
      const delta = Number(input.delta);
      if (!Number.isFinite(delta) || Math.abs(delta) > 1_000_000) throw new OrderValidationError("Bulk delivery amount is invalid.");
      const mode = input.mode === "domicile" ? "domicile" : "stop_desk";
      const enabledOnly = Boolean(input.enabledOnly);
      for (const rule of store.deliveryRules) if (!enabledOnly || rule.enabled) rule[mode === "domicile" ? "domicileFee" : "stopDeskFee"] = Math.max(0, rule[mode === "domicile" ? "domicileFee" : "stopDeskFee"] + Math.round(delta));
      await recordActivity("delivery.bulk_updated", `${mode} fees adjusted by ${Math.round(delta)} DA`);
      await persist();
      return json(response, 200, { deliveryRules: store.deliveryRules });
    }
    if (request.method === "POST" && pathname === "/api/admin/delivery/reset") {
      store.deliveryRules = deliveryBaseline();
      await recordActivity("delivery.reset", "All delivery rules reset to baseline.");
      await persist();
      return json(response, 200, { deliveryRules: store.deliveryRules });
    }
    return json(response, 404, { error: "Administrative route not found." });
  } catch (error) {
    const status = error instanceof OrderValidationError ? 422 : 500;
    console.error("[KDB]", error);
    return json(response, status, { error: error.message || "Unexpected server error." });
  }
});

server.listen(port, () => console.log(`KDB H.B running on http://localhost:${port}`));
