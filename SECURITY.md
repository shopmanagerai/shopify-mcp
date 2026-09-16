# Security policy

ShopManager AI asks for access to a Shopify store, so this document is specific
about what that access is, what this build can do with it, and what it cannot.

## Reporting a vulnerability

Report privately. Do not open a public issue.

- **GitHub private vulnerability reporting** (preferred): the *Report a
  vulnerability* button under this repository's **Security** tab.
- **Email**: security@shopmanagerai.com

Please include reproduction steps, the affected version or commit, and the
impact you believe it has.

| | |
| --- | --- |
| Acknowledgement | within 3 business days |
| Initial assessment | within 10 business days |
| Fix or mitigation | within 90 days, coordinated disclosure after that |

We will credit you in the release notes unless you would rather stay anonymous.

## Supported versions

This repository tracks the current release. Security fixes land on the latest
version; there are no long-term support branches yet.

## What this build can do

This is the Free build, and it is **read-only against Shopify**.

- No tool here writes a theme file, product, collection, page, article, menu,
  metafield, order, or customer.
- The tools that write at all write to **this server's own state**: saved
  memories, skills, snapshots and the operation ledger.
- Two tools reach Shopify to change something narrow and deliberate:
  `shopify.auth.disconnect` (revokes this server's own access) and
  `commerce.settings.storefront_password` (the storefront preview password).
- `commerce.change.apply` runs another tool through the policy pipeline. It
  cannot reach a tool that is not registered, and no registered tool here
  mutates store data, so it cannot be used to escape the read-only boundary.

This is enforced, not just documented.
[`scripts/assert-free-only.mjs`](scripts/assert-free-only.mjs) runs in CI
against the registry the server actually builds and fails if any tool declares
a Shopify write, a theme write, or a non-Free tier.

## Shopify access scopes

The app requests 17 scopes, **all read-only**:

```
read_checkout_branding_settings,read_content,read_discounts,read_files,read_inventory,read_locales,read_locations,read_markets,read_metaobject_definitions,read_metaobjects,read_online_store_navigation,read_pixels,read_products,read_publications,read_script_tags,read_themes,read_translations
```

That list is generated from what the 122 shipped tools declare, and CI
regenerates it. A write scope appearing here would fail the build.

## Theme Access credentials: read this

Theme file reads go through Shopify's Theme Access proxy.

> **Important.** A Theme Access password issued by Shopify carries
> `write_themes` capability at the Shopify credential level. ShopManager AI
> Free enforces read-only theme behavior in its own tool and policy layer and
> ships no theme-mutation tool at all, but the credential you paste in is more
> powerful than what this build uses it for.

Treat it as a secret:

- It is encrypted at rest with `SHOPMANAGER_MASTER_KEY` before being stored.
- It is never returned by any tool, never logged, and never sent to a client.
- Revoke it any time from the Theme Access app in your Shopify admin. Doing so
  disables theme tools here and nothing else.
- Uninstalling the app clears the stored copy.

## Architecture and data handling

- **Authentication.** OAuth 2.1 with PKCE for installs; long-lived `cp_`
  bearer tokens for MCP clients, created and revocable in the admin UI. A
  missing or invalid token gets `401` with a `WWW-Authenticate` challenge.
- **Secrets at rest.** Shopify tokens and Theme Access passwords are encrypted
  with a master key from `SHOPMANAGER_MASTER_KEY`. In development a key is
  generated on disk and the server warns about it; set the variable in
  production.
- **Where data lives.** Self-hosted: everything stays in `DATA_DIR` (SQLite)
  or your Postgres. Nothing is sent to us. See [PRIVACY.md](PRIVACY.md).
- **Rate limiting.** Per credential, `MCP_RATE_LIMIT_PER_MIN`, default 600.
- **Audit.** Every tool call is recorded in the operation ledger with its risk
  level and any changes it made.
- **Webhooks.** Shopify webhook bodies are HMAC-verified before processing.

## Prompt injection and untrusted content

Tools return store content: product descriptions, theme files, blog articles.
That content is written by other people and must be treated as **data, not
instructions**. A malicious theme comment or product description could try to
tell the assistant to do something.

This build's main defence is structural: the assistant cannot act destructively
through it, because there is nothing destructive to reach. Still:

- Read tool output as data. Do not let an assistant act on instructions it
  found inside store content.
- Keep the read-only build for exploration and review.
- Review any diff before applying it somewhere that can write.

## Dependencies

Dependabot is enabled for npm and GitHub Actions. Run `pnpm audit` locally.
Report a vulnerable dependency through the process above rather than opening a
public issue.
