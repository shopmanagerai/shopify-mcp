# Shopify MCP Server (Free, Open Source)

[![CI](https://github.com/shopmanagerai/shopify-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shopmanagerai/shopify-mcp/actions/workflows/ci.yml)
[![Licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)
[![Tools](https://img.shields.io/badge/tools-122-brightgreen)](tools-manifest.json)
[![Read only](https://img.shields.io/badge/Shopify%20writes-none-success)](#the-read-only-guarantee)

Connect **Claude, ChatGPT, Cursor, Codex or VS Code** to a Shopify store, and
let the assistant read the store the way you read the admin, and read the theme
the way you read the code.

122 tools. Read-only against Shopify. Self-hosted. Apache-2.0.

```
Claude / ChatGPT / Cursor / Codex / VS Code
                  |
          MCP (Streamable HTTP)
                  |
        ShopManager AI server
                  |
     policy engine + operation ledger
                  |
      Shopify Admin API / Theme Access
                  |
              Your store
```

> **Prefer not to run a server?** The same free tools are hosted at
> **[shopmanagerai.com/free](https://shopmanagerai.com/free)** with nothing to
> install. This repository is for people who want to own the deployment.

---

## Contents

- [The read-only guarantee](#the-read-only-guarantee)
- [What it does](#what-it-does)
- [Install](#install)
- [Connect your Shopify store](#connect-your-shopify-store)
- [Connect your AI client](#connect-your-ai-client)
- [Tutorial: your first session](#tutorial-your-first-session)
- [Try it without a Shopify store](#try-it-without-a-shopify-store)
- [What's included](#whats-included)
- [Free vs Pro](#free-vs-pro)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## The read-only guarantee

This build cannot change your store. That is enforced, not promised.

- **No tool writes to Shopify.** Not a theme file, product, collection, page,
  article, menu, metafield, order or customer.
- **It asks for read-only permissions.** The 17 Shopify scopes it requests are
  all `read_*`. The list is generated from what the shipped tools declare, so it
  cannot quietly grow.
- **The few tools that write, write here.** Saved memories, custom skills,
  snapshots and the operation ledger live in your own database. Two tools reach
  Shopify to change something narrow: `shopify.auth.disconnect` (revokes this
  server's own access) and `commerce.settings.storefront_password`.
- **Every call is logged** to the operation ledger with its risk level.
- **Tools declare themselves to your client** through MCP annotations
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`),
  derived from each tool's own metadata.

CI runs [`scripts/assert-free-only.mjs`](scripts/assert-free-only.mjs) against
the registry the server actually builds:

```
OK: 122 tools, all Free.
    0 write to a Shopify store's content or theme.
    7 write only to this server's own state or its own access.
    17 Shopify scopes requested, all read-only.
```

If a tool ever declares a Shopify write, or `.env.example` ever requests a write
scope, the build fails. See [SECURITY.md](SECURITY.md) for the threat model,
including what a Theme Access credential can really do.

## What it does

An AI client on its own cannot see your store. It guesses at your theme,
invents section names, and cannot tell you which snippet renders the cart
drawer. This server gives it the real thing over the
[Model Context Protocol](https://modelcontextprotocol.io):

- **Read the theme like source code.** Full file tree by role, every section and
  block schema, Liquid parsing and validation, search across the theme, and
  reference tracing, so you can ask *which templates actually render this
  snippet?*
- **Run Theme Check** and have each issue explained rather than just listed.
- **Read the catalogue and content**: products, variants, collections, pages,
  blogs, articles, menus, metafields, metaobjects, media, redirects.
- **Read store configuration**: markets, locales, translations, price lists,
  discounts, inventory, locations, webhooks, pixels, script tags, functions,
  checkout profiles.
- **Diagnose the connection**: which scopes are granted, which capabilities are
  missing, and exactly what to do about each one.
- **Remember things between sessions** with saved memories and custom skills.

Good for: understanding a theme you inherited, auditing a store before a
migration, answering "where does this come from?" without ten admin tabs, and
giving an assistant accurate context before you ask it to write any code.

## Install

Node 22+ and pnpm. Docker instructions are [below](#docker).

```bash
git clone https://github.com/shopmanagerai/shopify-mcp.git
cd shopify-mcp
pnpm install
pnpm build
cp .env.example .env
```

Generate a master key and put it in `.env` as `SHOPMANAGER_MASTER_KEY`. Your
Shopify credentials are encrypted with it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Docker

```bash
docker compose up -d
```

The compose file starts in demo mode. For a real store, set `SHOPMANAGER_DEMO`
to `0` and supply the Shopify variables. Data persists in a named volume.

## Connect your Shopify store

You need a Shopify app to authenticate against. This takes a few minutes and
only has to be done once per store.

1. **Create an app** in the [Shopify Dev Dashboard](https://shopify.dev) for the
   store you want to connect, and copy its client ID and secret. If you are
   connecting a store you do not own, it needs to be installed on that store by
   someone who can approve the permissions.

2. **Fill in `.env`:**

   ```bash
   SHOPMANAGER_DEMO=0
   SHOPIFY_CLIENT_ID=your-client-id
   SHOPIFY_CLIENT_SECRET=your-client-secret
   APP_URL=https://your-public-url
   ```

   `APP_URL` has to be reachable by Shopify for the OAuth callback. In
   development, a tunnel such as `cloudflared` or `ngrok` works. Set the same
   URL as the app's redirect URL in the Dev Dashboard.

   `SHOPIFY_SCOPES` is already filled in with the read-only set.

3. **Start the server** and open:

   ```
   http://<APP_URL>/admin?shop=<your-store>.myshopify.com
   ```

4. **Approve the install** in the Shopify admin when prompted.

5. **Add a Theme Access password** in the admin UI. Theme file reads go through
   Shopify's Theme Access proxy, and theme tools report `capability_missing`
   until this is set.

   > Note that a Theme Access password issued by Shopify carries `write_themes`
   > capability at the Shopify credential level. This build ships no theme
   > mutation tool and enforces read-only theme behaviour in its policy layer,
   > but the credential itself is more powerful than the use made of it here.
   > It is encrypted at rest, never returned by a tool, and revocable at any
   > time from the Theme Access app. See [SECURITY.md](SECURITY.md).

6. **Create a token** in the **Connect** screen. That is the `<TOKEN>` your AI
   client sends.

## Connect your AI client

Every client talks to the same URL: `http://<host>/mcp/<shop>`, over Streamable
HTTP, with a bearer token.

| Client | Transport | Status | Guide |
| --- | --- | --- | --- |
| Claude Code | Streamable HTTP | Verified | [docs/claude-code.md](docs/claude-code.md) |
| Cursor | Streamable HTTP | Configuration documented | [docs/cursor.md](docs/cursor.md) |
| VS Code | HTTP MCP | Configuration documented | [docs/vscode.md](docs/vscode.md) |
| Codex | HTTP MCP | Configuration documented | [docs/codex.md](docs/codex.md) |
| ChatGPT | Remote MCP | Depends on plan and developer mode | [docs/chatgpt.md](docs/chatgpt.md) |
| Other MCP clients | Streamable HTTP | Works where the client supports it | [docs/generic-mcp.md](docs/generic-mcp.md) |

*Verified* means we have run the tool calls end to end over that transport.
*Configuration documented* means the config shape is correct and matches the
client's documented format. Last checked September 2026.

The quickest one:

```bash
claude mcp add --transport http shopmanager http://localhost:3000/mcp/your-store.myshopify.com --header "Authorization: Bearer <TOKEN>"
```

### Keeping the client's context small

By default the server advertises three meta-tools, `discover-tools`,
`get-schema` and `execute-tool`, rather than all 122, so your context window is
not spent on a tool catalogue. Append `?surface=flat` to the URL if you would
rather the client see every tool directly.

## Tutorial: your first session

Run these in order the first time you connect a store. All read-only.

**1. Confirm you are pointed at the right store**

> Inspect my Shopify store and tell me the store name, the active theme and the
> number of products. Do not make any changes.

The store name in the reply is the check. If it is not the store you expected,
stop and fix the connection before going further.

**2. Find out what the connection can actually do**

> List the available tools for this store, grouped by whether they are
> available, missing a scope, or missing a capability. For anything
> unavailable, show the exact reason.

Faster than reading logs when theme tools are unexpectedly absent.

**3. Get oriented in the theme**

> Show me the architecture of the active theme: templates, sections, blocks,
> snippets and assets, with file counts per group.

**4. Ask something you could not answer from the admin**

> Which templates and sections actually render `snippets/product-card.liquid`?
> Show the reference chain.

This is the thing a plain AI client cannot do. It traces real `render` and
`include` calls across the theme.

**5. Check the theme for real problems**

> Run Theme Check on the active theme, summarise the issues by severity, then
> explain the three most serious ones and what causes them.

**6. Look for content gaps**

> List my collections and pages, and tell me which have no description or no
> SEO title.

**7. Remember what you learned**

> Save a memory: this store uses a Dawn-based theme, the cart drawer lives in
> `snippets/cart-drawer.liquid`, and product cards come from
> `snippets/product-card.liquid`.

Memories persist between sessions, so the next conversation starts informed.

More prompts, grouped by task, are in the
[prompt library](https://shopmanagerai.com/resources/shopify-ai-prompts/).

## Try it without a Shopify store

Demo mode serves a complete fake store, so you can see every tool work before
creating a Shopify app. Set one line in `.env`:

```bash
SHOPMANAGER_DEMO=1
```

Then `pnpm start`. The server prints:

```
======================================================================
 ShopManager AI, DEMO MODE
 Serving a single fake store: demo.myshopify.com
 Admin UI:  http://localhost:3000/admin?shop=demo.myshopify.com
 MCP URL:   http://localhost:3000/mcp/demo.myshopify.com
======================================================================
```

The bearer token is the fixed string `cp_demo`:

```bash
claude mcp add --transport http shopmanager http://localhost:3000/mcp/demo.myshopify.com --header "Authorization: Bearer cp_demo"
```

Demo mode is a convenience, not a limitation. The same server connects to real
stores; see [above](#connect-your-shopify-store).

## What's included

All 122 tools, by area:

| Area | Tools | Examples |
| --- | ---: | --- |
| Theme inspection, files, Theme Check | 23 | `shopify.theme.architecture`, `shopify.theme.find_reference`, `shopify.theme.file.diff`, `shopify.theme_check.run` |
| Catalogue and content reads | 19 | `shopify.products.list`, `shopify.collection.get`, `shopify.blogs.list`, `shopify.metafields.list` |
| Store configuration and commerce reads | 19 | `shopify.markets.list`, `shopify.translations.list`, `shopify.inventory.get`, `shopify.webhooks.list` |
| System, health and diagnostics | 17 | `commerce.health`, `commerce.capabilities`, `commerce.diagnostics.permissions` |
| Change planning, ledger, export | 11 | `commerce.change.plan`, `commerce.operations.list`, `commerce.export` |
| Memory and skills | 11 | `commerce.memory.save`, `commerce.skills.write` |
| Sections, blocks, templates, Liquid | 9 | `shopify.section.schema`, `shopify.template.inspect`, `shopify.liquid.validate` |
| Auth and capability probes | 7 | `shopify.auth.doctor`, `shopify.store.capabilities` |
| Snapshots | 6 | `commerce.snapshot.create`, `commerce.snapshot.diff`, `commerce.rollback.plan` |

Every tool's input and output schema, required scopes, risk class and data
categories are in [`tools-manifest.json`](tools-manifest.json).

### A note on `commerce.change.*`

These tools plan, validate and apply a change by delegating to another
registered tool, under the same policy pipeline. In this build there is nothing
store-mutating to delegate to: asking `commerce.change.apply` for a Pro tool
returns `TOOL_NOT_FOUND`, because that tool is not in the registry. The facade
is here because plan and diff are useful on their own.

### Use Shopify's Dev MCP alongside

Shopify's own open-source Dev MCP (documentation search, GraphQL schema
introspection, `validate_theme`) is complementary. This server does not
duplicate documentation lookup. Install both.

## Free vs Pro

Everything here is Free and always will be. Free reads; it does not change the
store.

| | Free (this repo, or hosted) | Pro (hosted) |
| --- | --- | --- |
| Read theme, catalogue, content, config | Yes | Yes |
| Theme Check, Liquid validation, reference tracing | Yes | Yes |
| Memories, skills, snapshots, ledger | Yes | Yes |
| Edit theme files, publish themes | No | Yes |
| Write products, collections, pages, articles, menus | No | Yes |
| SEO audits and bulk SEO optimisation | No | Yes |
| Design generation, page building, redesign | No | Yes |
| Screenshots and visual QA | No | Yes |
| Store-wide audit and orchestration | No | Yes |

Pro is a hosted service at [shopmanagerai.com](https://shopmanagerai.com). It is
not in this repository and cannot be unlocked from it. See
[free vs pro](https://shopmanagerai.com/free-vs-pro/) and
[pricing](https://shopmanagerai.com/pricing/).

## Configuration

The settings that matter. The rest are documented inline in
[`.env.example`](.env.example).

| Variable | What it does |
| --- | --- |
| `SHOPMANAGER_DEMO` | `1` serves a fake store and needs no Shopify credentials |
| `PORT` | HTTP port, default `3000` |
| `APP_URL` | Public URL of this server, used for the OAuth callback |
| `DATA_DIR` | Where the SQLite database and blobs live, default `./data` |
| `SHOPMANAGER_MASTER_KEY` | 32 random bytes, base64. Encrypts stored credentials. Generated in development if unset; always set it in production |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Your app's credentials |
| `SHOPIFY_SCOPES` | Read-only scope list, generated from the shipped tools |
| `DATABASE_URL` | Optional `postgres://` URL. SQLite is used when unset |
| `MCP_RATE_LIMIT_PER_MIN` | Requests per minute per credential, default `600` |

## Troubleshooting

**Start here.** Ask your assistant:

> Diagnose this connection and tell me exactly what is wrong and how to fix it.

That runs `shopify.auth.doctor`, which returns a checklist with the fix for
each issue.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Theme tools report `capability_missing` | No Theme Access password stored | Add it in the admin UI. Reinstalling the app clears it |
| A tool reports `scope_missing` | The app was installed without that scope | Update `SHOPIFY_SCOPES`, reinstall, and re-approve |
| A tool reports `pro_required` | It is a Pro tool | Not in this build, by design |
| `401` with a `WWW-Authenticate` header | Missing or wrong bearer token | Check the `Authorization: Bearer <TOKEN>` header |
| The assistant sees no tools | Wrong URL or unknown shop | The path is `/mcp/<shop>`; a bare handle gets `.myshopify.com` appended, and the shop must already be connected |
| `TOOL_NOT_FOUND` from `commerce.change.apply` | The target tool is Pro | Expected. Pro tools are not in this build |

Health endpoints: `/healthz`, `/readyz`, and Prometheus metrics at `/metrics`.

## FAQ

**Is this really free?**
Yes. Apache-2.0, no key, no account, no phone-home. Run it forever.

**Do I have to self-host to use the free tools?**
No. The same tools run hosted at
[shopmanagerai.com/free](https://shopmanagerai.com/free) with no installation.

**Can the AI break my store?**
Not through this build. No tool writes to Shopify, and it asks only for
read-only permissions. See [the guarantee](#the-read-only-guarantee).

**Does it work with ChatGPT?**
It speaks the remote MCP protocol ChatGPT uses, but availability depends on
your plan and on developer mode being enabled for your workspace. See
[docs/chatgpt.md](docs/chatgpt.md).

**Which Shopify API version?**
`2026-07` by default, set by `SHOPIFY_API_VERSION`. Ask for
`commerce.api.capabilities` to see what the current version supports.

**Can I run it without a Shopify store?**
Yes, [demo mode](#try-it-without-a-shopify-store) serves a complete fake store.

**Can I contribute?**
Yes, with one caveat: this repository is generated from a private monorepo that
holds both the Free and Pro tools, so changes are reapplied upstream rather than
merged here. See [CONTRIBUTING.md](CONTRIBUTING.md).

## How this repository relates to the hosted service

A release script cuts every Pro tool definition out of the private monorepo and
publishes the result, so the Free code here is the same code the hosted service
runs for Free users. The git history here is release history, not development
history.

## Licence

Apache-2.0, see [LICENSE](LICENSE). The ShopManager AI name and logo are not
covered by it, see [TRADEMARKS.md](TRADEMARKS.md).
