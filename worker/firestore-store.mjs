/**
 * ADR: KDB Firestore repository shape
 *
 * Problem: the former development JSON file is not deployable on Cloudflare
 * Workers and should not be the production source of truth.
 * Decision: map each operational KDB record family to its own Firestore
 * collection, while keeping settings and public content as bounded documents.
 * Consequence: the existing domain layer can receive the same aggregate shape,
 * but product, order, media, and audit records do not accumulate in one
 * Firestore document.
 */

const RECORD_COLLECTIONS = {
  products: "kdb_products",
  categories: "kdb_categories",
  collections: "kdb_collections",
  attributes: "kdb_attributes",
  media: "kdb_media",
  team: "kdb_team",
  orders: "kdb_orders",
  deliveryRules: "kdb_delivery_rules",
  activity: "kdb_activity",
};

const CONFIG_COLLECTION = "kdb_config";
const CONFIG_DOCUMENT = "current";

export function createFirestoreStore(client) {
  async function read() {
    const config = await client.get(CONFIG_COLLECTION, CONFIG_DOCUMENT);
    if (!config) throw new Error("KDB Firestore is empty. Import approved production records before opening the store.");
    const values = await Promise.all(Object.values(RECORD_COLLECTIONS).map((collection) => client.list(collection)));
    const records = Object.fromEntries(Object.keys(RECORD_COLLECTIONS).map((key, index) => [key, values[index]]));
    return { schemaVersion: Number(config.schemaVersion || 3), settings: config.settings || {}, content: config.content || {}, ...records };
  }

  async function replace(store) {
    await client.put(CONFIG_COLLECTION, CONFIG_DOCUMENT, { schemaVersion: 3, settings: store.settings || {}, content: store.content || {} });
    await Promise.all(Object.entries(RECORD_COLLECTIONS).map(async ([key, collection]) => {
      const next = Array.isArray(store[key]) ? store[key] : [];
      const current = await client.list(collection);
      const nextIds = new Set(next.map((record) => String(record.id)));
      await Promise.all(current.filter((record) => !nextIds.has(String(record.id))).map((record) => client.remove(collection, record.id)));
      await Promise.all(next.map((record) => {
        const { id, ...fields } = record;
        return client.put(collection, String(id), fields);
      }));
    }));
    return read();
  }

  return { read, replace };
}
