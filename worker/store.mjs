/** Firestore-backed KDB aggregate used only inside the Cloudflare Worker. */
import { createFirestoreClient } from "./firestore.mjs";
import { createFirestoreStore } from "./firestore-store.mjs";

function productIsPublished(product, now = Date.now()) {
  if (product.status !== "published" || product.visible === false || product.discoveryEnabled === false) return false;
  if (product.publishAt && new Date(product.publishAt).getTime() > now) return false;
  if (product.unpublishAt && new Date(product.unpublishAt).getTime() <= now) return false;
  return true;
}

function publicSnapshot(store) {
  const publicProducts = (store.products || []).filter(productIsPublished).map((product) => ({
    ...product,
    stock: store.settings?.catalog?.showStockCount ? product.stock : undefined,
    variants: (product.variants || []).map((variant) => ({ ...variant, stock: store.settings?.catalog?.showStockCount ? variant.stock : undefined })),
  }));
  return {
    settings: store.settings || {},
    content: {
      ...(store.content || {}),
      heroSlides: (store.content?.heroSlides || []).filter((slide) => slide.enabled).sort((a, b) => a.sortOrder - b.sortOrder),
      projects: (store.content?.projects || []).filter((project) => project.visible !== false),
      certifications: (store.content?.certifications || []).filter((item) => item.visible !== false),
    },
    categories: (store.categories || []).filter((category) => category.visible !== false),
    collections: (store.collections || []).filter((collection) => collection.visible !== false),
    products: publicProducts,
  };
}

export function createKdbFirestoreRepository(env, fetchImpl = fetch) {
  const backend = createFirestoreStore(createFirestoreClient(env, fetchImpl));
  let state;

  async function getStore() {
    if (!state) state = await backend.read();
    return state;
  }

  async function persist() {
    if (!state) throw new Error("KDB Firestore state has not been loaded.");
    state = await backend.replace(state);
    return state;
  }

  return {
    getStore,
    persist,
    async replaceStore(nextStore) { state = nextStore; return persist(); },
    async recordActivity(type, detail, actor = "owner") {
      const store = await getStore();
      store.activity = Array.isArray(store.activity) ? store.activity : [];
      store.activity.unshift({ id: crypto.randomUUID(), type: String(type).slice(0, 120), detail: String(detail).slice(0, 500), actor: String(actor).slice(0, 80), createdAt: new Date().toISOString() });
      store.activity = store.activity.slice(0, 150);
    },
    async snapshot(publicOnly = false) {
      const store = structuredClone(await getStore());
      return publicOnly ? publicSnapshot(store) : store;
    },
  };
}
