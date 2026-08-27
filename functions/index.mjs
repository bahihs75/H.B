/**
 * KDB production function boundary.
 *
 * Cloudflare Pages serves the static UI. These callable Firebase Functions are
 * the only privileged layer: they recalculate COD orders from Firestore and
 * allow owner mutations only for an authenticated user with owner=true.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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

initializeApp();
const db = getFirestore();
const CONFIG = db.collection("kdb_config").doc("current");
const collections = { products: "kdb_products", categories: "kdb_categories", collections: "kdb_collections", attributes: "kdb_attributes", media: "kdb_media", team: "kdb_team", orders: "kdb_orders", deliveryRules: "kdb_delivery_rules", activity: "kdb_activity" };
const recordKeys = Object.keys(collections);
const item = (records, id) => (records || []).find((record) => record.id === id) || null;
const now = () => new Date().toISOString();
const orderId = () => `KDB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const baselineDelivery = () => WILAYAS.map((wilaya) => ({ code: wilaya.code, name: wilaya.ar, stopDeskFee: 0, domicileFee: 0, enabled: true, free: false }));

function domainError(error) {
  if (error instanceof OrderValidationError) return new HttpsError("invalid-argument", error.message);
  if (error instanceof HttpsError) return error;
  console.error("[KDB functions]", error);
  return new HttpsError("internal", "KDB could not complete this request.");
}

function assertOwner(request) {
  if (!request.auth?.token?.owner) throw new HttpsError("permission-denied", "Owner access is required.");
  return request.auth.uid;
}

async function loadStore() {
  const [config, ...snapshots] = await Promise.all([CONFIG.get(), ...Object.values(collections).map((name) => db.collection(name).get())]);
  if (!config.exists) throw new HttpsError("failed-precondition", "KDB is not initialized in Firestore.");
  const records = Object.fromEntries(recordKeys.map((key, index) => [key, snapshots[index].docs.map((document) => ({ id: document.id, ...document.data() }))]));
  return { schemaVersion: Number(config.data().schemaVersion || 3), settings: config.data().settings || {}, content: config.data().content || {}, ...records };
}

async function replaceStore(store) {
  const batch = db.batch();
  batch.set(CONFIG, { schemaVersion: 3, settings: store.settings || {}, content: store.content || {} });
  for (const key of recordKeys) {
    const collection = db.collection(collections[key]);
    const existing = await collection.get();
    const incoming = new Map((store[key] || []).map((record) => [String(record.id), record]));
    existing.docs.filter((document) => !incoming.has(document.id)).forEach((document) => batch.delete(document.ref));
    for (const [id, record] of incoming) {
      const { id: ignored, ...fields } = record;
      batch.set(collection.doc(id), fields);
    }
  }
  await batch.commit();
  return loadStore();
}

function recordActivity(store, type, detail, actor = "owner") {
  store.activity = Array.isArray(store.activity) ? store.activity : [];
  store.activity.unshift({ id: crypto.randomUUID(), type: String(type).slice(0, 120), detail: String(detail).slice(0, 500), actor: String(actor).slice(0, 80), createdAt: now() });
  store.activity = store.activity.slice(0, 150);
}

function publicStore(store) {
  const isLive = (product) => product.status === "published" && product.visible !== false && product.discoveryEnabled !== false && (!product.publishAt || new Date(product.publishAt) <= new Date()) && (!product.unpublishAt || new Date(product.unpublishAt) > new Date());
  const showStock = store.settings?.catalog?.showStockCount;
  return {
    settings: store.settings,
    content: { ...store.content, heroSlides: (store.content?.heroSlides || []).filter((slide) => slide.enabled).sort((a, b) => a.sortOrder - b.sortOrder), projects: (store.content?.projects || []).filter((project) => project.visible !== false), certifications: (store.content?.certifications || []).filter((entry) => entry.visible !== false) },
    categories: (store.categories || []).filter((entry) => entry.visible !== false),
    collections: (store.collections || []).filter((entry) => entry.visible !== false),
    products: (store.products || []).filter(isLive).map((product) => ({ ...product, stock: showStock ? product.stock : undefined, variants: (product.variants || []).map((variant) => ({ ...variant, stock: showStock ? variant.stock : undefined })) })),
  };
}

function mergeSettings(store, patch) {
  store.settings = { ...store.settings, ...patch, identity: { ...store.settings.identity, ...patch.identity }, presentation: { ...store.settings.presentation, ...patch.presentation }, catalog: { ...store.settings.catalog, ...patch.catalog }, delivery: { ...store.settings.delivery, ...patch.delivery }, marketing: { ...store.settings.marketing, ...patch.marketing }, seo: { ...store.settings.seo, ...patch.seo } };
  return store.settings;
}

function saveRecord(store, collection, input, validate, label) {
  const records = store[collection] || (store[collection] = []);
  const existing = input.id ? item(records, String(input.id)) : null;
  const record = validate(input, existing || {});
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) records[index] = record; else records.unshift(record);
  recordActivity(store, `${collection}.saved`, `${label}: ${record.name || record.title || record.id}`);
  return record;
}

function deleteRecord(store, collection, id, label) {
  const records = store[collection] || [];
  const index = records.findIndex((entry) => entry.id === id);
  if (index < 0) throw new OrderValidationError(`${label} was not found.`);
  const [record] = records.splice(index, 1);
  recordActivity(store, `${collection}.deleted`, `${label}: ${record.name || record.id}`);
  return record;
}

export const getPublicStore = onCall({ cors: true }, async () => {
  try { return { store: publicStore(await loadStore()) }; } catch (error) { throw domainError(error); }
});

export const createCodOrder = onCall({ cors: true }, async (request) => {
  try {
    const input = request.data || {};
    const delivery = validateOrderInput(input);
    const selectedLines = Array.isArray(input.lines) ? input.lines : [];
    const productIds = [...new Set(selectedLines.map((line) => String(line.productId)).filter(Boolean))];
    if (!productIds.length) throw new OrderValidationError("Your bag is empty.");
    const result = await db.runTransaction(async (transaction) => {
      const config = await transaction.get(CONFIG);
      if (!config.exists || !config.data().settings?.storeOpen) throw new OrderValidationError("KDB is not accepting COD orders at the moment.");
      const ruleRef = db.collection(collections.deliveryRules).doc(delivery.wilayaCode);
      const [ruleDocument, ...productDocuments] = await Promise.all([transaction.get(ruleRef), ...productIds.map((id) => transaction.get(db.collection(collections.products).doc(id)))]);
      const products = productDocuments.filter((document) => document.exists).map((document) => ({ id: document.id, ...document.data() }));
      const lines = validateCart(selectedLines, products);
      const rule = ruleDocument.exists ? { code: ruleDocument.id, ...ruleDocument.data() } : null;
      if (!rule?.enabled) throw new OrderValidationError("Delivery is not available for the selected wilaya.");
      const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
      const freeThreshold = Number(config.data().settings?.delivery?.freeDeliveryThreshold || 0);
      const deliveryFee = rule.free || (freeThreshold > 0 && subtotal >= freeThreshold) ? 0 : (delivery.deliveryType === "domicile" ? Number(rule.domicileFee || 0) : Number(rule.stopDeskFee || 0));
      for (const line of lines) {
        const source = products.find((product) => product.id === line.productId);
        const variants = (source.variants || []).map((variant) => variant.id === line.variantId ? { ...variant, stock: Number(variant.stock) - line.quantity } : variant);
        transaction.update(db.collection(collections.products).doc(source.id), { variants, stock: variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0), updatedAt: now() });
      }
      const order = { id: orderId(), ...delivery, lines, subtotal, deliveryFee, total: subtotal + deliveryFee, status: "requested", notes: "", createdAt: now(), updatedAt: now() };
      const { id: storedOrderId, ...storedOrder } = order;
      transaction.create(db.collection(collections.orders).doc(storedOrderId), storedOrder);
      transaction.create(db.collection(collections.activity).doc(crypto.randomUUID()), { type: "order.created", detail: `${order.id} / ${order.wilayaCode} / ${order.deliveryType}`, actor: "storefront", createdAt: now() });
      return order;
    });
    return { order: result };
  } catch (error) { throw domainError(error); }
});

export const ownerApi = onCall({ cors: true }, async (request) => {
  try {
    const ownerId = assertOwner(request);
    const { path, method = "GET", payload = {} } = request.data || {};
    const store = await loadStore();
    if (method === "GET" && path === "/api/admin/store") return { store };
    if (method === "GET" && path === "/api/admin/analytics") return { analytics: buildAnalytics(store) };
    if (method === "GET" && path === "/api/admin/backup") return { exportedAt: now(), schemaVersion: store.schemaVersion, store };
    if (method === "PUT" && path === "/api/admin/restore") {
      if (!payload.store || typeof payload.store !== "object") throw new OrderValidationError("A valid KDB backup is required.");
      const saved = await replaceStore(payload.store); recordActivity(saved, "backup.restored", "KDB data backup restored.", ownerId); await replaceStore(saved); return { store: saved };
    }
    if (method === "PUT" && path === "/api/admin/settings") { const settings = mergeSettings(store, validateSettingsPatch(payload)); recordActivity(store, "settings.updated", "Store settings were saved.", ownerId); await replaceStore(store); return { settings }; }
    if (method === "PUT" && path === "/api/admin/content") { store.content = { ...store.content, about: { ...store.content.about, ...(payload.about || {}) }, projects: Array.isArray(payload.projects) ? payload.projects.slice(0, 100) : store.content.projects, statistics: Array.isArray(payload.statistics) ? payload.statistics.slice(0, 40) : store.content.statistics, certifications: Array.isArray(payload.certifications) ? payload.certifications.slice(0, 40) : store.content.certifications, sectionVisibility: { ...store.content.sectionVisibility, ...(payload.sectionVisibility || {}) } }; recordActivity(store, "content.updated", "Public content controls were saved.", ownerId); await replaceStore(store); return { content: store.content }; }
    if (method === "PUT" && path === "/api/admin/heroes") { const existing = payload.id ? item(store.content.heroSlides, String(payload.id)) : null; const hero = validateHeroSlide(payload, existing || {}); const index = store.content.heroSlides.findIndex((entry) => entry.id === hero.id); if (index >= 0) store.content.heroSlides[index] = hero; else store.content.heroSlides.push(hero); store.content.heroSlides.sort((a, b) => a.sortOrder - b.sortOrder); recordActivity(store, "hero.saved", `Hero slide: ${hero.title}`, ownerId); await replaceStore(store); return { hero }; }
    if (method === "DELETE" && path.startsWith("/api/admin/heroes/")) { const id = decodeURIComponent(path.split("/").at(-1)); const index = store.content.heroSlides.findIndex((entry) => entry.id === id); if (index < 0) throw new OrderValidationError("Hero slide was not found."); if (store.content.heroSlides.length <= 1) throw new OrderValidationError("KDB needs at least one hero slide."); store.content.heroSlides.splice(index, 1); recordActivity(store, "hero.deleted", `Hero slide: ${id}`, ownerId); await replaceStore(store); return { ok: true }; }
    const match = path.match(/^\/api\/admin\/(products|categories|collections|media|team)(?:\/([^/]+))?$/);
    if (match) {
      const [, entity, encodedId] = match;
      if (method === "DELETE" && encodedId) return { record: deleteRecord(store, entity, decodeURIComponent(encodedId), entity.slice(0, -1)) } && (await replaceStore(store), { ok: true });
      if (method === "PUT") {
        const validators = { products: [validateProductInput, "Product"], categories: [(entry, existing) => ({ ...validateNamedRecord(entry, "Category", existing), parentId: entry.parentId || null, navigation: entry.navigation !== false, colorFilterVisible: entry.colorFilterVisible !== false }), "Category"], collections: [(entry, existing) => ({ ...validateNamedRecord(entry, "Collection", existing), productIds: Array.isArray(entry.productIds) ? entry.productIds.slice(0, 100).map(String) : (existing.productIds || []) }), "Collection"], media: [validateMedia, "Media asset"], team: [(entry, existing) => ({ ...existing, id: String(entry.id || existing.id || crypto.randomUUID()), name: String(entry.name || "").trim().slice(0, 160), role: String(entry.role || "Operator").trim().slice(0, 120), phone: String(entry.phone || "").trim().slice(0, 40), active: entry.active !== false, createdAt: existing.createdAt || now() }), "Team member"] };
        const [validator, label] = validators[entity]; const record = saveRecord(store, entity, payload, validator, label); await replaceStore(store); return { record };
      }
    }
    const orderMatch = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (method === "PATCH" && orderMatch) { const order = item(store.orders, decodeURIComponent(orderMatch[1])); if (!order) throw new OrderValidationError("Order was not found."); if (payload.status !== undefined) order.status = validateOrderStatus(payload.status); if (payload.notes !== undefined) order.notes = String(payload.notes || "").trim().slice(0, 2000); order.updatedAt = now(); recordActivity(store, "order.updated", `${order.id} → ${order.status}`, ownerId); await replaceStore(store); return { order }; }
    const deliveryMatch = path.match(/^\/api\/admin\/delivery\/([^/]+)$/);
    if (method === "PATCH" && deliveryMatch) { const index = store.deliveryRules.findIndex((entry) => entry.code === deliveryMatch[1]); if (index < 0) throw new OrderValidationError("Delivery rule was not found."); const rule = validateDeliveryRule({ ...payload, code: deliveryMatch[1] }, store.deliveryRules[index]); store.deliveryRules[index] = rule; recordActivity(store, "delivery.updated", `${rule.code} delivery rule updated.`, ownerId); await replaceStore(store); return { rule }; }
    if (method === "PUT" && path === "/api/admin/delivery/bulk") { const delta = Number(payload.delta); if (!Number.isFinite(delta) || Math.abs(delta) > 1_000_000) throw new OrderValidationError("Bulk delivery amount is invalid."); const field = payload.mode === "domicile" ? "domicileFee" : "stopDeskFee"; store.deliveryRules.forEach((rule) => { if (!payload.enabledOnly || rule.enabled) rule[field] = Math.max(0, Number(rule[field] || 0) + Math.round(delta)); }); recordActivity(store, "delivery.bulk_updated", `${field} adjusted by ${Math.round(delta)} DA`, ownerId); await replaceStore(store); return { deliveryRules: store.deliveryRules }; }
    if (method === "POST" && path === "/api/admin/delivery/reset") { store.deliveryRules = baselineDelivery(); recordActivity(store, "delivery.reset", "All delivery rules reset to baseline.", ownerId); await replaceStore(store); return { deliveryRules: store.deliveryRules }; }
    throw new HttpsError("not-found", "KDB owner route was not found.");
  } catch (error) { throw domainError(error); }
});
