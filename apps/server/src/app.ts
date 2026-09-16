/**
 * Builds the Hono app graph from a built Container. Split from index.ts so
 * tests can build an app against an in-memory container without booting a
 * real HTTP listener.
 */
import { Hono } from "hono";
import type { Container } from "./container.js";
import { mountMiddleware } from "./middleware.js";
import { mountShopifyAuth } from "./auth/shopify.js";
import { mountOAuthAuthorizationServer } from "./auth/oauth-as.js";
import { mountWebhooks } from "./webhooks.js";
import { mountMcp } from "./mcp/route.js";
import { mountAdminApi } from "./api/admin.js";
import { mountStatic } from "./static.js";
import { mountEntitlementApi } from "./api/entitlement.js";
import { mountAccountApi } from "./api/account.js";
import { mountSupportApi } from "./api/support.js";
import { mountAdminPanelApi } from "./api/admin-panel.js";
import { mountPostsApi } from "./api/posts.js";

export function buildApp(container: Container): Hono {
  const app = new Hono();
  // Operational endpoints (Phase 8): liveness, readiness (db round-trip), Prometheus metrics.
  app.get("/healthz", (c) => c.json({ ok: true, brand: "ShopManager AI", db: container.dbDriver, demo: container.config.demo, uptimeSeconds: Math.round((Date.now() - container.metrics.startedAt) / 1000) }));
  app.get("/readyz", async (c) => {
    try {
      await container.db.selectFrom("kv").select("key").limit(1).execute();
      return c.json({ ok: true, db: container.dbDriver, tools: container.registry.list().length });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 503);
    }
  });
  app.get("/metrics", (c) => c.text(container.metrics.render(), 200, { "content-type": "text/plain; version=0.0.4" }));
  mountMiddleware(app, container);
  mountShopifyAuth(app, container);
  mountOAuthAuthorizationServer(app, container);
  mountWebhooks(app, container);
  mountMcp(app, container);
  mountAdminApi(app, container);
  mountEntitlementApi(app, container);
  mountAccountApi(app, container);
  mountSupportApi(app, container);
  mountAdminPanelApi(app, container);
  mountPostsApi(app, container);
  mountStatic(app, container);
  return app;
}
