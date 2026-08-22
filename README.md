# KDB — H.B commerce workspace

KDB is a compact, COD-only material-study storefront. Customers add an item to the bag and submit only their **full name**, **phone number**, **wilaya**, delivery method, and—only for domicile delivery—the dependent **baladiya**. The application accepts no online payment choice and records every accepted order as **COD**.

The owner console at `/#admin` is a bespoke KDB workspace, not Shopify administration. It provides a customer-order ledger, 58-wilaya delivery matrix, catalogue editor, public-copy controls, and activity history. Product, inventory, final payment, and fulfillment integrations can be added later without replacing the KDB owner interface.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `public/` | Responsive KDB storefront, bag, COD checkout, and owner control-room interface. |
| `server/domain.mjs` | Pure order, cart, wilaya, domicile, and COD validation rules. |
| `server/store.mjs` | Isolated JSON repository for KDB settings, catalogue, delivery rules, orders, and activity. |
| `server/index.mjs` | HTTP composition root with public storefront routes and token-protected owner routes. |
| `server/algeria-data.mjs` | Read-only-derived copy of the 58-wilaya and dependent baladiya source data. |

> The development JSON store is intentionally simple. Replace `server/store.mjs` with a managed database repository before handling production-scale order volume or multiple administrators.

## Run locally

```bash
pnpm test
ADMIN_TOKEN='choose-a-long-private-owner-code' PORT=4175 pnpm start
```

Open `http://localhost:4175`. The local fallback code is for development only; always set a strong `ADMIN_TOKEN` outside source control before deployment.

## Test

```bash
pnpm test
```

The suite validates the 58-wilaya source, conditional baladiya requirement, wilaya/baladiya association, and COD-only order normalization.

## Reference boundary

The implementation references Space Wear for high-level custom-admin information architecture and Afak Carpet for `algeria-data.js` only. Those repositories remain read-only and are not modified by this work.
