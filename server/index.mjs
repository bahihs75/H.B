/**
 * ADR: KDB HTTP composition root
 *
 * Problem: the H.B commerce site needs customer COD ordering and a bespoke
 * studio admin without delegating the experience to Shopify’s admin UI.
 * Decision: provide a dependency-light Node HTTP boundary with explicit public
 * and token-protected administration routes. Domain validation and persistence
 * remain in separate modules.
 * Consequence: the app is portable and testable; ADMIN_TOKEN must be configured
 * in production and a durable store should replace the local JSON repository.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCart, validateOrderInput, OrderValidationError } from "./domain.mjs";
import { getStore, persist, recordActivity, snapshot } from "./store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4175);
const adminToken = process.env.ADMIN_TOKEN || "kdb-local-admin";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg" };

function json(response, code, payload) {
  response.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  try { return JSON.parse(raw || "{}"); } catch { throw new OrderValidationError("Invalid request body."); }
}

function isAdmin(request) {
  return request.headers["x-kdb-admin-token"] === adminToken;
}

async function serveStatic(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const safePath = path.normalize(path.join(root, "public", requestPath));
  if (!safePath.startsWith(path.join(root, "public"))) return json(response, 403, { error: "Forbidden" });
  try {
    const data = await readFile(safePath);
    response.writeHead(200, { "content-type": mime[path.extname(safePath)] || "application/octet-stream" });
    response.end(data);
  } catch { json(response, 404, { error: "Not found" }); }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/store") return json(response, 200, await snapshot(true));
    if (request.method === "POST" && request.url === "/api/orders") {
      const input = await body(request);
      const store = await getStore();
      const delivery = validateOrderInput(input);
      const lines = validateCart(input.lines, store.products);
      const rule = store.deliveryRules.find((item) => item.code === delivery.wilayaCode);
      if (!rule?.enabled) throw new OrderValidationError("Delivery is not available for the selected wilaya.");
      const deliveryFee = delivery.deliveryType === "domicile" ? rule.domicileFee : rule.stopDeskFee;
      const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
      for (const line of lines) store.products.find((product) => product.id === line.productId).stock -= line.quantity;
      const order = { id: `KDB-${String(store.orders.length + 1).padStart(4, "0")}`, ...delivery, lines, subtotal, deliveryFee, total: subtotal + deliveryFee, status: "requested", createdAt: new Date().toISOString() };
      store.orders.unshift(order);
      await recordActivity("order.created", `${order.id} / ${order.wilayaCode} / ${order.deliveryType}`);
      await persist();
      return json(response, 201, { order });
    }
    if (request.method === "POST" && request.url === "/api/admin/session") {
      const input = await body(request);
      if (input.token !== adminToken) return json(response, 401, { error: "Administration access was not accepted." });
      return json(response, 200, { ok: true });
    }
    if (request.url?.startsWith("/api/admin")) {
      if (!isAdmin(request)) return json(response, 401, { error: "Administration access is required." });
      const store = await getStore();
      if (request.method === "GET" && request.url === "/api/admin/store") return json(response, 200, await snapshot(false));
      if (request.method === "PUT" && request.url === "/api/admin/settings") {
        const patch = await body(request);
        store.settings = { ...store.settings, ...patch };
        await recordActivity("settings.updated", "Storefront settings were saved.");
        return json(response, 200, { settings: store.settings });
      }
      if (request.method === "PUT" && request.url === "/api/admin/products") {
        const product = await body(request);
        if (!product.name || !Number.isFinite(Number(product.price)) || !Number.isFinite(Number(product.stock))) throw new OrderValidationError("Product name, price and stock are required.");
        const record = { id: product.id || crypto.randomUUID(), name: String(product.name).trim(), category: String(product.category || "Textile").trim(), price: Number(product.price), stock: Number(product.stock), status: product.status === "archived" ? "archived" : "published", featured: Boolean(product.featured), image: String(product.image || "https://cdn.shopify.com/s/files/1/0849/6014/9747/files/PcdzkgakKRVYhJXL.jpg?v=1787320300"), description: String(product.description || "").trim() };
        const existing = store.products.findIndex((item) => item.id === record.id);
        if (existing >= 0) store.products[existing] = record; else store.products.unshift(record);
        await recordActivity("catalogue.saved", record.name);
        await persist();
        return json(response, 200, { product: record });
      }
      if (request.method === "PATCH" && request.url?.startsWith("/api/admin/orders/")) {
        const id = decodeURIComponent(request.url.split("/").at(-1));
        const patch = await body(request);
        const order = store.orders.find((item) => item.id === id);
        const statuses = new Set(["requested", "confirmed", "packed", "shipped", "delivered", "cancelled"]);
        if (!order || !statuses.has(patch.status)) throw new OrderValidationError("Order or operational status is invalid.");
        order.status = patch.status;
        await recordActivity("order.status", `${id} → ${patch.status}`);
        await persist();
        return json(response, 200, { order });
      }
      if (request.method === "PATCH" && request.url?.startsWith("/api/admin/delivery/")) {
        const code = decodeURIComponent(request.url.split("/").at(-1));
        const patch = await body(request);
        const rule = store.deliveryRules.find((item) => item.code === code);
        if (!rule) throw new OrderValidationError("Delivery rule is invalid.");
        rule.stopDeskFee = Math.max(0, Number(patch.stopDeskFee ?? rule.stopDeskFee));
        rule.domicileFee = Math.max(0, Number(patch.domicileFee ?? rule.domicileFee));
        rule.enabled = Boolean(patch.enabled);
        await recordActivity("delivery.updated", `${code} delivery rule updated`);
        await persist();
        return json(response, 200, { rule });
      }
    }
    return serveStatic(request, response);
  } catch (error) {
    const status = error instanceof OrderValidationError ? 422 : 500;
    console.error("[KDB]", error);
    return json(response, status, { error: error.message || "Unexpected server error." });
  }
});

server.listen(port, () => console.log(`KDB H.B running on http://localhost:${port}`));
