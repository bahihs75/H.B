# KDB Production Target: Firestore + Cloudflare

## Decision

The **H.B repository** is the KDB production target. It does not use Shopify. Cloudflare Workers serves the KDB application and its API, while Cloud Firestore stores the catalogue, owner-controlled content, delivery matrix, COD orders, and operational records. The temporary KDB preview can remain separate during migration.

> KDB remains **cash on delivery only**. Firestore and Cloudflare do not activate cards, gateways, or online payment methods.

## Runtime boundary

| Concern | Production responsibility |
|---|---|
| Public storefront and static assets | Cloudflare Worker Assets from `public/` |
| Public and owner API | `worker/index.mjs` |
| Operational data | Cloud Firestore through the Worker only |
| Browser database access | Denied by `firestore.rules` |
| Owner access | Server-side `KDB_ADMIN_TOKEN` secret; never exposed to public JavaScript |
| Product images | Approved HTTPS URLs or a separately approved asset workflow; no example Shopify asset is required for production |

Firestore supports web/server architectures with security rules, while Firestore REST calls authenticated with a service account use IAM rather than browser rules.[1] The Worker therefore holds the service-account secrets and is the only application component allowed to access the database. Firestore rules deliberately deny direct browser access as a second boundary.[2]

## Firestore collections

| Firestore path | Data | Query requirement |
|---|---|---|
| `kdb_settings/current` | Store identity, opening state, presentation, COD delivery configuration | Single document read |
| `kdb_content/current` | Hero, about, projects, section visibility | Single document read |
| `kdb_products/{productId}` | Product, variants, images, publishing state | Public published listing; product-by-id read |
| `kdb_categories/{categoryId}` | Category navigation and visibility | Public visible listing |
| `kdb_collections/{collectionId}` | Owner-curated product groups | Public visible listing |
| `kdb_delivery_rules/{wilayaCode}` | 58-wilaya service state and Stop Desk/domicile fees | Owner-only; order-time server read |
| `kdb_orders/{orderId}` | Server-calculated COD order, lines, status, notes | Owner-only listing and update |
| `kdb_media/{mediaId}` | Approved media metadata | Owner-only management |
| `kdb_activity/{activityId}` | Owner audit trail | Owner-only listing |

The production import must contain **owner-approved content only**. No placeholder products, contact channels, delivery dates, policy statements, ratings, reviews, or sales figures may be imported from test data.

## Required secrets

| Secret | Where to set it | Purpose |
|---|---|---|
| `KDB_ADMIN_TOKEN` | Cloudflare Worker secret | Protect owner API operations |
| `FIREBASE_PROJECT_ID` | Cloudflare Worker secret | Select the Firestore project |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` | Cloudflare Worker secret | Identify the least-privilege server principal |
| `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` | Cloudflare Worker secret | Obtain the short-lived OAuth access token for Firestore REST |

Do not put any of these in `wrangler.jsonc`, browser code, committed `.env` files, screenshots, or product records. Firestore REST accepts a Google OAuth 2.0 token for service-account requests and requires the datastore scope.[1]

## Cloudflare setup

Cloudflare’s React/Vite guidance supports a Worker API with static SPA assets and single-page route fallback.[3] This repository therefore uses `wrangler.jsonc` with `worker/index.mjs` as the API entry and `public/` as static assets.

After creating the Firebase project and Firestore database in production mode, deploy rules first, then set Worker secrets and deploy the Worker:

```bash
firebase init firestore
firebase deploy --only firestore

pnpm add -D wrangler
pnpm wrangler secret put KDB_ADMIN_TOKEN
pnpm wrangler secret put FIREBASE_PROJECT_ID
pnpm wrangler secret put FIREBASE_SERVICE_ACCOUNT_EMAIL
pnpm wrangler secret put FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
pnpm wrangler deploy
```

Do not use Firestore test mode in production: it permits broad browser access until rules are replaced.[2]

## Import and launch gate

1. Create the Firebase project, choose the Firestore location deliberately, create the database in production mode, and deploy `firestore.rules`.[2]
2. Set the four Worker secrets through Cloudflare; the local equivalent is `.dev.vars`, created from `.dev.vars.example`.
3. Import only completed owner-approved KDB records. Keep the storefront closed until a real catalogue, prices, stock decisions, images, delivery fees, and contact/policy details have been approved.
4. Run the KDB API, COD, owner-access, and mobile test matrix against Firestore before pointing a custom domain at the Worker.
5. Keep the test preview separate until the Firestore production smoke check succeeds.

## References

[1] [Use the Cloud Firestore REST API](https://firebase.google.com/docs/firestore/use-rest-api)

[2] [Cloud Firestore Security Rules: get started](https://firebase.google.com/docs/firestore/security/get-started)

[3] [React + Vite on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
