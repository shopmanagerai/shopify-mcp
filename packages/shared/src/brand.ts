/**
 * Single source of truth for user-facing product naming.
 *
 * User-facing values (name, shortName, domain, siteUrl) may change freely.
 * The internal identifiers below MUST NOT change without a migration:
 *   - tokenPrefix: baked into every issued MCP credential already in the wild
 *   - npmScope:    the workspace package scope (@shopmanagerai/*)
 *   - resourceScheme: the `commerce.*` tool-name namespace
 */
export const BRAND = {
  name: "ShopManager AI",
  shortName: "ShopManager",
  slug: "shopmanagerai",
  domain: "shopmanagerai.com",
  siteUrl: "https://shopmanagerai.com",
  /** internal, do not change: existing credentials carry this prefix */
  tokenPrefix: "cp_",
  /** internal, do not change: workspace package scope */
  npmScope: "@shopmanagerai",
  /** internal, do not change: `commerce.*` tool namespace */
  resourceScheme: "commerce",
} as const;

export const PRODUCT_VERSION = "0.1.0";
