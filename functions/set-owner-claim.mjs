/**
 * One-time owner-role setup. Run locally after creating the owner's Firebase
 * Auth account. GOOGLE_APPLICATION_CREDENTIALS must point to a private local
 * service-account file; that file must never be committed or served by Pages.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = String(process.argv[2] || "").trim();
if (!email) throw new Error("Usage: node set-owner-claim.mjs owner@example.com");
initializeApp({ credential: applicationDefault() });
const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), owner: true });
console.log(`KDB owner claim granted to ${email}. Sign out and sign in again before opening #admin.`);
