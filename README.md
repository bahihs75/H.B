# KDB — H.B Unified Commerce Workspace

KDB is a bespoke, COD-only material and carpet commerce experience. It combines public discovery, a minimal Algeria delivery checkout, and an owner-only control room in one application. The implementation synthesizes applicable operating patterns from the read-only Space Wear, Afak Carpet, and Tiddis Tapis references without copying their source, brand identities, or customer data.

Customers browse a searchable catalogue, collections, product details, material galleries, project stories, and contact routes. Checkout collects only **full name**, **phone number**, **wilaya**, delivery method, and—only when domicile delivery is selected—the linked **baladiya**. The server recalculates every line, stock amount, delivery fee, and total, then assigns `COD` itself. No online payment, email, or free-form address field exists.

The owner console at `/#admin` is an original KDB workspace rather than an external administration panel. It contains overview KPIs, COD order operations, all-58-wilaya delivery settings, catalogue and collection tools, hero studio, bilingual content controls, media library, insights, settings, audit activity, JSON recovery tools, and a non-authenticating team directory.

## Functional coverage

| Area | Included KDB capability |
| --- | --- |
| Storefront | Hero slides, search, category/collection discovery, product detail, variants, galleries, colour swatches, contact, Arabic interface switch, projects, and factual statistics. |
| Catalogue | Categories, collections, draft/published/archived lifecycle, feature placement, scheduling, offers, variants, stock, attributes, sizes, custom-size flag, gallery, hover image, tags, and discovery controls. |
| COD delivery | Full 58-wilaya matrix, Stop Desk/domicile selection, dependent baladiya, individual delivery rates, bulk adjustments, free-delivery rule, availability, and reset baseline. |
| Owner operations | Order lifecycle, notes, delivery context, activity log, catalogue health, low-stock signals, delivery coverage, and confirmed-value reporting. |
| Content and media | Ordered hero studio, public copy, projects, factual statistics, certifications, section visibility, reusable URL-backed media metadata, usage and tag filtering. |
| Settings and recovery | KDB identity, contact channels, navigation/presentation, SEO-safe settings, consent/marketing configuration, JSON backup, and guarded restore. |

> Customer testimonials, ratings, and reviews are deliberately not generated, seeded, or displayed. Marketing identifiers are inert configuration values; the storefront does not activate tracking merely because an identifier has been stored.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `public/` | Responsive KDB storefront, bag, COD checkout, and unified owner control-room interface. |
| `server/domain.mjs` | Pure order, catalogue, media, delivery, analytics, and configuration validation rules. |
| `server/store.mjs` | Isolated JSON repository for settings, content, catalogue, media, delivery, orders, team directory, and activity. |
| `server/index.mjs` | HTTP composition root with filtered public routes and token-protected owner operations. |
| `server/algeria-data.mjs` | Read-only-derived copy of the 58-wilaya and dependent baladiya source data. |

> `server/store.mjs` is intentionally limited to local development and isolated Node tests. The production target is the Cloudflare Worker plus Firestore adapter in `worker/`; it contains no Shopify dependency and does not enable online payment.

## Production: Firestore + Cloudflare

The real KDB deployment target is **Cloudflare Workers + Cloud Firestore**, not the temporary testing stack. The Worker serves the static storefront and KDB API, and the server-side Worker alone accesses Firestore with a service-account secret. Browser access to Firestore is denied by `firestore.rules`.

Read [`docs/PRODUCTION_FIRESTORE_CLOUDFLARE.md`](./docs/PRODUCTION_FIRESTORE_CLOUDFLARE.md) before deployment. It specifies the Firestore collections, rules, required Cloudflare secrets, launch gate, and the fact that COD remains the only payment method.

```bash
# Validate the Worker source without running a deployment.
node --check worker/index.mjs
node --test

# After creating Firebase/Cloudflare projects and setting Worker secrets:
pnpm deploy:cloudflare
```

## Run locally

```bash
pnpm test
ADMIN_TOKEN='choose-a-long-private-owner-code' PORT=4175 pnpm start
```

Open `http://localhost:4175`. The local fallback code is for development only; always set a strong `ADMIN_TOKEN` outside source control before deployment.

## Validation and test

```bash
pnpm test
```

The suite validates the 58-wilaya source, conditional baladiya requirement, COD-only order normalization, server-authoritative price and stock, media URL safety, delivery rules, legacy-data normalization, public/private API boundaries, owner content/catalogue/media/settings/data-tool mutations, and JSON recovery against an isolated temporary repository.

## Reference boundary

Space Wear, Afak Carpet, and Tiddis Tapis remain read-only references. Their repositories are not modified by this work. See [`docs/FEATURE_SYNTHESIS.md`](./docs/FEATURE_SYNTHESIS.md) for the KDB capability matrix and [`docs/VALIDATION.md`](./docs/VALIDATION.md) for validation evidence.
