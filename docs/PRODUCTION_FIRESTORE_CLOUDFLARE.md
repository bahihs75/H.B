# KDB Production: Cloudflare Pages + Firebase

## Decision

KDB production is a **Cloudflare Pages** site whose static files are in `public/`. It does not use Shopify, Cloudflare Workers, or Pages Functions. **Firebase** provides Cloud Firestore for data, Firebase Authentication for the owner, and Firebase Cloud Functions for server-validated COD orders and protected owner operations.

> COD remains the only payment method. The `createCodOrder` function recalculates product price, stock, wilaya delivery fee, and total from Firestore; the browser cart is never treated as the final commercial record.

| Layer | Responsibility |
|---|---|
| Cloudflare Pages | Serves the KDB static website from `public/` |
| `public/firebase-config.js` | Holds Firebase web-app identifiers only; never a private key |
| Firebase Authentication | Signs in the KDB owner by email/password |
| Cloud Firestore | Stores KDB products, content, 58-wilaya delivery rules, COD orders, media, and audit activity |
| Firebase Cloud Functions | Returns public catalogue data; validates COD and owner mutations |
| Firestore rules | Deny direct browser access; all KDB data uses callable Functions |

Cloudflare Pages can deploy a static folder through a connected Git repository with `exit 0` as the build command and `public` as the output directory.[1] Firebase callable Functions are server-side endpoints and Firebase Auth identity can be used to protect them.[2] [3]

## Firestore records

| Path | Content |
|---|---|
| `kdb_config/current` | Store settings and public content |
| `kdb_products/{id}` | Product details, gallery, variants, stock, publication state |
| `kdb_categories/{id}` and `kdb_collections/{id}` | Catalogue discovery content |
| `kdb_delivery_rules/{wilaya}` | 58 wilayas and Stop Desk/domicile rules |
| `kdb_orders/{id}` | COD order snapshot calculated by the Function |
| `kdb_media/{id}`, `kdb_activity/{id}`, `kdb_team/{id}` | Approved media metadata, audit data, owner team data |

## Files in this repository

| File | Purpose |
|---|---|
| `public/firebase-config.js` | Empty public configuration template; replace only with Firebase Web App values |
| `public/firebase-client.js` | Client calls for public store, COD, owner sign-in and owner API |
| `functions/index.mjs` | Callable Firebase Functions for KDB |
| `functions/set-owner-claim.mjs` | One-time owner claim utility for an already-created Firebase Auth owner |
| `functions/package.json` | Firebase Function runtime dependencies |
| `firestore.rules` | Deny-by-default browser rules |
| `firebase.json` | Firebase Functions and Rules deployment configuration |

## Required owner setup

1. Create a Firebase project and Firestore database in **production mode**. Test mode must not be used for an operating store because it starts with broad client access.[4]
2. Enable **Email/Password** in Firebase Authentication and create the owner account. Customers do not need an account.
3. Copy Firebase Console → Project Settings → Web App configuration into `public/firebase-config.js`.
4. Run `firebase use YOUR_FIREBASE_PROJECT_ID`, install dependencies in `functions/`, then run `firebase deploy --only firestore,functions`. Cloud Functions production deployment has Firebase billing requirements; check Firebase’s current policy before deploying.[2]
5. Give the owner user the `owner: true` claim using `functions/set-owner-claim.mjs`, then sign out and sign in again.
6. Add only owner-approved KDB products, images, delivery rules, contact details, and policies. Do not import Shopify records, test records, customer reviews, ratings, or unapproved claims.
7. In Cloudflare, create a **Pages** project from `bahihs75/H.B`, select branch `main`, set Build command to `exit 0`, and Build output directory to `public`.[1] The `public/_headers` and `public/_redirects` files are deployed with the site.
8. Use the Pages preview deployment created from a pull request or branch to test Product → Bag → COD and owner sign-in before attaching a custom domain. The Pages CLI’s static deploy command does not provide a separate dry-run mode, so a preview deployment is the verification target.

## Commands

```bash
# Project regression tests and Functions source validation
pnpm test
pnpm check:functions

# Firebase, after installing Firebase CLI and authenticating
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore,functions

# Cloudflare Pages direct deployment, after Cloudflare authentication
pnpm deploy:pages
```

## References

[1] [Deploy a static HTML website to Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

[2] [Get started with Firebase Functions](https://firebase.google.com/docs/functions/get-started)

[3] [Firebase Authentication for web](https://firebase.google.com/docs/auth/web/start)

[4] [Cloud Firestore quickstart](https://firebase.google.com/docs/firestore/quickstart)
