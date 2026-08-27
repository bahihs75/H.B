import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const file = (...parts) => join(root, ...parts);

test("Cloudflare Pages static entry exposes Firebase configuration before KDB app", async () => {
  const html = await readFile(file("public", "index.html"), "utf8");
  assert.match(html, /<script src="\/firebase-config\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.ok(html.indexOf("/firebase-config.js") < html.indexOf("/app.js"));
});

test("KDB static client uses callable Firebase operations rather than Shopify or a Worker API", async () => {
  const [app, firebaseClient] = await Promise.all([readFile(file("public", "app.js"), "utf8"), readFile(file("public", "firebase-client.js"), "utf8")]);
  assert.match(app, /from "\.\/firebase-client\.js"/);
  assert.doesNotMatch(app, /shopify/i);
  assert.doesNotMatch(firebaseClient, /worker/i);
  assert.match(firebaseClient, /httpsCallable\(functions, name\)/);
  assert.match(firebaseClient, /signInWithEmailAndPassword/);
});

test("Pages deployment files include SPA fallback and static security headers", async () => {
  const [headers, redirects] = await Promise.all([readFile(file("public", "_headers"), "utf8"), readFile(file("public", "_redirects"), "utf8")]);
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /firebase-config\.js/);
  assert.match(redirects, /\/\* \/index\.html 200/);
  await access(file("functions", "index.mjs"));
  await access(file("firestore.rules"));
});
