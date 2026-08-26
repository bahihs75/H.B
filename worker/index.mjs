/**
 * ADR: KDB Cloudflare production API
 *
 * The Worker keeps all public and owner routes at the same paths used by the
 * KDB interface. Domain validation remains server-side; Firestore secrets and
 * owner token verification never enter browser assets.
 */
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
} from "../server/domain.mjs";
import { WILAYAS } from "../server/algeria-data.mjs";
import { createKdbFirestoreRepository } from "./store.mjs";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-kdb-admin-token", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" };
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors } });
const route = (pathname) => pathname.split("/").filter(Boolean).map(decodeURIComponent);
const byId = (records, id) => (records || []).find((record) => record.id === id) ?? null;
const deliveryBaseline = () => WILAYAS.map((wilaya) => ({ code: wilaya.code, name: wilaya.ar, stopDeskFee: 0, domicileFee: 0, enabled: true, free: false }));

async function body(request) {
  const raw = await request.text();
  if (raw.length > 1_000_000) throw new OrderValidationError("Request body is too large.");
  try { return JSON.parse(raw || "{}"); } catch { throw new OrderValidationError("Invalid request body."); }
}

function authorized(request, env) {
  const configured = String(env.KDB_ADMIN_TOKEN || "");
  return Boolean(configured) && request.headers.get("x-kdb-admin-token") === configured;
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

async function recordActivity(repository, type, detail, actor = "owner") {
  await repository.recordActivity(type, detail, actor);
}

async function saveRecord(repository, store, collection, input, validator, label) {
  const records = store[collection] || (store[collection] = []);
  const existing = input.id ? byId(records, String(input.id)) : null;
  const record = validator(input, existing || {});
  const index = records.findIndex((item) => item.id === record.id);
  if (index >= 0) records[index] = record; else records.unshift(record);
  await recordActivity(repository, `${collection}.saved`, `${label}: ${record.name || record.title || record.id}`);
  await repository.persist();
  return record;
}

async function removeRecord(repository, store, collection, id, label) {
  const records = store[collection] || [];
  const index = records.findIndex((item) => item.id === id);
  if (index < 0) throw new OrderValidationError(`${label} was not found.`);
  const [record] = records.splice(index, 1);
  await recordActivity(repository, `${collection}.deleted`, `${label}: ${record.name || record.id}`);
  await repository.persist();
  return record;
}

async function createOrder(repository, input) {
  const store = await repository.getStore();
  if (!store.settings?.storeOpen) throw new OrderValidationError("KDB is not accepting COD orders at the moment.");
  const delivery = validateOrderInput(input);
  const lines = validateCart(input.lines, store.products || []);
  const rule = (store.deliveryRules || []).find((item) => item.code === delivery.wilayaCode);
  if (!rule?.enabled) throw new OrderValidationError("Delivery is not available for the selected wilaya.");
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const threshold = Number(store.settings?.delivery?.freeDeliveryThreshold || 0);
  const deliveryFee = rule.free || (threshold > 0 && subtotal >= threshold) ? 0 : (delivery.deliveryType === "domicile" ? rule.domicileFee : rule.stopDeskFee);
  for (const line of lines) {
    const product = byId(store.products, line.productId);
    const variant = product?.variants?.find((item) => item.id === line.variantId);
    if (!product || !variant) throw new OrderValidationError("One product is no longer available.");
    variant.stock -= line.quantity;
    product.stock = product.variants.reduce((sum, item) => sum + item.stock, 0);
    product.updatedAt = new Date().toISOString();
  }
  const order = { id: `KDB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, ...delivery, lines, subtotal, deliveryFee, total: subtotal + deliveryFee, status: "requested", notes: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  store.orders.unshift(order);
  await recordActivity(repository, "order.created", `${order.id} / ${order.wilayaCode} / ${order.deliveryType}`, "storefront");
  await repository.persist();
  return order;
}

async function ownerRoute(request, env, repository, pathname, parts) {
  if (pathname === "/api/admin/session" && request.method === "POST") {
    const input = await body(request);
    return input.token === env.KDB_ADMIN_TOKEN ? json({ ok: true, role: "owner" }) : json({ error: "Administration access was not accepted." }, 401);
  }
  if (!authorized(request, env)) return json({ error: "Administration access is required." }, 401);
  const store = await repository.getStore();
  if (request.method === "GET" && pathname === "/api/admin/store") return json(await repository.snapshot(false));
  if (request.method === "GET" && pathname === "/api/admin/analytics") return json({ analytics: buildAnalytics(store) });
  if (request.method === "GET" && pathname === "/api/admin/backup") return json({ exportedAt: new Date().toISOString(), schemaVersion: store.schemaVersion, store: await repository.snapshot(false) });
  if (request.method === "PUT" && pathname === "/api/admin/restore") {
    const input = await body(request);
    if (!input.store || typeof input.store !== "object") throw new OrderValidationError("A valid KDB backup is required.");
    const restored = await repository.replaceStore(input.store);
    await recordActivity(repository, "backup.restored", "KDB data backup restored.");
    await repository.persist();
    return json({ store: restored });
  }
  if (request.method === "PUT" && pathname === "/api/admin/settings") {
    const settings = mergeSettings(store, validateSettingsPatch(await body(request)));
    await recordActivity(repository, "settings.updated", "Store settings were saved.");
    await repository.persist();
    return json({ settings });
  }
  if (request.method === "PUT" && pathname === "/api/admin/content") {
    const input = await body(request);
    store.content = { ...store.content, about: { ...store.content.about, ...(input.about || {}) }, projects: Array.isArray(input.projects) ? input.projects.slice(0, 100) : store.content.projects, statistics: Array.isArray(input.statistics) ? input.statistics.slice(0, 40) : store.content.statistics, certifications: Array.isArray(input.certifications) ? input.certifications.slice(0, 40) : store.content.certifications, sectionVisibility: { ...store.content.sectionVisibility, ...(input.sectionVisibility || {}) } };
    await recordActivity(repository, "content.updated", "Public content controls were saved.");
    await repository.persist();
    return json({ content: store.content });
  }
  if (request.method === "PUT" && pathname === "/api/admin/heroes") {
    const input = await body(request);
    const current = input.id ? byId(store.content.heroSlides, String(input.id)) : null;
    const hero = validateHeroSlide(input, current || {});
    const index = store.content.heroSlides.findIndex((item) => item.id === hero.id);
    if (index >= 0) store.content.heroSlides[index] = hero; else store.content.heroSlides.push(hero);
    store.content.heroSlides.sort((a, b) => a.sortOrder - b.sortOrder);
    await recordActivity(repository, "hero.saved", `Hero slide: ${hero.title}`);
    await repository.persist();
    return json({ hero });
  }
  if (request.method === "DELETE" && parts[2] === "heroes" && parts[3]) {
    const index = store.content.heroSlides.findIndex((item) => item.id === parts[3]);
    if (index < 0) throw new OrderValidationError("Hero slide was not found.");
    if (store.content.heroSlides.length <= 1) throw new OrderValidationError("KDB needs at least one hero slide.");
    const [hero] = store.content.heroSlides.splice(index, 1);
    await recordActivity(repository, "hero.deleted", `Hero slide: ${hero.title}`);
    await repository.persist();
    return json({ ok: true });
  }
  if (request.method === "PUT" && pathname === "/api/admin/products") return json({ product: await saveRecord(repository, store, "products", await body(request), validateProductInput, "Product") });
  if (request.method === "DELETE" && parts[2] === "products" && parts[3]) return json({ product: await removeRecord(repository, store, "products", parts[3], "Product") });
  if (request.method === "PUT" && pathname === "/api/admin/categories") return json({ category: await saveRecord(repository, store, "categories", await body(request), (record, existing) => ({ ...validateNamedRecord(record, "Category", existing), parentId: record.parentId || null, navigation: record.navigation !== false, colorFilterVisible: record.colorFilterVisible !== false }), "Category") });
  if (request.method === "DELETE" && parts[2] === "categories" && parts[3]) return json({ category: await removeRecord(repository, store, "categories", parts[3], "Category") });
  if (request.method === "PUT" && pathname === "/api/admin/collections") return json({ collection: await saveRecord(repository, store, "collections", await body(request), (record, existing) => ({ ...validateNamedRecord(record, "Collection", existing), productIds: Array.isArray(record.productIds) ? record.productIds.slice(0, 100).map(String) : (existing.productIds || []) }), "Collection") });
  if (request.method === "DELETE" && parts[2] === "collections" && parts[3]) return json({ collection: await removeRecord(repository, store, "collections", parts[3], "Collection") });
  if (request.method === "PUT" && pathname === "/api/admin/media") return json({ media: await saveRecord(repository, store, "media", await body(request), validateMedia, "Media asset") });
  if (request.method === "DELETE" && parts[2] === "media" && parts[3]) return json({ media: await removeRecord(repository, store, "media", parts[3], "Media asset") });
  if (request.method === "PUT" && pathname === "/api/admin/team") return json({ member: await saveRecord(repository, store, "team", await body(request), (record, existing) => ({ ...existing, id: String(record.id || existing.id || crypto.randomUUID()), name: String(record.name || "").trim().slice(0, 160), role: String(record.role || "Operator").trim().slice(0, 120), phone: String(record.phone || "").trim().slice(0, 40), active: record.active !== false, createdAt: existing.createdAt || new Date().toISOString() }), "Team directory entry") });
  if (request.method === "DELETE" && parts[2] === "team" && parts[3]) return json({ member: await removeRecord(repository, store, "team", parts[3], "Team member") });
  if (request.method === "PATCH" && parts[2] === "orders" && parts[3]) {
    const input = await body(request);
    const order = byId(store.orders, parts[3]);
    if (!order) throw new OrderValidationError("Order was not found.");
    if (input.status !== undefined) order.status = validateOrderStatus(input.status);
    if (input.notes !== undefined) order.notes = String(input.notes || "").trim().slice(0, 2000);
    order.updatedAt = new Date().toISOString();
    await recordActivity(repository, "order.updated", `${order.id} → ${order.status}`);
    await repository.persist();
    return json({ order });
  }
  if (request.method === "PATCH" && parts[2] === "delivery" && parts[3]) {
    const input = await body(request);
    const index = store.deliveryRules.findIndex((item) => item.code === parts[3]);
    const rule = validateDeliveryRule({ ...input, code: parts[3] }, store.deliveryRules[index]);
    store.deliveryRules[index] = rule;
    await recordActivity(repository, "delivery.updated", `${rule.code} delivery rule updated.`);
    await repository.persist();
    return json({ rule });
  }
  if (request.method === "PUT" && pathname === "/api/admin/delivery/bulk") {
    const input = await body(request);
    const delta = Number(input.delta);
    if (!Number.isFinite(delta) || Math.abs(delta) > 1_000_000) throw new OrderValidationError("Bulk delivery amount is invalid.");
    const mode = input.mode === "domicile" ? "domicile" : "stop_desk";
    for (const rule of store.deliveryRules) if (!input.enabledOnly || rule.enabled) rule[mode === "domicile" ? "domicileFee" : "stopDeskFee"] = Math.max(0, rule[mode === "domicile" ? "domicileFee" : "stopDeskFee"] + Math.round(delta));
    await recordActivity(repository, "delivery.bulk_updated", `${mode} fees adjusted by ${Math.round(delta)} DA`);
    await repository.persist();
    return json({ deliveryRules: store.deliveryRules });
  }
  if (request.method === "POST" && pathname === "/api/admin/delivery/reset") {
    store.deliveryRules = deliveryBaseline();
    await recordActivity(repository, "delivery.reset", "All delivery rules reset to baseline.");
    await repository.persist();
    return json({ deliveryRules: store.deliveryRules });
  }
  return json({ error: "Administrative route not found." }, 404);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      const repository = createKdbFirestoreRepository(env);
      const parts = route(url.pathname);
      if (request.method === "GET" && url.pathname === "/api/store") return json(await repository.snapshot(true));
      if (request.method === "GET" && parts[0] === "api" && parts[1] === "products" && parts[2]) {
        const store = await repository.snapshot(true);
        const product = byId(store.products, parts[2]);
        return product ? json({ product }) : json({ error: "Product not found." }, 404);
      }
      if (request.method === "POST" && url.pathname === "/api/orders") return json({ order: await createOrder(repository, await body(request)) }, 201);
      return ownerRoute(request, env, repository, url.pathname, parts);
    } catch (error) {
      const status = error instanceof OrderValidationError ? 422 : error?.status || 500;
      console.error("[KDB worker]", error);
      return json({ error: error?.message || "Unexpected server error." }, status);
    }
  },
};
