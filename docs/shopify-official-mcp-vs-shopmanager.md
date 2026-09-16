# Shopify's Official MCP Servers vs ShopManager AI

**Last verified: September 2026.** Shopify's agent platform moved quickly through
2026, so check the linked pages before relying on any detail here.

ShopManager AI is an independent open-source project. It is not an official
Shopify product and is not endorsed by or affiliated with Shopify. "Shopify" is
a trademark of Shopify Inc.

## The short version

Shopify's official MCP servers and ShopManager AI sit at different layers and
are designed for different people:

- **Shopify's servers** are mostly about **shopper-facing commerce** (catalog,
  cart, checkout, orders) and, in the case of Dev MCP, about **Shopify
  development knowledge** (documentation, schemas, validation).
- **ShopManager AI** is about the **merchant's own store as it exists right
  now**: the theme source, the catalog as configured, the store settings, and
  what is wrong with them.

Nothing here replaces anything there. Running Shopify Dev MCP and ShopManager AI
side by side is the combination most developers will actually want.

## Shopify Dev MCP

[shopify.dev/docs/apps/build/devmcp](https://shopify.dev/docs/apps/build/devmcp)

For **developers and AI coding tools**. It connects an assistant to Shopify's
developer resources so it can work from current reference material rather than
from whatever it memorised.

Current capabilities include searching Shopify developer documentation,
introspecting API schemas, and validating GraphQL queries, Liquid templates and
Shopify Extensions against Shopify's schemas. It also supports development
workflow tasks such as scaffolding, and can reach supported store-management
tasks through the Shopify CLI's authenticated context on the developer's own
machine.

It runs locally and does not require authentication of its own.

**How it differs from this project.** Dev MCP knows how Shopify *works*.
ShopManager AI knows what a *particular store* currently contains. Asking Dev
MCP "which snippet renders the product card on this merchant's theme?" is the
wrong question for it; asking it "what is the correct GraphQL mutation for
updating product SEO in the current API version?" is exactly the right one.

**Use both.** This is the pairing we recommend: Dev MCP for schema-aware,
documentation-grounded development, ShopManager AI for read-only context from
the real connected store.

## Storefront MCP

[shopify.dev/docs/apps/build/storefront-mcp](https://shopify.dev/docs/apps/build/storefront-mcp)

For **shoppers**, through agents acting on their behalf. It connects an agent to
a store's catalog and policies so it can help a customer shop: product discovery
in natural language, store information, and historically cart management.

Storefront MCP implements the UCP Catalog capability and its MCP binding, so its
`search_catalog`, `lookup_catalog` and `get_product` tools conform to the UCP
specification.

**Note on carts.** Storefront MCP's own cart tools were deprecated in favor of
the UCP-conforming Cart MCP tools, with the deprecated ones maintained until
31 August 2026. If you are building cart flows now, use Cart MCP.
([changelog](https://shopify.dev/changelog/storefront-mcp-cart-tools-are-being-deprecated-in-favour-of-ucp-cart-mcp))

**How it differs from this project.** Storefront MCP sees the storefront as a
shopper sees it. It does not expose theme source, Admin configuration, or the
diagnostics a developer needs when a section is rendering the wrong thing.

## UCP: Catalog, Cart, Checkout and Order MCP

[shopify.dev/docs/agents](https://shopify.dev/docs/agents)

Shopify's Universal Commerce Protocol work splits agentic commerce into
capability-specific servers:

| Server | What it is for |
| --- | --- |
| [Storefront Catalog MCP](https://shopify.dev/docs/agents/catalog/storefront-catalog) | Product discovery within a single store's catalog |
| [Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog) | Product discovery across Shopify merchants |
| [Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp) | Building and updating carts: `create_cart`, `get_cart`, `update_cart`, `cancel_cart` |
| [Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp) | Turning carts into checkouts and completing purchases for trusted agents |
| [Order MCP](https://shopify.dev/docs/agents/orders/order-mcp) | Fetching current order state, including `get_order` |

**How they differ from this project.** These are the plumbing for AI shopping
experiences, and they write: carts get created, checkouts get completed. That is
a different and much more sensitive kind of access than reading a merchant's
theme files. ShopManager AI's Free build does not participate in shopper
commerce at all.

## Customer Accounts MCP

[shopify.dev/docs/apps/build/storefront-mcp/servers/customer-account](https://shopify.dev/docs/apps/build/storefront-mcp/servers/customer-account)

For **authenticated customers**. It covers customer-specific actions: tracking
orders, managing returns, and reading account information, in the context of a
signed-in shopper.

**How it differs from this project.** It is scoped to one customer's own data
and actions, not to the merchant's operational view of the store. ShopManager AI
reads the store from the merchant's side, and its Free build reads customer and
order data only where a tool explicitly declares it (see the
`protectedCustomerData` flag in [`tools-manifest.json`](../tools-manifest.json)).

## WebMCP

[shopify.dev/docs/api/web-mcp](https://shopify.dev/docs/api/web-mcp)

For **agents running inside the shopper's browser**. A storefront exposes tools
to the agent in the page, so it can search the catalog, browse, view a product
or variant, update the cart, start checkout and view orders.

Shopify provides these tools on every Liquid storefront, and on storefronts
built with the Hydrogen developer preview, with nothing to install. Agent
support is currently limited to Chromium-based browsers, and the standard is
still emerging.

**How it differs from this project.** WebMCP is session-level and lives in the
rendered storefront. ShopManager AI is server-side and reads the sources and
configuration behind that storefront.

## ShopManager AI Free (this repository)

Independent, open source under Apache-2.0, self-hostable, and **read-only
against Shopify**.

What it is for: giving an AI assistant accurate, current context about a real
store, so its answers are about your store rather than about Shopify in general.

- Theme source inspection: file tree by role, section and block schemas,
  template inspection, Liquid parsing and validation, search across the theme,
  and reference tracing.
- Theme Check, with issues explained.
- Catalog and content reads: products, variants, collections, pages, blogs,
  articles, menus, metafields, metaobjects, media, redirects.
- Store configuration reads: markets, locales, translations, price lists,
  discounts, inventory, locations, webhooks, pixels, script tags, functions,
  checkout profiles.
- Capability and scope diagnostics.
- Operation ledger, snapshots, memories and skills, all in your own database.

It requests read-only Shopify scopes, and CI fails the build if a tool ever
declares a Shopify write. See [SECURITY.md](../SECURITY.md).

## ShopManager AI Pro (hosted)

Not in this repository, and it cannot be unlocked from it. Pro is the hosted
tier at [shopmanagerai.com](https://shopmanagerai.com) and adds governed writes:
theme editing and publishing, catalog and content changes, SEO and AEO
workflows, design and page generation, visual QA, bulk operations,
store-wide orchestration and rollback.

See [free vs pro](https://shopmanagerai.com/free-vs-pro/).

## Comparison

| | Primary user | Primary job | Theme source | Admin configuration | Shopper commerce | Writes |
| --- | --- | --- | --- | --- | --- | --- |
| **Shopify Dev MCP** | Developers | Shopify development knowledge, schemas, validation | Validation against schemas | Through Shopify CLI context | No | Development-oriented |
| **Storefront MCP** | Shoppers, via agents | Catalog discovery and store policies | No | No | Yes | Cart tools moved to Cart MCP |
| **Catalog MCP (UCP)** | Shopper agents | Product discovery | No | No | Yes | No |
| **Cart / Checkout MCP** | Shopper agents | Carts and purchases | No | No | Yes | Yes |
| **Order MCP** | Shopper agents | Current order state | No | No | Yes | No |
| **Customer Accounts MCP** | Authenticated shoppers | Orders, returns, account | No | No | Customer-scoped | Supported customer actions |
| **WebMCP** | Browser agents | Live storefront interaction | No | No | Yes | Session commerce actions |
| **ShopManager AI Free** | Merchants, developers, agencies | Inspect the real store and theme | **Yes** | **Yes, read-only** | No | **None against Shopify** |
| **ShopManager AI Pro** | Merchants, developers, agencies | Governed store operations | Yes | Yes | No | Yes, with policy and approval |

## Which should I use?

**Shopify Dev MCP** when you need current Shopify documentation, GraphQL schema
guidance, or validation of Liquid and extensions while writing code.

**Storefront, Catalog, Cart, Checkout or Order MCP** when you are building a
shopper-facing AI commerce experience: product discovery, carts, purchases,
order status.

**Customer Accounts MCP** when an authenticated shopper needs to act on their
own orders, returns or account.

**WebMCP** when the agent runs in the shopper's browser on a live storefront.

**ShopManager AI Free** when an assistant needs accurate read-only context from
an actual connected store: theme source, configuration, catalog as it is, and
diagnostics, without any risk of changing it.

**ShopManager AI Pro** when those changes actually need to be applied under
policy and approval.

**Shopify Dev MCP together with ShopManager AI** when you are writing code
against Shopify's APIs while also inspecting the real store you are writing it
for. Dev MCP answers "how should this be done?"; ShopManager AI answers "what is
actually there?".

## Sources

- [Shopify Dev MCP](https://shopify.dev/docs/apps/build/devmcp)
- [About Storefront MCP](https://shopify.dev/docs/apps/build/storefront-mcp)
- [Storefront MCP server](https://shopify.dev/docs/apps/build/storefront-mcp/servers/storefront)
- [Customer Accounts MCP server](https://shopify.dev/docs/apps/build/storefront-mcp/servers/customer-account)
- [Build commerce agents with UCP](https://shopify.dev/docs/agents)
- [Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp)
- [Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp)
- [Order MCP](https://shopify.dev/docs/agents/orders/order-mcp)
- [Storefront Catalog MCP](https://shopify.dev/docs/agents/catalog/storefront-catalog)
- [Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog)
- [WebMCP tools](https://shopify.dev/docs/api/web-mcp)
- [Storefront MCP cart tools deprecated in favor of UCP Cart MCP](https://shopify.dev/changelog/storefront-mcp-cart-tools-are-being-deprecated-in-favour-of-ucp-cart-mcp)
