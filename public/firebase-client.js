import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const config = window.__KDB_FIREBASE_CONFIG__ || {};
const required = ["apiKey", "authDomain", "projectId", "appId"];
const missing = required.filter((key) => !String(config[key] || "").trim());
const configurationError = missing.length ? `KDB Firebase configuration is incomplete: ${missing.join(", ")}.` : "";
const app = configurationError ? null : initializeApp(config);
const auth = app ? getAuth(app) : null;
const functions = app ? getFunctions(app, config.functionsRegion || "us-central1") : null;
if (functions && config.useFunctionsEmulator === true) connectFunctionsEmulator(functions, config.functionsHost || "127.0.0.1", Number(config.functionsPort || 5001));

function callable(name) {
  if (!functions) throw new Error(configurationError);
  return httpsCallable(functions, name);
}
function data(result) { return result.data || {}; }

export async function loadPublicStore() { return data(await callable("getPublicStore")()).store; }
export async function submitCodOrder(payload) { return data(await callable("createCodOrder")(payload)); }
export async function ownerRequest(path, method = "GET", payload = {}) { return data(await callable("ownerApi")({ path, method, payload })); }
export async function signInOwner(email, password) {
  if (!auth) throw new Error(configurationError);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const token = await credential.user.getIdTokenResult(true);
  if (token.claims.owner !== true) { await signOut(auth); throw new Error("This Firebase account is not approved for KDB owner access."); }
  return credential.user;
}
export async function signOutOwner() { if (auth) await signOut(auth); }
export function observeOwner(callback) { if (!auth) return () => {}; return onAuthStateChanged(auth, callback); }
