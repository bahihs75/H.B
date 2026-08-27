# KDB COD Delivery and Bespoke Administration Upgrade

- [x] Inspect H.B and the read-only Space Wear and Afak Carpet references without editing those reference repositories.
- [x] Extract the 58-wilaya and dependent baladiya data from Afak Carpet’s `algeria-data.js` into H.B’s delivery model.
- [x] Replace checkout fields with full name, phone number, wilaya, delivery type, and conditional baladiya selection for domicile delivery.
- [x] Enforce COD as the only visible payment method and remove email, address, and payment-choice UI.
- [x] Build a custom KDB owner-admin experience in H.B informed by Space Wear’s information architecture, without copying its code or UI.
- [x] Provide owner controls for orders, delivery mode, wilaya/baladiya details, COD status, products, content, and store settings.
- [x] Add automated tests for dependent wilaya/baladiya logic and COD order validation.
- [x] Validate desktop and mobile checkout/admin workflows and save the H.B-only checkpoint.

## Complete Reference-Feature Synthesis

- [x] Catalogue every customer, order, delivery, content, product, settings, analytics, and operational capability in the read-only Space Wear, Afak Carpet, and Tiddis Tapis references.
- [x] Produce a feature-by-feature implementation map that preserves KDB’s COD-only, 58-wilaya, dependent-baladiya, and owner-first rules.
- [x] Extend the bespoke H.B KDB control room with all applicable order operations, delivery operations, catalogue controls, storefront content controls, customer data, activity, and settings capabilities.
- [x] Extend the H.B storefront with all applicable customer-facing commerce, discovery, and service capabilities without copying reference code or design.
- [x] Add complete automated coverage for each new protected admin operation and customer workflow.
- [x] Verify desktop and mobile interfaces, save a new H.B-only checkpoint, and document the delivered capability matrix.

## Public Owner-Access Privacy

- [x] Remove all customer-facing owner-admin links and public explanatory references while retaining the direct protected route.
- [x] Verify the storefront no longer reveals the owner console and the direct protected route still requires the configured token.
- [x] Commit and push the H.B-only owner-access privacy update.

## Production Firestore and Cloudflare Target

- [x] Isolate a Firestore REST adapter and Firestore collection contract for KDB production without Shopify.
- [x] Superseded the earlier Cloudflare Worker API target and removed it after selecting Cloudflare Pages with Firebase Functions for KDB production.
- [x] Add Firestore deny-by-default browser rules, Worker secret templates, deployment configuration, production documentation, and unit coverage for the repository codec.
- [x] Run direct Node syntax and regression tests for the Worker source and existing KDB domain suite.
- [ ] Create the owner Firebase project, deploy Firestore rules and Functions, import owner-approved production records, configure Cloudflare Pages, and run a live production smoke test.

## Cloudflare Pages Instead of Worker

- [x] Remove the Cloudflare Worker deployment path and its server-side Firestore service-account model from the production target.
- [x] Configure Cloudflare Pages for the static KDB site and document the exact Pages build/output settings.
- [x] Add a browser-safe Firebase client configuration contract and Firestore rules that permit only the minimum required public and authenticated-owner access.
- [x] Preserve server-authoritative COD validation and owner-only data access through a Pages-compatible architecture; document any service that Pages alone cannot safely perform.
- [x] Test the Pages contract and update the Firestore/Cloudflare deployment documentation before pushing the corrected architecture.

## Cloudflare Pages with Firebase Functions for Secure COD

- [x] Replace the former Worker deployment target with Cloudflare Pages and remove all Worker source/configuration from H.B.
- [x] Add Firebase client configuration and Firestore access paths for public KDB catalogue content, with no Shopify dependency.
- [x] Add Firebase Authentication and role-based Firestore rules for owner access without exposing a reusable owner access token in browser code.
- [x] Add Firebase Cloud Functions for server-validated COD order creation and protected owner mutations.
- [x] Connect the static KDB client to the Firebase/Functions API contract while preserving 58 wilayas, domicile-only baladiya, and COD-only flow.
- [x] Add production build/tests and an owner-facing Cloudflare Pages + Firebase setup guide with no real secrets or fabricated records.
