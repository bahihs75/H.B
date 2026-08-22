import test from "node:test";
import assert from "node:assert/strict";
import { WILAYAS } from "../server/algeria-data.mjs";
import { OrderValidationError, buildAnalytics, validateCart, validateDeliveryRule, validateMedia, validateOrderInput, validateProductInput } from "../server/domain.mjs";
import { normaliseStore, seedStore } from "../server/store.mjs";

test("delivery source contains every Algerian wilaya", () => {
  assert.equal(WILAYAS.length, 58);
  assert.equal(WILAYAS[0].code, "01");
  assert.equal(WILAYAS.at(-1).code, "58");
});

test("domicile order requires a baladiya from the selected wilaya", () => {
  const valid = validateOrderInput({ fullName: "KDB Test Customer", phone: "0555000000", wilayaCode: "16", deliveryType: "domicile", baladiya: "القصبة" });
  assert.equal(valid.paymentMethod, "COD");
  assert.equal(valid.baladiya, "القصبة");
  assert.throws(() => validateOrderInput({ fullName: "KDB Test Customer", phone: "0555000000", wilayaCode: "16", deliveryType: "domicile", baladiya: "وهران" }), OrderValidationError);
});

test("stop desk order omits baladiya and remains COD-only", () => {
  const valid = validateOrderInput({ fullName: "KDB Test Customer", phone: "0555000000", wilayaCode: "31", deliveryType: "stop_desk" });
  assert.equal(valid.baladiya, null);
  assert.equal(valid.paymentMethod, "COD");
});

test("catalogue validation produces stock-aware variants and refuses unsafe media URLs", () => {
  const product = validateProductInput({
    id: "test-study",
    name: "KDB Test Study",
    categoryId: "textile",
    sku: "KDB-TEST-01",
    material: "Woven textile",
    image: "https://example.com/study.jpg",
    price: 9500,
    stock: 5,
    status: "published",
    variants: [{ id: "test-standard", name: "Standard", sku: "KDB-TEST-01", price: 9500, stock: 5, available: true }],
  });
  assert.equal(product.variants[0].stock, 5);
  assert.equal(product.stock, 5);
  assert.throws(() => validateMedia({ id: "bad-media", name: "Bad", url: "javascript:alert(1)", usage: "hero", provider: "external" }), OrderValidationError);
});

test("server cart validation uses the selected variant stock and ignores browser price", () => {
  const store = seedStore();
  const product = store.products[0];
  const variant = product.variants[0];
  const lines = validateCart([{ productId: product.id, variantId: variant.id, quantity: 2, price: 1 }], store.products);
  assert.equal(lines[0].price, variant.price);
  assert.equal(lines[0].quantity, 2);
  assert.throws(() => validateCart([{ productId: product.id, variantId: variant.id, quantity: variant.stock + 1 }], store.products), OrderValidationError);
});

test("delivery rule updates keep the 58-wilaya identity and analytics expose low stock", () => {
  const store = seedStore();
  const original = store.deliveryRules.find((rule) => rule.code === "16");
  const updated = validateDeliveryRule({ code: "16", stopDeskFee: 400, domicileFee: 750, enabled: true, free: false }, original);
  assert.equal(updated.name, "الجزائر");
  assert.equal(updated.domicileFee, 750);
  store.products[0].variants[0].stock = 2;
  const analytics = buildAnalytics(store);
  assert.equal(analytics.lowStock[0].stock, 2);
  assert.equal(analytics.publishedProducts, 3);
});

test("legacy H.B records normalize into the unified KDB schema without losing COD order history", () => {
  const normalized = normaliseStore({
    settings: { heroTitle: "Legacy room", supportPhone: "0555000000", storeOpen: true },
    products: [{ id: "legacy", name: "Legacy Study", category: "Textile", price: 1000, stock: 1, status: "published", image: "https://example.com/legacy.jpg", description: "Legacy material" }],
    orders: [{ id: "KDB-0001", fullName: "KDB Test Customer", status: "requested" }],
    deliveryRules: [{ code: "16", stopDeskFee: 100, domicileFee: 300, enabled: true }],
  });
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.products[0].variants.length, 1);
  assert.equal(normalized.orders[0].id, "KDB-0001");
  assert.equal(normalized.deliveryRules.length, 58);
  assert.equal(normalized.settings.identity.contactPhone, "0555000000");
});
