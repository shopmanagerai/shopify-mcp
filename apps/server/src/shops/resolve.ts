/**
 * Resolves the `:shop` URL segment (e.g. `/mcp/{shop}`) to a shop row. For
 * real shops, `shopId === domain` (the full `*.myshopify.com` domain), set
 * that way at install time in auth/shopify.ts. The demo shop is the literal
 * segment "demo" or its full domain.
 */
import type { ShopRow } from "@shopmanagerai/storage";
import { DEMO_SHOP_DOMAIN, DEMO_SHOP_ID } from "./service.js";
import type { ShopService } from "./service.js";

export function domainFor(handle: string): string {
  if (handle === DEMO_SHOP_ID || handle === DEMO_SHOP_DOMAIN) return DEMO_SHOP_DOMAIN;
  return handle.includes(".") ? handle : `${handle}.myshopify.com`;
}

export async function resolveShop(shopService: ShopService, handle: string): Promise<ShopRow | null> {
  const domain = domainFor(handle);
  if (domain === DEMO_SHOP_DOMAIN) return shopService.getByDomain(domain);
  return shopService.getByDomain(domain);
}
