/**
 * Freemius webhook ingestion + admin-facing entitlement endpoints
 * (docs/freemius-pro.md). The webhook route needs the raw request body for
 * HMAC verification, so it is mounted directly on `app` (not inside a JSON
 * body-parsing middleware chain), see mountWebhooks for the same pattern
 * used by Shopify's own webhook route.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ShopManagerAIError, ERROR_CODES, isShopManagerAIError, toShopManagerAIError } from "@shopmanagerai/shared";
import type { Container } from "../container.js";
import { SHOPIFY_BILLING_TAG, shopifyPricingUrl, syncShopifySubscription } from "../shopify/billing.js";
import { verifyAdminSession } from "../auth/shopify.js";

function errResponse(c: any, e: unknown) {
  const cpErr = isShopManagerAIError(e) ? e : toShopManagerAIError(e);
  return c.json({ ok: false, code: cpErr.code, message: cpErr.message }, cpErr.httpStatus as any);
}

async function requireShopId(container: Container, c: any): Promise<string> {
  const session = await verifyAdminSession(container, c);
  if (!session) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Not authenticated.", { httpStatus: 401 });
  return session.shopId;
}

export function mountEntitlementApi(app: Hono, container: Container): void {
  app.post("/freemius/webhook", async (c) => {
    if (!container.freemiusWebhook) {
      // Freemius is not configured on this deployment; acknowledge so Freemius
      // does not keep retrying, but do nothing.
      return c.json({ ok: true, skipped: "not_configured" });
    }
    const rawBody = await c.req.text();
    // UNVERIFIED: the exact header Freemius signs with. We accept either of
    // the two names seen in different integration guides.
    const signature = c.req.header("x-freemius-signature") ?? c.req.header("x-signature") ?? undefined;
    const result = await container.freemiusWebhook.handle(rawBody, signature);
    if (!result.ok) {
      container.log.warn("freemius webhook rejected", { code: result.code, message: result.message });
      return c.json({ ok: false, code: result.code, message: result.message }, 401);
    }
    return c.json({ ok: true, skipped: result.skipped });
  });

  const api = new Hono();

  api.get("/entitlement", async (c) => {
    try {
      const shopId = await requireShopId(container, c);
      await syncShopifySubscription(container, shopId).catch(() => undefined);
      const state = await container.entitlements.getState(shopId);
      const shop = await container.shopService.getById(shopId);
      const row = await container.entitlementRepo.get(shopId);
      return c.json({
        shopifyPricingUrl: shop ? shopifyPricingUrl(container, shop.domain) : null,
        billedVia: row?.freemiusUserId === SHOPIFY_BILLING_TAG ? "shopify" : row?.freemiusUserId?.startsWith("account:") ? "account" : row?.licenseRef ? "license" : null,
        state: state.state,
        plan: state.plan,
        entitlements: state.entitlements,
        seats: state.seats,
        graceUntil: state.graceUntil,
        upgradeUrl: state.upgradeUrl,
        activationUrl: `${container.config.appUrl}/activate?shop=${shopId}`,
      });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const ActivateBody = z.object({ licenseKey: z.string().min(1) });

  api.post("/entitlement/activate", async (c) => {
    try {
      const shopId = await requireShopId(container, c);
      if (!container.licenseActivation) {
        throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Freemius is not configured on this deployment.");
      }
      const { licenseKey } = ActivateBody.parse(await c.req.json());
      const result = await container.licenseActivation.activateKey(shopId, licenseKey);
      if (!result.ok) {
        return c.json({ ok: false, reason: result.reason, message: result.message }, 422);
      }
      container.invalidateEntitlementsCache(shopId);
      const state = await container.entitlements.getState(shopId);
      return c.json({ ok: true, state: state.state, plan: state.plan, entitlements: state.entitlements });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/entitlement/deactivate", async (c) => {
    try {
      const shopId = await requireShopId(container, c);
      if (!container.licenseActivation) {
        throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Freemius is not configured on this deployment.");
      }
      await container.licenseActivation.deactivate(shopId);
      container.invalidateEntitlementsCache(shopId);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  app.route("/api/admin", api);
}
