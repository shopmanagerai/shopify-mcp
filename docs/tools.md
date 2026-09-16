# Shopify MCP Tools

Every tool in the open-source build: **122 tools**, all read-only against
Shopify. This page is generated from
[`tools-manifest.json`](../tools-manifest.json), which carries the full input
and output schemas, required Shopify scopes, risk class and data categories
for each one.

Tools are addressed by name through the `execute-tool` meta-tool, or directly
when the server is running with `?surface=flat`. See
[Connect your AI client](../README.md#connect-claude-chatgpt-cursor-codex-and-vs-code).

## Categories

| Category | Tools |
| --- | ---: |
| [Theme inspection, files and Theme Check](#theme-inspection-files-and-theme-check) | 23 |
| [Catalog and content](#catalog-and-content) | 19 |
| [Store configuration and commerce](#store-configuration-and-commerce) | 19 |
| [System, health and diagnostics](#system-health-and-diagnostics) | 17 |
| [Change planning, ledger and export](#change-planning-ledger-and-export) | 11 |
| [Memory and skills](#memory-and-skills) | 11 |
| [Sections, blocks, templates and Liquid](#sections-blocks-templates-and-liquid) | 9 |
| [Auth and capability probes](#auth-and-capability-probes) | 7 |
| [Snapshots](#snapshots) | 6 |

## Theme inspection, files and Theme Check

| Tool | What it does | Reads |
| --- | --- | --- |
| `shopify.theme_check.inspect_issue` | Runs Theme Check and returns detail for offenses matching a given check name and/or file. | theme files |
| `shopify.theme_check.list_checks` | Lists the Theme Check check names this environment's @shopify/theme-check-node can run, derived by running it once against the given theme (or a minimal built-in theme skeleton). | theme files |
| `shopify.theme_check.run` | Runs Theme Check, optionally scoped to a subset of file keys and/or filtered by minimum severity. | theme files |
| `shopify.theme_check.summary` | Runs Theme Check across a theme's files and returns offense counts by severity, plus the full offense list. | theme files |
| `shopify.theme.architecture` | Extracts a theme's static architecture: layouts, templates, sections, blocks, snippets, assets, config, locales, warnings. | theme files (redacted) |
| `shopify.theme.assets` | Lists a theme's asset files. | theme files (redacted) |
| `shopify.theme.blocks` | Lists a theme's standalone block files. | theme files (redacted) |
| `shopify.theme.config` | Summarizes config/settings_schema.json: setting groups and their setting ids/types. | theme files |
| `shopify.theme.current` | Returns the store's live theme and the current working (unpublished ShopManager) theme, if any. | theme list |
| `shopify.theme.dependencies` | Shows what a given theme file references and what references it, via the theme dependency graph. | theme files |
| `shopify.theme.file.diff` | Diffs one file's content between two themes, or between a theme and a snapshot. | theme file content (redacted), snapshot data |
| `shopify.theme.file.read` | Reads one theme file's contents, with secrets redacted. Binary files return metadata only. | theme file content (redacted) |
| `shopify.theme.file.search` | Searches a theme's files by text/regex query, optionally scoped to directories. | theme file content (redacted) |
| `shopify.theme.find_reference` | Finds where a symbol (settings id, section/snippet name, CSS class, or JS id) is referenced across the theme. | theme file content (redacted) |
| `shopify.theme.inspect` | Combined theme overview: ThemeRef metadata, file counts by role, and an architecture summary. | theme list, theme files (redacted) |
| `shopify.theme.list_remote` | Lists all themes on the store (id, name, role, processing state). | theme list |
| `shopify.theme.locales` | Lists a theme's locale (translation) files. | theme files (redacted) |
| `shopify.theme.preview` | Returns a preview URL for a theme (defaults to the working theme). | theme metadata |
| `shopify.theme.search` | Text/regex search over a theme's files. | theme file content (redacted) |
| `shopify.theme.sections` | Lists a theme's section files. | theme files (redacted) |
| `shopify.theme.settings` | Current config/settings_data.json values, plus the app blocks/embeds referenced within it. | theme settings |
| `shopify.theme.snippets` | Lists a theme's snippet files. | theme files (redacted) |
| `shopify.theme.templates` | Lists a theme's JSON + Liquid template files. | theme files (redacted) |

## Catalog and content

| Tool | What it does | Reads |
| --- | --- | --- |
| `shopify.article.get` | Reads a single article's body, isPublished, and seo. | article detail |
| `shopify.articles.list` | Lists articles, optionally scoped to a blog, paginated. | articles |
| `shopify.blog.get` | Reads a single blog. | blog |
| `shopify.blogs.list` | Lists blogs, paginated. | blogs |
| `shopify.collection.get` | Reads a collection: description, seo, image, ruleSet (if smart), metafields, and its products. | collection detail |
| `shopify.collections.list` | Lists/searches collections, paginated. | collection summaries |
| `shopify.media.list` | Lists files in the Files library, paginated. | files |
| `shopify.metafields.definitions` | Lists metafield definitions for an owner type, paginated. | metafield definitions |
| `shopify.metafields.list` | Lists the metafields set on a specific owner (product, collection, page, article, etc.), paginated. | metafields |
| `shopify.metaobjects.definitions` | Lists metaobject definitions, paginated. | metaobject definitions |
| `shopify.metaobjects.list` | Lists metaobject entries of a given type, paginated. | metaobjects |
| `shopify.navigation.get` | Reads a menu's full nested item tree. | menu tree |
| `shopify.navigation.list` | Lists navigation menus (main-menu, footer, etc.), paginated. | menus |
| `shopify.page.get` | Reads a page's body, isPublished, templateSuffix, and seo. | page detail |
| `shopify.pages.list` | Lists/searches Online Store pages, paginated. | pages |
| `shopify.product.get` | Reads a single product: core fields, seo, variants, media count, collections, publications count. | product detail |
| `shopify.products.list` | Lists/searches products (Shopify search-syntax `query`), paginated. | product summaries |
| `shopify.publications.list` | Lists sales channel publications and, when a product id is given, whether that product is published to each. | publications |
| `shopify.redirects.list` | Lists URL redirects, paginated. | url redirects |

## Store configuration and commerce

| Tool | What it does | Reads |
| --- | --- | --- |
| `shopify.app.inspect` | Looks up a known app by handle and reports its theme-detected evidence, if any. | theme files, known app registry |
| `shopify.catalogs.list` | Lists catalogs (market, B2B company-location or app catalogs) with status, linked price list, publication and markets. | - |
| `shopify.checkout.profiles` | Lists checkout profiles (published + drafts) and whether the new thank-you / order-status pages are active. Requires access to the checkout editor; Shopify is moving this to checkoutAndAccountsConfigurations. | - |
| `shopify.discounts.get` | Reads one discount node (code or automatic). | - |
| `shopify.discounts.list` | Lists code and automatic discounts (basic amount-off, buy-X-get-Y, free shipping, app/Functions discounts) with status, schedule, usage, codes and combination rules. Shopify search syntax in `query` (status:active, discount_type:percentage, title:…). | - |
| `shopify.functions.list` | Lists Shopify Functions deployed by this app (id, title, API type, API version, whether merchants configure it in admin). Function ids are needed by functions.attach. | - |
| `shopify.inventory.get` | Inventory per variant per location for one product: available, on_hand, committed (and any other named quantity you ask for), plus the inventoryItemId and tracked flag the write tools need. | - |
| `shopify.locales.list` | Lists shop locales (languages): primary, enabled, published. A locale must be enabled before translations register and published before buyers see it. | - |
| `shopify.locations.list` | Lists the shop's locations (warehouses, retail stores, apps that stock inventory) with active/fulfils-online-orders flags. Needed for every inventory write. | - |
| `shopify.markets.get` | Reads one market with regions, currency settings, web presences and catalogs. | - |
| `shopify.markets.list` | Lists Shopify Markets: regions (country codes), status, base currency / local currencies, web presences (domain or subfolder, default + alternate locales, root URLs) and linked catalogs. | - |
| `shopify.pixels.get` | Reads this app's web pixel (an app can have exactly one, backed by a web_pixel_extension) and its settings JSON. | - |
| `shopify.price_lists.list` | Lists price lists: currency, parent adjustment (percentage increase/decrease over base prices), catalog and count of fixed prices. | - |
| `shopify.price_lists.prices` | Lists the prices in a price list (fixed and adjusted) per variant. | - |
| `shopify.script_tags.list` | Lists legacy ScriptTags installed on the store (src, display scope). ScriptTags are deprecated and stop loading on 2027-03-01; each one is an app that has not migrated to app embeds / web pixels. | - |
| `shopify.store.summary` | Basic store facts: name, domain, plan, currency, password protection, theme count. | shop object |
| `shopify.translations.get` | Reads the translatable content of one resource (product, collection, page, article, menu, metafield, shop, theme…): keys, source values, digests (needed to register), and the existing translations for a locale (optionally market-scoped). | - |
| `shopify.translations.list` | Lists translatable resources of one type (PRODUCT, COLLECTION, PAGE, ARTICLE, BLOG, MENU, ONLINE_STORE_THEME, METAFIELD, METAOBJECT, SHOP, …) with their content digests and, when a locale is given, what is already translated. | - |
| `shopify.webhooks.list` | Lists this app's webhook subscriptions: topic, delivery uri (HTTPS / Pub/Sub / EventBridge), format, includeFields, filter, API version. Only subscriptions created by this app are visible (Shopify scopes webhooks per app). | - |

## System, health and diagnostics

| Tool | What it does | Reads |
| --- | --- | --- |
| `commerce.api.capabilities` | Lists the Shopify Admin API capabilities this server relies on (mutations, queries, platform features) with minimum API version, deprecation/replacement, required scopes, protected-customer-data and plan gating, and whether each is available for the connected store right now, with the exact reason when it is not. Use it before attempting Markets, checkout, Functions, orders or customer work. | granted scopes, shop plan |
| `commerce.capabilities` | Returns the store capabilities discovered for this credential, plus registered tool counts by availability. | store capability probes |
| `commerce.config.get` | Returns this shop's stored configuration/settings, if a settings service is wired up. | shop configuration |
| `commerce.config.validate` | Validates a proposed configuration patch without applying it. | shop configuration |
| `commerce.connections` | Lists which AI clients (Claude Code, Cursor, Codex, etc.) have actually reached the MCP endpoint for this shop, and how much. One row per credential+client pair. Never returns secrets, tokens, or IPs. | connection metadata |
| `commerce.diagnostics` | Aggregates health, capabilities, and entitlement state into a single diagnostics report. | connectivity, store capability probes, entitlement state |
| `commerce.diagnostics.api` | Admin API health for this shop: reachable, API version in use vs the app's configured version, granted access scopes (from currentAppInstallation), throttle status from the last call, active app subscriptions. MANUAL findings for version drift. | - |
| `commerce.diagnostics.extensions` | What this app has deployed on the store: web pixel (and settings), Shopify Functions with what they are attached to (discount/transform/validation via the admin), checkout profiles, plus recommendations (no pixel → scaffold, no functions → what would help). | - |
| `commerce.diagnostics.permissions` | Scope gap analysis: compares the scopes granted to this install (credential + currentAppInstallation) with the app's configured scope list and with every registered tool's requiredShopifyScopes, and lists which tool families are blocked and by which scope. AUTO_FIX_SAFE = reconnect with the configured scope set. | - |
| `commerce.diagnostics.tracking` | Alias of shopify.tracking.audit inside the diagnostics family (theme trackers, duplicates, consent, script tags, pixel). | - |
| `commerce.diagnostics.webhooks` | Alias of shopify.webhooks.health inside the diagnostics family. | - |
| `commerce.entitlements` | Returns this shop's entitlement state (FREE/TRIAL/PRO_ACTIVE/...), plan, and entitlement list. | entitlement state |
| `commerce.environment` | Returns the configured Shopify Admin API version, demo-mode flag, and execution era. | - |
| `commerce.health` | Runs cheap reachability checks: theme engine, admin API, browser plane, ledger writability. | connectivity |
| `commerce.privacy.explain` | Explains what data a given tool reads, writes, stores, and returns to the client. | tool registry |
| `commerce.settings.storefront_password` | Stores (or clears) the storefront password for this shop, encrypted at rest, so visual capture, audits and the design loop can screenshot a password-protected storefront without the password being passed on every call. The password is never returned. **(writes local state)** | - |
| `commerce.version` | Returns the product brand, product version, and supported MCP protocol versions. | - |

## Change planning, ledger and export

| Tool | What it does | Reads |
| --- | --- | --- |
| `commerce.change.apply` | Applies a mutation through the full pipeline (identical to calling the tool directly) and returns the ledger operation id, changes, evidence and rollback info. Pass approvalToken when change.validate said one is required. **(writes local state)** | - |
| `commerce.change.diff` | Returns the recorded before/after diffs for a ledger operation (every change with its resource, kind, unified diff and fingerprints). | ledger |
| `commerce.change.plan` | Plans a mutation without applying it: runs the target tool in dryRun mode through the full policy pipeline and returns the would-be changes, diffs, risk level, whether confirmation/approval will be needed, and the rollback strategy. Use before change.apply for anything that writes. | target tool dry run |
| `commerce.change.validate` | Validates a mutation without running it: schema check plus the full policy evaluation (tier, scopes, protected data, plan, capabilities, profile, approval). Returns exactly why it would be refused, or the effective risk and approval requirement if it would run. | policy |
| `commerce.export` | Exports the ledger, the last stored store audit, a design manifest, the app preservation manifest, or a job report as JSON or Markdown. | ledger, job records, design manifests |
| `commerce.operation.approve` | Mints an approval token for a specific tool + input plan hash, so a subsequent call can carry out a publish/critical-risk operation. Only the admin profile may call this. | - |
| `commerce.operation.cancel` | Cancels a running task-mode operation (job), if the job engine is configured. **(writes local state)** | job state |
| `commerce.operation.get` | Fetches one operation record from the ledger by id. | operation ledger |
| `commerce.operation.list` | Lists operations for this shop, optionally filtered by tool or status. | operation ledger |
| `commerce.operations.list` | Alias-style bulk listing of operations for this shop (same as commerce.operation.list). | operation ledger |
| `shopify.store.job_status` | Reads back a shopify.store.* job record (stages + result) by jobId. | job record |

## Memory and skills

| Tool | What it does | Reads |
| --- | --- | --- |
| `commerce.memory.delete` | Permanently deletes a memory (and its version history). Use when a memory is wrong, outdated, or the user asks you to forget it. Requires confirm:true. | - |
| `commerce.memory.get` | Returns the full content of a single memory by id or name. | memory content |
| `commerce.memory.list` | Returns the concise memory index (id, name, description, type, version, updatedAt) for every stored memory, optionally filtered by type. | memory index |
| `commerce.memory.restore` | Restores a memory to a past version (recorded as a new version, a "reroll" rather than a rewind). **(writes local state)** | memory version history |
| `commerce.memory.save` | Creates a new memory or updates an existing one. You have a persistent, database-backed memory system scoped to this store. Build it up over time so future conversations can start with a complete picture of who the user is, how they collaborate with you, what to avoid or repeat, and the context behind the work. If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, call commerce.memory.delete. ## Types of memory - user, Role, goals, responsibilities, knowledge, preferences. Save when you learn details about who the user is. Avoid negative judgments. - feedback, Guidance the user has given about how to approach work. Save from BOTH correction ("no, not that") AND confirmation ("yes exactly", accepting an unusual choice without pushback). Structure: rule, then **Why:** and **How to apply:** lines. - project, Ongoing work, goals, bugs, decisions that aren't derivable from the store or its history. Convert relative dates to absolute dates before saving. - reference, Pointers to where information lives in external systems (a Linear project, a dashboard). - design, A block/section subtree in this store's own design vocabulary: what a pricing tier, hero, or testimonial set on this store is actually made of. Kept per store rather than shipped as a generic template. ## What NOT to save - Theme code, product data, or credentials, read those live from the store; a memory is not a cache and can go stale in a way that misleads instead of helps. - Anything derivable from the live store (current inventory, current theme files, current settings). - Debugging solutions or fix recipes, the fix is in the code; there is no commit history to point to here, so restate the reasoning inline instead of citing one. - Ephemeral task state: in-progress work, current conversation context. ## How to save 1. Check the memory index (either from discover-tools or by calling commerce.memory.list) first, prefer UPDATING (pass id) over creating duplicates. 2. Call commerce.memory.save with name, description (a specific one-line hook. This is how future-you decides relevance), type, and content. 3. Organize memories semantically by topic, not chronologically. 4. If a memory turns out to be wrong or outdated, update or delete it, don't accumulate stale entries. **(writes local state)** | - |
| `commerce.memory.versions` | Lists the version history of a memory, newest first (up to the last 50 saves). | memory version history |
| `commerce.skills.delete` | Permanently deletes a custom skill. Requires confirm:true. | - |
| `commerce.skills.enable` | Enables or disables a skill (hides disabled skills from MCP prompts/list). **(writes local state)** | - |
| `commerce.skills.get` | Returns one skill's full body by name. | skill definition |
| `commerce.skills.list` | Lists this shop's skills (built-in file skills plus custom/overridden DB skills), including enabled state. | skill definitions |
| `commerce.skills.write` | Creates or updates a custom skill for this shop (becomes a custom copy if it overrides a built-in name). **(writes local state)** | - |

## Sections, blocks, templates and Liquid

| Tool | What it does | Reads |
| --- | --- | --- |
| `shopify.block.inspect` | Inspects a section/block/template file: content summary, schema (for liquid), or structure (for JSON templates). | theme file content |
| `shopify.block.schema` | Returns the {% schema %} block (parsed JSON) for a section/block, or the root structure for a template. | theme file content |
| `shopify.liquid.inspect` | Full Liquid inspection: renders, sections, schema, tags, filters, variables, nesting depth. | theme file content |
| `shopify.liquid.parse` | Parses a Liquid file and returns line count and parse errors. | theme file content |
| `shopify.liquid.validate` | Validates a Liquid file: true if it parses with no errors (including schema JSON errors). | theme file content |
| `shopify.section.inspect` | Inspects a section/block/template file: content summary, schema (for liquid), or structure (for JSON templates). | theme file content |
| `shopify.section.schema` | Returns the {% schema %} block (parsed JSON) for a section/block, or the root structure for a template. | theme file content |
| `shopify.template.inspect` | Inspects a section/block/template file: content summary, schema (for liquid), or structure (for JSON templates). | theme file content |
| `shopify.template.schema` | Returns the {% schema %} block (parsed JSON) for a section/block, or the root structure for a template. | theme file content |

## Auth and capability probes

| Tool | What it does | Reads |
| --- | --- | --- |
| `shopify.auth.connect` | Returns an admin URL to complete or extend the store's connection to ShopManager AI. Never accepts secrets as input. | - |
| `shopify.auth.disconnect` | Disconnecting is only available from the Shopify admin UI, not through MCP. | - |
| `shopify.auth.doctor` | Actionable checklist of what's wrong with this credential's setup and what to do about it. | credential metadata, connectivity |
| `shopify.auth.permissions` | Returns the full set of Shopify scopes and store capabilities available to this credential. | credential metadata |
| `shopify.auth.status` | Reports what kinds of access this credential has (admin, theme write) and the scopes granted, without ever revealing secrets. | credential metadata |
| `shopify.auth.validate` | Probes the theme engine (list themes) and admin API (shop query) to confirm the credential actually works. | connectivity |
| `shopify.store.capabilities` | Store-level capabilities only (admin.read/write). | store capability probes |

## Snapshots

| Tool | What it does | Reads |
| --- | --- | --- |
| `commerce.rollback.plan` | Plans how a given operation would be rolled back, without executing it. | operation ledger, snapshot metadata |
| `commerce.rollback.verify` | Verifies whether a rollback for an operation was fully applied (all planned steps restored, no residual diff). | operation ledger, theme files |
| `commerce.snapshot.create` | Creates a point-in-time snapshot of a theme's files (kind:'theme'), for use as a rollback target. | theme files |
| `commerce.snapshot.diff` | Diffs two theme file sets, where each side is either a snapshot id or a live theme id. | snapshot data, theme files |
| `commerce.snapshot.get` | Fetches metadata for one snapshot by id. | snapshot metadata |
| `commerce.snapshot.list` | Lists snapshots for this shop, optionally filtered by kind. | snapshot metadata |

## Risk classes

Every tool declares a risk class, and the server derives its MCP annotations
from it, so a client can filter on `readOnlyHint` rather than trusting prose.

| Risk class | Meaning in this build |
| --- | --- |
| `read` | Cannot change anything |
| `write` | Changes this server's own state, never Shopify content |
| `destructive` | Deletes something this server stores, such as a memory or skill |
| `commerce_sensitive` | Touches the operation ledger's approval flow |

No tool in this build carries `theme_write` or `publish`, and CI fails if one
ever does. See [SECURITY.md](../SECURITY.md).

