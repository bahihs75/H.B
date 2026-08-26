import assert from "node:assert/strict";
import test from "node:test";
import { decodeFields, encodeFields } from "../worker/firestore.mjs";
import { createFirestoreStore } from "../worker/firestore-store.mjs";

function memoryClient() {
  const collections = new Map();
  const bucket = (name) => collections.get(name) || (collections.set(name, new Map()), collections.get(name));
  return {
    async get(collection, id) { const value = bucket(collection).get(id); return value ? structuredClone({ id, ...value }) : null; },
    async list(collection) { return [...bucket(collection).entries()].map(([id, value]) => structuredClone({ id, ...value })); },
    async put(collection, id, value) { bucket(collection).set(id, structuredClone(value)); return { id, ...value }; },
    async remove(collection, id) { bucket(collection).delete(id); },
  };
}

test("Firestore field codec round-trips KDB nested product records", () => {
  const source = { name: "KDB study", stock: 3, visible: true, absent: null, variants: [{ id: "small", price: 12500, available: true }], content: { title: "Quiet room" } };
  assert.deepEqual(decodeFields(encodeFields(source)), source);
});

test("Firestore repository stores KDB config separately from operational collections", async () => {
  const store = createFirestoreStore(memoryClient());
  await store.replace({
    schemaVersion: 3,
    settings: { storeOpen: true, catalog: { showStockCount: false } },
    content: { heroSlides: [] },
    products: [{ id: "fringe", name: "Approved study", status: "draft" }],
    categories: [{ id: "textile", name: "Textiles" }],
    collections: [], attributes: [], media: [], team: [], orders: [], deliveryRules: [], activity: [],
  });
  const snapshot = await store.read();
  assert.equal(snapshot.settings.storeOpen, true);
  assert.deepEqual(snapshot.products, [{ id: "fringe", name: "Approved study", status: "draft" }]);
  assert.deepEqual(snapshot.categories, [{ id: "textile", name: "Textiles" }]);
  assert.deepEqual(snapshot.orders, []);
});
