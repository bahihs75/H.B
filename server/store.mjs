/**
 * ADR: KDB unified operations repository
 *
 * Problem: KDB needs one owner-controlled source of truth for public content,
 * catalogue governance, Algerian COD delivery and operational reporting.
 * Decision: keep a normalized JSON repository behind this module. The HTTP
 * boundary never performs file work directly, so a durable repository can
 * replace this adapter without changing business rules or the owner console.
 * Consequence: this implementation is suitable for local and single-owner
 * operation; production-scale traffic requires a transactional managed store.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WILAYAS } from "./algeria-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storePath = process.env.KDB_STORE_PATH ? path.resolve(process.env.KDB_STORE_PATH) : path.join(root, "data", "store.json");
const textileImage = "https://cdn.shopify.com/s/files/1/0849/6014/9747/files/PcdzkgakKRVYhJXL.jpg?v=1787320300";
const rollsImage = "https://cdn.shopify.com/s/files/1/0849/6014/9747/files/WgELGDitFvYmVjBB.jpg?v=1787320322";

const defaultFilters = [
  { id: "category", label: "Category", type: "select", options: [] },
  { id: "colour", label: "Colour", type: "select", options: [] },
  { id: "material", label: "Material", type: "select", options: [] },
  { id: "availability", label: "Availability", type: "toggle", options: ["In stock"] },
];

export function deliveryBaseline() {
  return WILAYAS.map((wilaya) => ({ code: wilaya.code, name: wilaya.ar, stopDeskFee: 0, domicileFee: 0, enabled: true, free: false }));
}

function makeProduct({ id, name, nameAr, categoryId, collectionIds, price, stock, image, description, material, position }) {
  return {
    id,
    name,
    nameAr,
    categoryId,
    navigationCategory: categoryId,
    collectionIds,
    sku: `KDB-${id.toUpperCase()}-01`,
    material,
    description,
    descriptionAr: "دراسة هادئة في الملمس واللون ومساحة الغرفة.",
    price,
    stock,
    status: "published",
    featured: true,
    position,
    image,
    hoverImage: image,
    gallery: [image],
    colors: [{ name: "Natural", hex: "#d4b28a" }],
    attributes: [{ id: "construction", label: "Construction", value: material }],
    variants: [{ id: `${id}-standard`, name: "Standard", sku: `KDB-${id.toUpperCase()}-01`, price, stock, available: true }],
    sizes: ["Standard"],
    customSizeEnabled: false,
    lifestyleEnabled: true,
    visible: true,
    discoveryEnabled: true,
    giftEligible: false,
    tags: ["KDB", categoryId],
    publishAt: null,
    unpublishAt: null,
    offer: { enabled: false, label: "", endsAt: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function seedStore() {
  const heroImage = textileImage;
  return {
    schemaVersion: 2,
    settings: {
      announcement: "COD orders · Delivery across all 58 wilayas.",
      storeOpen: true,
      identity: {
        storeName: "KDB",
        tagline: "Objects for the rooms you return to.",
        logoUrl: "",
        primaryColor: "#123d45",
        accentColor: "#ffebaf",
        contactPhone: "0550 000 000",
        whatsappUrl: "",
        email: "studio@kdb.example",
        address: "Algeria",
        socialLinks: { instagram: "", facebook: "", tiktok: "" },
        privacyUrl: "/privacy",
        termsUrl: "/terms",
      },
      presentation: {
        heroVisible: true,
        heroAutoplay: true,
        heroInterval: 6000,
        heroDots: true,
        heroArrows: true,
        heroPauseOnInteraction: true,
        heroHeight: "editorial",
        mobileFloatingNav: true,
        floatingNavItems: ["shop", "collections", "projects", "contact"],
      },
      catalog: {
        showAvailability: true,
        showStockCount: false,
        allowWaitlist: false,
        searchEnabled: true,
        lifestyleViews: true,
        mobileColorRail: true,
        shareableFilters: true,
        filters: structuredClone(defaultFilters),
      },
      delivery: {
        fulfilmentMessage: "Choose Stop Desk or domicile delivery. KDB confirms every COD request by phone.",
        handlingDays: "3–5 working days",
        freeDeliveryThreshold: 0,
      },
      marketing: {
        consentTitle: "Your privacy matters",
        consentText: "KDB uses essential storage to operate the storefront. Optional marketing tools are not activated by this setting.",
        metaPixelId: "",
        tiktokPixelId: "",
      },
      seo: { title: "KDB — Objects for the everyday", description: "KDB material studies with COD delivery across Algeria." },
    },
    content: {
      heroSlides: [{
        id: "hero-01", kicker: "THE KDB ROOM / 2026", kickerAr: "غرفة KDB / 2026",
        title: "Objects that make a room hold still.", titleAr: "أشياء تجعل الغرفة أكثر هدوءاً.",
        body: "KDB brings material studies, useful forms, and quietly vivid rooms into one considered edit.", bodyAr: "يجمع KDB دراسات المواد والأشكال المفيدة والغرف الهادئة في تحرير واحد مدروس.",
        action: "Shop the room edit", actionAr: "اكتشف المجموعة", href: "#shop", externalUrl: "", image: heroImage,
        mobileImage: heroImage, fallbackImage: heroImage, textTone: "dark", iconMarkup: "", enabled: true, sortOrder: 0,
      }],
      about: {
        title: "Made for the rooms you return to.",
        body: "Every KDB study is selected for texture, scale, and the way it lets a room settle into itself.",
        titleAr: "مصمم للغرف التي تعود إليها.",
        bodyAr: "يختار KDB كل قطعة من أجل الملمس والمقياس والطريقة التي تمنح بها الغرفة هدوءها.",
      },
      projects: [],
      statistics: [
        { id: "stat-01", label: "Wilayas served", value: "58", visible: true },
        { id: "stat-02", label: "Payment method", value: "COD", visible: true },
      ],
      certifications: [],
      sectionVisibility: { hero: true, catalogue: true, collections: true, projects: false, about: true, contact: true, statistics: true },
    },
    categories: [
      { id: "textile", name: "Textiles", nameAr: "منسوجات", description: "Material studies for daily rooms.", image: textileImage, parentId: null, navigation: true, visible: true, colorFilterVisible: true, position: 0 },
      { id: "rug", name: "Rugs", nameAr: "سجاد", description: "Soft terrain for grounded interiors.", image: rollsImage, parentId: null, navigation: true, visible: true, colorFilterVisible: true, position: 1 },
    ],
    collections: [
      { id: "quiet-rooms", name: "Quiet rooms", nameAr: "غرف هادئة", description: "A restrained edit of material and scale.", image: textileImage, productIds: ["fringe", "terrain"], visible: true, position: 0 },
      { id: "colour-underfoot", name: "Colour underfoot", nameAr: "ألوان تحت القدم", description: "Saturated fibre and attentive colour.", image: rollsImage, productIds: ["rolls"], visible: true, position: 1 },
    ],
    products: [
      makeProduct({ id: "fringe", name: "Hand-Finished Fringe", nameAr: "حواف يدوية التشطيب", categoryId: "textile", collectionIds: ["quiet-rooms"], price: 12500, stock: 7, image: textileImage, description: "A warm woven study with a carefully finished edge.", material: "Woven textile", position: 0 }),
      makeProduct({ id: "rolls", name: "Rolled Colour Study", nameAr: "دراسة ألوان ملفوفة", categoryId: "textile", collectionIds: ["colour-underfoot"], price: 8900, stock: 11, image: rollsImage, description: "Saturated fibre and quiet geometry for the everyday room.", material: "Loop pile", position: 1 }),
      makeProduct({ id: "terrain", name: "Soft Terrain", nameAr: "تضاريس ناعمة", categoryId: "rug", collectionIds: ["quiet-rooms"], price: 15600, stock: 4, image: textileImage, description: "Tactile pile with a soft natural finish.", material: "Hand-tufted pile", position: 2 }),
    ],
    attributes: [
      { id: "construction", label: "Construction", type: "select", values: ["Woven textile", "Loop pile", "Hand-tufted pile"] },
      { id: "material", label: "Material", type: "select", values: ["Wool", "Cotton", "Mixed fibre"] },
    ],
    media: [
      { id: "media-hero-01", name: "Warm material room", url: heroImage, provider: "external", usage: "hero", section: "homepage", tags: ["hero", "warm", "room"], createdAt: new Date().toISOString() },
      { id: "media-product-01", name: "Rolled colour study", url: rollsImage, provider: "external", usage: "product", section: "catalogue", tags: ["product", "colour", "textile"], createdAt: new Date().toISOString() },
    ],
    team: [{ id: "owner", name: "KDB Owner", role: "Owner", phone: "", active: true, createdAt: new Date().toISOString() }],
    orders: [],
    deliveryRules: deliveryBaseline(),
    activity: [],
  };
}

function recordFromLegacyProduct(product, index) {
  const legacyId = String(product.id || crypto.randomUUID());
  const defaultCollectionIds = legacyId === "rolls" ? ["colour-underfoot"] : ["quiet-rooms"];
  return makeProduct({
    id: legacyId,
    name: String(product.name || "Untitled study"),
    nameAr: String(product.nameAr || product.name || "قطعة KDB"),
    categoryId: String(product.categoryId || product.category || "textile").toLowerCase().replace(/\s+/g, "-") || "textile",
    collectionIds: Array.isArray(product.collectionIds) && product.collectionIds.length ? product.collectionIds : defaultCollectionIds,
    price: Number(product.price) || 0,
    stock: Number(product.stock) || 0,
    image: String(product.image || textileImage),
    description: String(product.description || ""),
    material: String(product.material || "Material study"),
    position: Number.isFinite(Number(product.position)) ? Number(product.position) : index,
  });
}

function normaliseSettings(settings = {}) {
  const seed = seedStore().settings;
  const legacy = {
    ...settings,
    identity: { ...seed.identity, ...(settings.identity || {}), contactPhone: settings.supportPhone || settings.identity?.contactPhone || seed.identity.contactPhone },
  };
  return {
    ...seed,
    ...legacy,
    identity: { ...seed.identity, ...(legacy.identity || {}) },
    presentation: { ...seed.presentation, ...(settings.presentation || {}) },
    catalog: { ...seed.catalog, ...(settings.catalog || {}), filters: Array.isArray(settings.catalog?.filters) ? settings.catalog.filters : seed.catalog.filters },
    delivery: { ...seed.delivery, ...(settings.delivery || {}) },
    marketing: { ...seed.marketing, ...(settings.marketing || {}) },
    seo: { ...seed.seo, ...(settings.seo || {}) },
  };
}

export function normaliseStore(input) {
  const seed = seedStore();
  const store = input && typeof input === "object" ? structuredClone(input) : seed;
  store.schemaVersion = 2;
  store.settings = normaliseSettings(store.settings);
  store.content = { ...seed.content, ...(store.content || {}) };
  store.content.heroSlides = Array.isArray(store.content.heroSlides) && store.content.heroSlides.length ? store.content.heroSlides.map((slide, index) => ({ ...seed.content.heroSlides[0], ...slide, id: String(slide.id || `hero-${index + 1}`), sortOrder: Number(slide.sortOrder ?? index) })) : seed.content.heroSlides;
  store.content.about = { ...seed.content.about, ...(store.content.about || {}) };
  store.content.projects = Array.isArray(store.content.projects) ? store.content.projects : [];
  store.content.statistics = Array.isArray(store.content.statistics) ? store.content.statistics : seed.content.statistics;
  store.content.certifications = Array.isArray(store.content.certifications) ? store.content.certifications : [];
  store.content.sectionVisibility = { ...seed.content.sectionVisibility, ...(store.content.sectionVisibility || {}) };
  store.categories = Array.isArray(store.categories) && store.categories.length ? store.categories : seed.categories;
  store.collections = Array.isArray(store.collections) ? store.collections : seed.collections;
  store.products = (Array.isArray(store.products) ? store.products : seed.products).map((product, index) => {
    const base = recordFromLegacyProduct(product, index);
    const record = { ...base, ...product };
    record.collectionIds = Array.isArray(record.collectionIds) && record.collectionIds.length ? record.collectionIds : base.collectionIds;
    record.image = String(record.image || textileImage).startsWith("/manus-storage/") ? textileImage : String(record.image || textileImage);
    record.gallery = Array.isArray(record.gallery) && record.gallery.length ? record.gallery : [record.image];
    record.variants = Array.isArray(record.variants) && record.variants.length ? record.variants.map((variant, variantIndex) => ({ id: String(variant.id || `${record.id}-${variantIndex + 1}`), name: String(variant.name || "Standard"), sku: String(variant.sku || `${record.sku}-${variantIndex + 1}`), price: Number(variant.price ?? record.price), stock: Math.max(0, Number(variant.stock ?? record.stock)), available: variant.available !== false })) : base.variants;
    record.stock = Math.max(0, Number(record.stock ?? record.variants.reduce((sum, variant) => sum + variant.stock, 0)));
    return record;
  });
  store.attributes = Array.isArray(store.attributes) ? store.attributes : seed.attributes;
  store.media = Array.isArray(store.media) ? store.media : seed.media;
  store.team = Array.isArray(store.team) ? store.team : seed.team;
  store.orders = Array.isArray(store.orders) ? store.orders : [];
  const byCode = new Map((Array.isArray(store.deliveryRules) ? store.deliveryRules : []).map((rule) => [String(rule.code), rule]));
  store.deliveryRules = deliveryBaseline().map((rule) => ({ ...rule, ...(byCode.get(rule.code) || {}) }));
  store.activity = Array.isArray(store.activity) ? store.activity : [];
  return store;
}

let state;

export async function getStore() {
  if (state) return state;
  try {
    state = normaliseStore(JSON.parse(await readFile(storePath, "utf8")));
  } catch {
    state = seedStore();
  }
  await persist();
  return state;
}

export async function persist() {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function replaceStore(nextStore) {
  state = normaliseStore(nextStore);
  await persist();
  return state;
}

export async function recordActivity(type, detail, actor = "owner") {
  const store = await getStore();
  store.activity.unshift({ id: crypto.randomUUID(), type: String(type).slice(0, 120), detail: String(detail).slice(0, 500), actor: String(actor).slice(0, 80), createdAt: new Date().toISOString() });
  store.activity = store.activity.slice(0, 150);
}

function productIsPublished(product, now = Date.now()) {
  if (product.status !== "published" || product.visible === false || product.discoveryEnabled === false) return false;
  if (product.publishAt && new Date(product.publishAt).getTime() > now) return false;
  if (product.unpublishAt && new Date(product.unpublishAt).getTime() <= now) return false;
  return true;
}

export async function snapshot(publicOnly = false) {
  const store = await getStore();
  if (!publicOnly) return structuredClone(store);
  const publicProducts = store.products.filter(productIsPublished).map((product) => ({
    ...product,
    stock: store.settings.catalog.showStockCount ? product.stock : undefined,
    variants: product.variants.map((variant) => ({ ...variant, stock: store.settings.catalog.showStockCount ? variant.stock : undefined })),
  }));
  const visibleCategories = store.categories.filter((category) => category.visible !== false);
  const visibleCollections = store.collections.filter((collection) => collection.visible !== false);
  return {
    settings: store.settings,
    content: { ...store.content, heroSlides: store.content.heroSlides.filter((slide) => slide.enabled).sort((a, b) => a.sortOrder - b.sortOrder), projects: store.content.projects.filter((project) => project.visible !== false), certifications: store.content.certifications.filter((item) => item.visible !== false) },
    categories: visibleCategories,
    collections: visibleCollections,
    products: publicProducts,
  };
}
