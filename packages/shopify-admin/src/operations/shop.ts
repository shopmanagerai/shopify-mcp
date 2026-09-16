/**
 * Shop summary (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Shop / config" row).
 * Fields kept to those documented on the `Shop` object; `passwordEnabled` is
 * UNVERIFIED as a direct field name on `shop` in current API versions (some
 * versions expose storefront password state elsewhere), so it stays optional
 * and is read defensively.
 */
import type { AdminClient } from "@shopmanagerai/shared";

export const SHOP_SUMMARY_QUERY = /* GraphQL */ `
  query ShopSummary {
    shop {
      name
      myshopifyDomain
      primaryDomain {
        url
      }
      plan {
        displayName
      }
      currencyCode
    }
  }
`;

export interface ShopSummaryResult {
  name: string;
  myshopifyDomain: string;
  primaryDomainUrl?: string;
  planDisplayName?: string;
  currencyCode?: string;
  /** UNVERIFIED: not queried by default; populate if/when confirmed available. */
  passwordEnabled?: boolean;
}

export async function fetchShopSummary(client: AdminClient): Promise<ShopSummaryResult> {
  const result = await client.query<{
    shop: {
      name: string;
      myshopifyDomain: string;
      primaryDomain?: { url?: string } | null;
      plan?: { displayName?: string } | null;
      currencyCode?: string;
    };
  }>(SHOP_SUMMARY_QUERY, undefined, { cost: 1 });

  const shop = result.data.shop;
  return {
    name: shop.name,
    myshopifyDomain: shop.myshopifyDomain,
    primaryDomainUrl: shop.primaryDomain?.url ?? undefined,
    planDisplayName: shop.plan?.displayName ?? undefined,
    currencyCode: shop.currencyCode ?? undefined,
  };
}
