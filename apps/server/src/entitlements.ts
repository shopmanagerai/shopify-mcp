/**
 * Entitlement provider selection. When FREEMIUS_PRODUCT_ID is configured, a
 * real FreemiusEntitlementProvider (backed by the `entitlements` table) is
 * used; otherwise every shop is FREE forever via NullEntitlementProvider.
 * Both implement the same @shopmanagerai/shared `EntitlementProvider`
 * interface, so the rest of the server never needs to know which is active.
 */
import { BRAND, type Entitlement, type EntitlementProvider, type EntitlementState } from "@shopmanagerai/shared";
import type { EntitlementRepo } from "@shopmanagerai/storage";
import { FreemiusEntitlementProvider } from "@shopmanagerai/entitlement-freemius";
import type { Logger } from "@shopmanagerai/shared";
import type { ShopManagerAIConfig } from "./config.js";

const FREE_ENTITLEMENTS: Entitlement[] = ["free.core", "free.theme", "free.catalog", "free.seo_basic", "free.visual_capture"];

export class NullEntitlementProvider implements EntitlementProvider {
  async getState(_shopId: string): Promise<{ state: EntitlementState; plan?: string; entitlements: Entitlement[]; upgradeUrl: string }> {
    return {
      state: "FREE",
      plan: "free",
      entitlements: FREE_ENTITLEMENTS,
      upgradeUrl: `https://${BRAND.domain}/upgrade`,
    };
  }

  async has(_shopId: string, e: Entitlement): Promise<boolean> {
    return FREE_ENTITLEMENTS.includes(e);
  }
}

let nullProviderLogged = false;

/** Picks NullEntitlementProvider or FreemiusEntitlementProvider based on config. */
export function buildEntitlementProvider(
  config: ShopManagerAIConfig,
  repo: EntitlementRepo,
  log: Logger,
): NullEntitlementProvider | FreemiusEntitlementProvider {
  if (!config.freemius.productId) {
    if (!nullProviderLogged) {
      log.info("entitlements: FREEMIUS_PRODUCT_ID not set; every shop is FREE (NullEntitlementProvider).");
      nullProviderLogged = true;
    }
    return new NullEntitlementProvider();
  }
  return new FreemiusEntitlementProvider(repo, { upgradeUrl: config.upgradeUrl });
}
