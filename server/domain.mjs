/**
 * ADR: KDB commerce and control-room domain rules
 *
 * Problem: a broader storefront must not weaken COD, stock, delivery or owner
 * configuration safeguards.
 * Decision: centralize all incoming record normalization and order validation
 * in pure functions. The HTTP layer only composes these rules with persistence.
 * Consequence: each public and protected mutation can be tested without I/O.
 */
import { WILAYAS, communesOf } from "./algeria-data.mjs";

const phonePattern = /^[0-9+(). -]{8,24}$/;
const deliveryTypes = new Set(["stop_desk", "domicile"]);
const orderStatuses = new Set(["requested", "confirmed", "awaiting_supply", "processing", "ready_to_ship", "shipped", "delivered", "cancelled", "returned"]);
const productStatuses = new Set(["draft", "published", "archived"]);
const mediaUsages = new Set(["hero", "product", "collection", "project", "identity", "other"]);

export class OrderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderValidationError";
  }
}

const text = (value, field, { min = 0, max = 1000, required = false } = {}) => {
  const normalized = String(value ?? "").trim();
  if (required && normalized.length < min) throw new OrderValidationError(`${field} is required.`);
  if (normalized.length > max) throw new OrderValidationError(`${field} is too long.`);
  return normalized;
};

const bool = (value, fallback = false) => value === undefined ? fallback : Boolean(value);
const number = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) throw new OrderValidationError(`${field} is invalid.`);
  return parsed;
};

export function safeHttpUrl(value, field = "URL", optional = false) {
  const candidate = String(value ?? "").trim();
  if (!candidate && optional) return "";
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new OrderValidationError(`${field} must use HTTP or HTTPS.`);
  }
}

export function wilayaByCode(code) {
  return WILAYAS.find((wilaya) => wilaya.code === code) ?? null;
}

export function validateOrderInput(input) {
  const fullName = text(input.fullName, "Customer full name", { min: 3, max: 160, required: true });
  const phone = text(input.phone, "Phone number", { min: 8, max: 24, required: true });
  const wilayaCode = String(input.wilayaCode ?? "");
  const deliveryType = String(input.deliveryType ?? "");
  const baladiya = text(input.baladiya, "Baladiya", { max: 160 });
  const source = text(input.source, "Order source", { max: 80 }) || "storefront";
  const campaign = text(input.campaign, "Campaign", { max: 120 });

  if (!phonePattern.test(phone)) throw new OrderValidationError("Enter a valid phone number.");
  const wilaya = wilayaByCode(wilayaCode);
  if (!wilaya) throw new OrderValidationError("Select one of the 58 Algerian wilayas.");
  if (!deliveryTypes.has(deliveryType)) throw new OrderValidationError("Choose a delivery method.");
  if (deliveryType === "domicile") {
    if (!baladiya) throw new OrderValidationError("Select a baladiya for domicile delivery.");
    if (!communesOf(wilayaCode).includes(baladiya)) throw new OrderValidationError("The selected baladiya does not belong to this wilaya.");
  }
  return { fullName, phone, wilayaCode, wilayaName: wilaya.ar, deliveryType, baladiya: deliveryType === "domicile" ? baladiya : null, paymentMethod: "COD", source, campaign: campaign || null };
}

function purchasableProduct(product, now = Date.now()) {
  if (!product || product.status !== "published" || product.visible === false || product.discoveryEnabled === false) return false;
  if (product.publishAt && new Date(product.publishAt).getTime() > now) return false;
  if (product.unpublishAt && new Date(product.unpublishAt).getTime() <= now) return false;
  return true;
}

export function validateCart(lines, products) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 24) throw new OrderValidationError("Your bag is empty.");
  const lineIds = new Set();
  return lines.map((line) => {
    const product = products.find((item) => item.id === String(line.productId));
    if (!purchasableProduct(product)) throw new OrderValidationError("One product is no longer available.");
    const variant = product.variants.find((item) => item.id === String(line.variantId || product.variants[0]?.id));
    const quantity = number(line.quantity, `Quantity for ${product.name}`, { min: 1, max: 8, integer: true });
    if (!variant || variant.available === false || variant.stock < quantity) throw new OrderValidationError(`Quantity is unavailable for ${product.name}.`);
    const key = `${product.id}:${variant.id}`;
    if (lineIds.has(key)) throw new OrderValidationError("Each product variant can appear once in the bag.");
    lineIds.add(key);
    return { productId: product.id, variantId: variant.id, sku: variant.sku, name: product.name, variantName: variant.name, price: variant.price, quantity, image: product.image };
  });
}

