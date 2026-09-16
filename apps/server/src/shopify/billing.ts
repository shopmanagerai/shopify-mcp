/**
 * Shopify App Pricing (managed pricing) sync. Plans are defined in the Partner Dashboard; Shopify
 * hosts the checkout at admin.shopify.com/store/<handle>/charges/<app-handle>/pricing_plans. We only
 * read the store's active app subscription and project it onto the shop's entitlement row, tagged
 * `freemius_user_id = "shopify"` so it never fights with an account-level (Freemius) seat.
 *
 * Runs on: OAuth install/reinstall, the `app_subscriptions/update` webhook, and every embedded-admin
 * entitlement read (cheap query, cached 60 s).
 */
import { describeError, type AdminClient } from "@shopmanagerai/shared";
import type { Container } from "../container.js";

export const SHOPIFY_BILLING_TAG = "shopify";

const SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query CurrentAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
      }
    }
  }
`;

export interface ShopifySubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
}

export async function fetchActiveSubscriptions(admin: AdminClient): Promise<ShopifySubscription[]> {
  const res = await admin.query<{ currentAppInstallation: { activeSubscriptions: ShopifySubscription[] } }>(SUBSCRIPTIONS_QUERY, {}, { cost: 5 });
  return res.data?.currentAppInstallation?.activeSubscriptions ?? [];
}

/** Seats a Shopify plan grants. Store-level plans are single-store; the name decides the tier label. */
export function tierFromPlanName(name: string): { state: "PRO_ACTIVE" | "AGENCY_ACTIVE"; plan: string } {
  const n = name.toLowerCase();
  if (/agency/.test(n)) return { state: "AGENCY_ACTIVE", plan: "shopify:agency" };
  return { state: "PRO_ACTIVE", plan: `shopify:${n.replace(/\s+/g, "-") || "pro"}` };
}

export function shopifyPricingUrl(container: Container, shopDomain: string): string | null {
  const handle = container.config.shopify.appHandle;
  if (!handle) return null;
  const store = shopDomain.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${store}/charges/${handle}/pricing_plans`;
}

const lastSync = new Map<string, number>();

/**
 * Reads the store's active subscription and updates the entitlement row. Returns the effective
 * state. Never downgrades a row owned by an account seat or a Freemius licence.
 */
export async function syncShopifySubscription(container: Container, shopId: string, opts: { force?: boolean } = {}): Promise<{ state: string; subscription: ShopifySubscription | null }> {
  const existing = await container.entitlementRepo.get(shopId);
  const ownedByShopify = !existing || existing.freemiusUserId === SHOPIFY_BILLING_TAG || existing.state === "FREE";
  const now = Date.now();
  if (!opts.force && (lastSync.get(shopId) ?? 0) > now - 60_000) {
    return { state: existing?.state ?? "FREE", subscription: null };
  }
  lastSync.set(shopId, now);

  if (container.config.demo) return { state: existing?.state ?? "FREE", subscription: null };
  const planes = await container.shopService.planesFor(shopId).catch(() => null);
  if (!planes?.admin) return { state: existing?.state ?? "FREE", subscription: null };

  let subs: ShopifySubscription[] = [];
  try {
    subs = await fetchActiveSubscriptions(planes.admin);
  } catch (e) {
    container.log.warn("shopify billing: subscription query failed", { shopId, error: describeError(e) });
    return { state: existing?.state ?? "FREE", subscription: null };
  }
  const active = subs.find((s) => s.status === "ACTIVE") ?? null;

  if (active) {
    if (!ownedByShopify) return { state: existing!.state, subscription: active }; // account seat / Freemius wins
    const tier = tierFromPlanName(active.name);
    if (existing?.state !== tier.state || existing?.licenseRef !== `shopify:${active.id}`) {
      await container.entitlementRepo.upsert({ shopId, state: tier.state, plan: tier.plan, seats: { shops: 1, members: 1 }, licenseRef: `shopify:${active.id}`, freemiusUserId: SHOPIFY_BILLING_TAG, freemiusLicenseId: null, graceUntil: null });
      container.invalidateEntitlementsCache(shopId);
      container.log.info("shopify billing: subscription active", { shopId, plan: active.name, test: active.test });
    }
    return { state: tier.state, subscription: active };
  }

  if (existing && existing.freemiusUserId === SHOPIFY_BILLING_TAG && existing.state !== "FREE") {
    await container.entitlementRepo.upsert({ shopId, state: "FREE", plan: null, seats: null, licenseRef: null, freemiusUserId: null, graceUntil: null });
    container.invalidateEntitlementsCache(shopId);
    container.log.info("shopify billing: subscription ended", { shopId });
    return { state: "FREE", subscription: null };
  }
  return { state: existing?.state ?? "FREE", subscription: null };
}
