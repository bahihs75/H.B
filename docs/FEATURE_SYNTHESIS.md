# KDB — Complete Reference-Feature Synthesis

## Boundary and decision

This document defines the feature synthesis for **H.B only**. Space Wear, Afak Carpet, and Tiddis Tapis are read-only references. KDB will not copy their source code, branding, customer data, or visual compositions. The application keeps its established KDB identity, owner-only access model, COD-only payment rule, server-authoritative totals, and Algeria’s 58-wilaya delivery model.

> **Decision:** The H.B owner room becomes the single operational surface. The storefront and API consume the same local repository model; customers never write directly to storage, product prices are never accepted from the browser, and no fabricated ratings, testimonials, reviews, or customer social proof will be created.

## Capability matrix

| KDB module | Reference patterns synthesized | H.B implementation target |
| --- | --- | --- |
| Owner access | Space Wear console lock; Afak role-aware navigation | Owner-token protected session, locked console, explicit audit attribution. A staff directory can record operational contacts, but does not grant access until a real identity provider is configured. |
| Control overview | Space Wear reports; Tiddis dashboard and insights | KPIs for published catalogue, units, order status, COD value, low stock, delivery availability, catalogue health, and recent activity. |
| Hero studio | Space Wear, Afak, and Tiddis slide editors | Ordered, enabled slides with desktop/mobile/fallback imagery, contrast, bilingual-ready fields, CTA/action destinations, controls, timing, and presentation settings. |
| Catalogue and products | All three reference catalogues | Hierarchical categories, collections, product lifecycle, feature placement, position, multi-image gallery, hover image, SKU, materials, attributes, colour swatches, variants, size/custom-size rule, price, availability, stock, scheduled publish window, and temporary offer configuration. |
| Discovery controls | Tiddis catalogue experience; Space Wear filters | Configurable filter definitions, stock/availability display, search/discovery toggle, colour rail, lifestyle view, shareable filter capability, and waitlist preference. |
| Delivery operations | Space Wear, Afak, and Tiddis delivery matrices | All 58 wilayas with Stop Desk/domicile fees, enabled state, bulk adjustments, free-delivery threshold, fulfilment message, handling guidance, and reset-to-baseline action. |
| COD order ledger | Space Wear lifecycle; Afak order management | Search and status filtering, requested/confirmed/awaiting supply/processing/ready to ship/shipped/delivered/cancelled/returned workflow, order notes, immutable line snapshot, customer contact, wilaya, baladiya, source/campaign, and server-calculated totals. |
| Media library | Space Wear/Tiddis media; Afak reuse library | URL-backed reusable assets with name, usage, section, tags, provider, searchable metadata, usage filtering, and safe removal. Image uploads remain disabled without a configured storage provider. |
| Public content | Afak content CMS; Tiddis settings | Editable about copy, collection/category copy, projects gallery, statistics, certifications, public-section visibility, contact channels, social links, desktop/mobile navigation settings, and SEO-safe metadata. |
| Store and privacy settings | All references | KDB identity, logo/colours, legal routes, contact details, consent copy, and optional Meta/TikTok identifiers stored as configuration only. No tracker loads merely because an identifier is saved. |
| Insights and operations | Space Wear reports; Tiddis data tools | Order volume, confirmed revenue, remaining units, low-stock list, delivery coverage, catalogue health, activity refresh, JSON backup export, and guarded JSON restore. |
| Customer storefront | Afak showroom and Space Wear discovery | Search, category and collection discovery, product detail view, gallery, variants, visual filters, project/gallery storytelling, contact routes, and a concise COD checkout that preserves the KDB-required fields only. |

## Data architecture

The JSON repository remains the sole development persistence adapter. It is expanded into the following bounded domains:

| Domain | Owned records | Important invariants |
| --- | --- | --- |
| `settings` | identity, contact, navigation, SEO, privacy, marketing, catalogue behaviour, delivery policy | No credentials in public data; public strings and URLs are normalized. |
| `content` | hero slides, about content, projects, statistics, certifications, section visibility | Customer claims cannot be represented as fabricated testimonials or ratings. |
| `catalogue` | categories, collections, products, attributes, filters | Published products have stock-aware purchasable variants; unpublish/archive windows block checkout. |
| `media` | URL metadata, provider, usage, section, tags | Only HTTP(S) URLs and bounded tags are accepted. |
| `deliveryRules` | 58 wilayas, fees, enabled state | Customer order uses only valid two-digit wilaya codes; domicile requires a matching baladiya. |
| `orders` | server-valued line snapshots, contact/delivery context, status, notes, source | Server recomputes line price, stock and total; payment method is always COD. |
| `operations` | activity, backup version, team directory contacts | Activity records non-secret owner mutations; import is owner-protected and schema-validated. |

## API surface

Public endpoints serve only published configuration, product discovery, product detail, catalog filters, collections/projects, and COD ordering. Owner endpoints cover each bounded domain with explicit validation and activity logging. The public application will never receive owner configuration, customer order data, private team entries, backup content, or secret configuration values.

## Delivery constraints preserved from KDB

1. The checkout collects only **full name, phone number, wilaya, delivery type**, and **baladiya only for domicile delivery**.
2. `COD` is assigned on the server. The browser cannot select or override another payment method.
3. Customer line prices, stock, delivery fees, free-delivery policy, and totals are calculated from the repository state at order creation.
4. All customer-entered text is normalized and escaped before it is rendered.
5. Marketing identifiers are inert settings until the owner deliberately configures a compliant integration outside this codebase.