export function validateProductInput(input, existing = {}) {
  const id = text(input.id || existing.id || crypto.randomUUID(), "Product id", { min: 2, max: 80, required: true }).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const status = String(input.status ?? existing.status ?? "draft");
  if (!productStatuses.has(status)) throw new OrderValidationError("Product lifecycle state is invalid.");
  const primaryImage = safeHttpUrl(input.image ?? existing.image, "Product image");
  const gallery = Array.isArray(input.gallery) ? input.gallery.slice(0, 12).map((url) => safeHttpUrl(url, "Gallery image")) : (existing.gallery || [primaryImage]);
  const variants = Array.isArray(input.variants) && input.variants.length ? input.variants.slice(0, 32).map((variant, index) => ({
    id: text(variant.id || `${id}-variant-${index + 1}`, "Variant id", { min: 2, max: 100, required: true }),
    name: text(variant.name || "Standard", "Variant name", { min: 1, max: 120, required: true }),
    sku: text(variant.sku || `${id.toUpperCase()}-${index + 1}`, "SKU", { min: 2, max: 100, required: true }),
    price: number(variant.price, "Variant price", { min: 0, max: 10_000_000 }),
    stock: number(variant.stock, "Variant stock", { min: 0, max: 100_000, integer: true }),
    available: bool(variant.available, true),
  })) : [{ id: `${id}-standard`, name: "Standard", sku: `${id.toUpperCase()}-01`, price: number(input.price ?? existing.price, "Product price", { min: 0, max: 10_000_000 }), stock: number(input.stock ?? existing.stock, "Product stock", { min: 0, max: 100_000, integer: true }), available: true }];
  const colors = Array.isArray(input.colors) ? input.colors.slice(0, 24).map((color) => ({ name: text(color.name, "Colour name", { min: 1, max: 80, required: true }), hex: /^#[0-9a-fA-F]{6}$/.test(String(color.hex)) ? String(color.hex) : "#d4b28a" })) : (existing.colors || []);
  const attributes = Array.isArray(input.attributes) ? input.attributes.slice(0, 32).map((attribute) => ({ id: text(attribute.id, "Attribute id", { min: 1, max: 80, required: true }), label: text(attribute.label, "Attribute label", { min: 1, max: 120, required: true }), value: text(attribute.value, "Attribute value", { min: 1, max: 240, required: true }) })) : (existing.attributes || []);
  const collectionIds = Array.isArray(input.collectionIds) ? input.collectionIds.slice(0, 16).map((item) => text(item, "Collection id", { min: 1, max: 80, required: true })) : (existing.collectionIds || []);
  return {
    ...existing,
    id,
    name: text(input.name ?? existing.name, "Product name", { min: 2, max: 160, required: true }),
    nameAr: text(input.nameAr ?? existing.nameAr, "Arabic product name", { max: 160 }),
    categoryId: text(input.categoryId ?? existing.categoryId, "Category", { min: 1, max: 80, required: true }),
    navigationCategory: text(input.navigationCategory ?? existing.navigationCategory ?? input.categoryId, "Navigation category", { min: 1, max: 80, required: true }),
    collectionIds,
    sku: text(input.sku ?? existing.sku ?? variants[0].sku, "Product SKU", { min: 2, max: 100, required: true }),
    material: text(input.material ?? existing.material, "Material", { max: 160 }),
    description: text(input.description ?? existing.description, "Product description", { max: 3000 }),
    descriptionAr: text(input.descriptionAr ?? existing.descriptionAr, "Arabic product description", { max: 3000 }),
    price: variants[0].price,
    stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
    status,
    featured: bool(input.featured, existing.featured),
    visible: bool(input.visible, existing.visible !== false),
    discoveryEnabled: bool(input.discoveryEnabled, existing.discoveryEnabled !== false),
    position: number(input.position ?? existing.position ?? 0, "Product position", { min: 0, max: 10_000, integer: true }),
    image: primaryImage,
    hoverImage: input.hoverImage ? safeHttpUrl(input.hoverImage, "Hover image") : (existing.hoverImage || primaryImage),
    gallery,
    colors,
    attributes,
    variants,
    sizes: Array.isArray(input.sizes) ? input.sizes.slice(0, 24).map((item) => text(item, "Size", { min: 1, max: 80, required: true })) : (existing.sizes || variants.map((variant) => variant.name)),
    customSizeEnabled: bool(input.customSizeEnabled, existing.customSizeEnabled),
    lifestyleEnabled: bool(input.lifestyleEnabled, existing.lifestyleEnabled !== false),
    giftEligible: bool(input.giftEligible, existing.giftEligible),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 24).map((item) => text(item, "Tag", { min: 1, max: 80, required: true })) : (existing.tags || []),
    publishAt: input.publishAt ? new Date(input.publishAt).toISOString() : null,
    unpublishAt: input.unpublishAt ? new Date(input.unpublishAt).toISOString() : null,
    offer: { enabled: bool(input.offer?.enabled, existing.offer?.enabled), label: text(input.offer?.label ?? existing.offer?.label, "Offer label", { max: 120 }), endsAt: input.offer?.endsAt ? new Date(input.offer.endsAt).toISOString() : null },
    updatedAt: new Date().toISOString(),
  };
}

export function validateNamedRecord(input, kind, existing = {}) {
  const id = text(input.id || existing.id || crypto.randomUUID(), `${kind} id`, { min: 2, max: 100, required: true }).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const image = input.image || existing.image ? safeHttpUrl(input.image ?? existing.image, `${kind} image`) : "";
  return {
    ...existing,
    id,
    name: text(input.name ?? existing.name, `${kind} name`, { min: 2, max: 160, required: true }),
    nameAr: text(input.nameAr ?? existing.nameAr, `Arabic ${kind} name`, { max: 160 }),
    description: text(input.description ?? existing.description, `${kind} description`, { max: 2000 }),
    descriptionAr: text(input.descriptionAr ?? existing.descriptionAr, `Arabic ${kind} description`, { max: 2000 }),
    image,
    visible: bool(input.visible, existing.visible !== false),
    position: number(input.position ?? existing.position ?? 0, `${kind} position`, { min: 0, max: 10_000, integer: true }),
  };
}

export function validateHeroSlide(input, existing = {}) {
  const record = validateNamedRecord(input, "Hero slide", existing);
  return {
    ...record,
    kicker: text(input.kicker ?? existing.kicker, "Hero kicker", { max: 160 }),
    kickerAr: text(input.kickerAr ?? existing.kickerAr, "Arabic hero kicker", { max: 160 }),
    title: record.name,
    titleAr: record.nameAr,
    body: record.description,
    bodyAr: record.descriptionAr,
    action: text(input.action ?? existing.action, "Hero action", { max: 120 }),
    actionAr: text(input.actionAr ?? existing.actionAr, "Arabic hero action", { max: 120 }),
    href: text(input.href ?? existing.href, "Hero destination", { max: 255 }) || "#shop",
    externalUrl: input.externalUrl ? safeHttpUrl(input.externalUrl, "Hero external URL") : "",
    mobileImage: input.mobileImage ? safeHttpUrl(input.mobileImage, "Hero mobile image") : record.image,
    fallbackImage: input.fallbackImage ? safeHttpUrl(input.fallbackImage, "Hero fallback image") : record.image,
    textTone: ["light", "dark"].includes(input.textTone ?? existing.textTone) ? (input.textTone ?? existing.textTone) : "dark",
    iconMarkup: text(input.iconMarkup ?? existing.iconMarkup, "Hero icon markup", { max: 240 }),
    enabled: bool(input.enabled, existing.enabled !== false),
    sortOrder: record.position,
  };
}

export function validateMedia(input, existing = {}) {
  const usage = String(input.usage ?? existing.usage ?? "other");
  if (!mediaUsages.has(usage)) throw new OrderValidationError("Media usage is invalid.");
  return {
    ...existing,
    id: text(input.id || existing.id || crypto.randomUUID(), "Media id", { min: 2, max: 100, required: true }),
    name: text(input.name ?? existing.name, "Media name", { min: 2, max: 160, required: true }),
    url: safeHttpUrl(input.url ?? existing.url, "Media URL"),
    provider: text(input.provider ?? existing.provider ?? "external", "Media provider", { min: 2, max: 80, required: true }),
    usage,
    section: text(input.section ?? existing.section, "Media section", { max: 120 }),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 24).map((tag) => text(tag, "Media tag", { min: 1, max: 80, required: true })) : (existing.tags || []),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

export function validateOrderStatus(value) {
  const status = String(value ?? "");
  if (!orderStatuses.has(status)) throw new OrderValidationError("Order status is invalid.");
  return status;
}

export function validateDeliveryRule(input, existing) {
  const wilaya = wilayaByCode(String(input.code ?? existing?.code));
  if (!wilaya || !existing) throw new OrderValidationError("Delivery rule is invalid.");
  return {
    ...existing,
    code: wilaya.code,
    name: wilaya.ar,
    stopDeskFee: number(input.stopDeskFee ?? existing.stopDeskFee, "Stop Desk fee", { min: 0, max: 1_000_000, integer: true }),
    domicileFee: number(input.domicileFee ?? existing.domicileFee, "Domicile fee", { min: 0, max: 1_000_000, integer: true }),
    enabled: bool(input.enabled, existing.enabled),
    free: bool(input.free, existing.free),
  };
}

export function validateSettingsPatch(input) {
  const patch = input && typeof input === "object" ? input : {};
  return {
    announcement: text(patch.announcement, "Announcement", { max: 255 }),
    storeOpen: bool(patch.storeOpen, true),
    identity: patch.identity && typeof patch.identity === "object" ? patch.identity : {},
    presentation: patch.presentation && typeof patch.presentation === "object" ? patch.presentation : {},
    catalog: patch.catalog && typeof patch.catalog === "object" ? patch.catalog : {},
    delivery: patch.delivery && typeof patch.delivery === "object" ? patch.delivery : {},
    marketing: patch.marketing && typeof patch.marketing === "object" ? patch.marketing : {},
    seo: patch.seo && typeof patch.seo === "object" ? patch.seo : {},
  };
}

export function buildAnalytics(store) {
  const activeProducts = store.products.filter((product) => product.status !== "archived");
  const publishedProducts = activeProducts.filter((product) => product.status === "published" && product.visible !== false);
  const totalUnits = activeProducts.reduce((sum, product) => sum + product.variants.reduce((variantSum, variant) => variantSum + variant.stock, 0), 0);
  const lowStock = activeProducts.flatMap((product) => product.variants.filter((variant) => variant.stock <= 3).map((variant) => ({ productId: product.id, product: product.name, variant: variant.name, sku: variant.sku, stock: variant.stock })));
  const confirmedStatuses = new Set(["confirmed", "awaiting_supply", "processing", "ready_to_ship", "shipped", "delivered"]);
  const confirmedRevenue = store.orders.filter((order) => confirmedStatuses.has(order.status)).reduce((sum, order) => sum + order.total, 0);
  const byStatus = Object.fromEntries([...orderStatuses].map((status) => [status, store.orders.filter((order) => order.status === status).length]));
  const disabledWilayas = store.deliveryRules.filter((rule) => !rule.enabled).map((rule) => ({ code: rule.code, name: rule.name }));
  const scheduledProducts = store.products.filter((product) => product.publishAt || product.unpublishAt).map((product) => ({ id: product.id, name: product.name, publishAt: product.publishAt, unpublishAt: product.unpublishAt }));
  return { publishedProducts: publishedProducts.length, activeProducts: activeProducts.length, totalUnits, orderCount: store.orders.length, requestedOrders: byStatus.requested, confirmedRevenue, lowStock, byStatus, disabledWilayas, scheduledProducts, mediaCount: store.media.length, catalogueHealth: { missingImage: activeProducts.filter((product) => !product.image).length, hiddenProducts: activeProducts.filter((product) => product.visible === false).length, draftProducts: activeProducts.filter((product) => product.status === "draft").length } };
}
