/**
 * Webhook receiver (task brief §5). HMAC-SHA256 verified (constant-time),
 * deduped by X-Shopify-Webhook-Id via the kv table.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { KvRepo } from "@shopmanagerai/storage";
import type { Container } from "./container.js";
import { syncShopifySubscription } from "./shopify/billing.js";

function verifyHmac(secret: string, rawBody: string, headerHmac: string | undefined): boolean {
  if (!headerHmac) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(headerHmac);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mountWebhooks(app: Hono, container: Container): void {
  const kv = new KvRepo(container.db);

  app.post("/webhooks/:topic", async (c) => {
    const rawBody = await c.req.text();
    const headerHmac = c.req.header("x-shopify-hmac-sha256");
    const shopDomain = c.req.header("x-shopify-shop-domain");
    const webhookId = c.req.header("x-shopify-webhook-id");
    const topicSlug = c.req.param("topic");

    const secret = container.config.shopify.clientSecret;
    if (!secret || !verifyHmac(secret, rawBody, headerHmac)) {
      return c.text("Invalid HMAC.", 401);
    }

    if (webhookId) {
      const key = `webhook:${webhookId}`;
      const seen = await kv.get<boolean>(key);
      if (seen) return c.json({ ok: true, deduped: true });
      await kv.set(key, true);
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {};
    }

    const shopRow = shopDomain ? await container.shops.getByDomain(shopDomain) : null;
    // Shopify always sends X-Shopify-Topic; the URL slug is a fallback for per-topic addresses.
    const topic = c.req.header("x-shopify-topic")?.toLowerCase() || topicSlug.replace("-", "/");
    if (shopRow) await kv.set(`webhook:last:${shopRow.shopId}:${topic}`, { receivedAt: new Date().toISOString(), webhookId }).catch(() => undefined);

    try {
      await handleWebhook(container, topic, shopRow?.shopId, payload);
    } catch (e) {
      container.log.error("webhook handler failed", { topic, error: String(e) });
    }

    return c.json({ ok: true });
  });
}

async function handleWebhook(container: Container, topic: string, shopId: string | undefined, _payload: unknown): Promise<void> {
  if (!shopId) return;

  switch (true) {
    case topic.startsWith("app/uninstalled"): {
      await container.secrets.delete(shopId, "admin_token");
      await container.secrets.delete(shopId, "theme_access");
      for (const cred of await container.credentials.listByShop(shopId)) await container.credentials.revoke(cred.credentialId);
      await container.shops.markUninstalled(shopId);
      container.shopService.invalidate(shopId);
      break;
    }
    case topic.startsWith("app_subscriptions/update"): {
      await syncShopifySubscription(container, shopId, { force: true }).catch((e) => container.log.warn("shopify billing sync failed", { shopId, error: String(e) }));
      break;
    }
    case topic.startsWith("app/scopes_update"): {
      container.shopService.invalidate(shopId);
      break;
    }
    case topic.startsWith("themes/publish"):
    case topic.startsWith("themes/update"): {
      container.shopService.invalidate(shopId);
      break;
    }
    case topic.startsWith("customers/data_request"):
    case topic.startsWith("customers/redact"):
    case topic.startsWith("shop/redact"): {
      container.log.info("GDPR webhook received", { topic, shopId });
      break;
    }
    default:
      break;
  }
}
