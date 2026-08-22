/**
 * ADR: KDB local operations store
 *
 * Problem: the editable H.B repository starts without a managed database, but
 * the custom KDB admin needs a concrete state model for products, COD orders,
 * delivery rules, content and activity.
 * Decision: isolate JSON persistence behind a small repository module so the
 * HTTP layer has no file-system logic and a production database can replace it.
 * Consequence: this repo runs without external services; production should use
 * a durable managed data store before handling real customer orders at scale.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WILAYAS } from "./algeria-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storePath = path.join(root, "data", "store.json");
const textileImage = "https://cdn.shopify.com/s/files/1/0849/6014/9747/files/PcdzkgakKRVYhJXL.jpg?v=1787320300";

function seedStore() {
  return {
    settings: {
      heroTitle: "Objects that make a room hold still.",
      heroBody: "KDB brings material studies, useful forms, and quietly vivid rooms into one considered edit.",
      announcement: "COD orders · Delivery across all 58 wilayas.",
      supportPhone: "0550 000 000",
      storeOpen: true,
    },
    products: [
      { id: "fringe", name: "Hand-Finished Fringe", category: "Textile", price: 12500, stock: 7, status: "published", featured: true, image: textileImage, description: "A warm woven study with a carefully finished edge." },
      { id: "rolls", name: "Rolled Colour Study", category: "Textile", price: 8900, stock: 11, status: "published", featured: true, image: textileImage, description: "Saturated fibre and quiet geometry for the everyday room." },
      { id: "terrain", name: "Soft Terrain", category: "Rug", price: 15600, stock: 4, status: "published", featured: true, image: textileImage, description: "Tactile pile with a soft natural finish." },
    ],
    orders: [],
    deliveryRules: WILAYAS.map((wilaya) => ({ code: wilaya.code, name: wilaya.ar, stopDeskFee: 0, domicileFee: 0, enabled: true })),
    activity: [],
  };
}

let state;

export async function getStore() {
  if (state) return state;
  try {
    state = JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    state = seedStore();
    await persist();
  }
  for (const product of state.products) {
    if (String(product.image).startsWith("/manus-storage/")) product.image = textileImage;
  }
  return state;
}

export async function persist() {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function recordActivity(type, detail) {
  const store = await getStore();
  store.activity.unshift({ id: crypto.randomUUID(), type, detail, createdAt: new Date().toISOString() });
  store.activity = store.activity.slice(0, 100);
  await persist();
}

export async function snapshot(publicOnly = false) {
  const store = await getStore();
  const publicProducts = store.products.filter((product) => product.status === "published");
  if (publicOnly) return { settings: store.settings, products: publicProducts };
  return structuredClone(store);
}
