/**
 * ADR: Firestore REST adapter for Cloudflare Workers
 *
 * Problem: KDB production must use Firestore without exposing database access
 * or service-account credentials to browser code, and without Node-only SDKs.
 * Decision: use the Firestore REST API from the Worker and mint short-lived
 * OAuth tokens with Web Crypto from Worker secrets.
 * Consequence: Firestore stays behind KDB's API boundary and can be tested with
 * a mocked fetch implementation; no Firebase secret is bundled into `public/`.
 */

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export class FirestoreConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FirestoreConfigurationError";
  }
}

export class FirestoreRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FirestoreRequestError";
    this.status = status;
  }
}

function required(value, name) {
  if (!value || !String(value).trim()) throw new FirestoreConfigurationError(`${name} is required for the Firestore backend.`);
  return String(value).trim();
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function createAssertion(env, now = Math.floor(Date.now() / 1000)) {
  const email = required(env.FIREBASE_SERVICE_ACCOUNT_EMAIL, "FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const key = required(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY, "FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY").replaceAll("\\n", "\n");
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({ iss: email, scope: FIRESTORE_SCOPE, aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600 }));
  const signed = new TextEncoder().encode(`${header}.${claims}`);
  const cryptoKey = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, signed));
  return `${header}.${claims}.${base64Url(signature)}`;
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  throw new TypeError(`KDB cannot encode Firestore value type ${typeof value}.`);
}

export function encodeFields(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined).map(([key, value]) => [key, encodeValue(value)]));
}

function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

export function createFirestoreClient(env, fetchImpl = fetch) {
  const projectId = required(env.FIREBASE_PROJECT_ID, "FIREBASE_PROJECT_ID");
  let cachedToken = null;

  async function token() {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
    const assertion = await createAssertion(env, Math.floor(now / 1000));
    const response = await fetchImpl(TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
    const payload = await response.json();
    if (!response.ok || !payload.access_token) throw new FirestoreRequestError(response.status, payload.error_description || "Firestore OAuth token request failed.");
    cachedToken = { value: payload.access_token, expiresAt: now + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000 };
    return cachedToken.value;
  }

  async function request(path, options = {}) {
    const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path.replace(/^\//, "")}`, {
      ...options,
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new FirestoreRequestError(response.status, payload.error?.message || "Firestore request failed.");
    return payload;
  }

  return {
    async get(collection, id) {
      try {
        const document = await request(`${collection}/${encodeURIComponent(id)}`, { method: "GET" });
        return document.fields ? { ...decodeFields(document.fields), id } : null;
      } catch (error) {
        if (error instanceof FirestoreRequestError && error.status === 404) return null;
        throw error;
      }
    },
    async list(collection) {
      const response = await request(`${collection}?pageSize=500`, { method: "GET" });
      return (response.documents || []).map((document) => ({ ...decodeFields(document.fields || {}), id: document.name.split("/").at(-1) }));
    },
    async put(collection, id, record) {
      await request(`${collection}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ fields: encodeFields(record) }) });
      return { id, ...record };
    },
    async remove(collection, id) {
      await request(`${collection}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}
