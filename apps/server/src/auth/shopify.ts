/**
 * Shopify install + OAuth (authorization-code grant, offline token) and App Bridge
 * session-token verification, implemented directly with node:crypto.
 *
 * Why not @shopify/shopify-api here: its begin()/callback() need platform adapters
 * and Node req/res objects that do not match Hono's Web-standard Request, and it
 * only knows API versions up to its release date. The grant itself is small and
 * stable: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 *
 * Embedded first load: Shopify opens the App URL inside an iframe. OAuth cannot
 * run in that iframe (Shopify sets X-Frame-Options on its own pages), so when we
 * detect an embedded request we serve a tiny page that breaks out to the top window.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "../api/account.js";
import type { Container } from "../container.js";
import { DEMO_SHOP_DOMAIN, DEMO_SHOP_ID } from "../shops/service.js";
import { AdminGraphqlClient } from "@shopmanagerai/shopify-admin";
import { describeError } from "@shopmanagerai/shared";
import { syncShopifySubscription } from "../shopify/billing.js";

const WEBHOOK_TOPICS = [
  "app/uninstalled",
  "app/scopes_update",
  "shop/update",
  "themes/publish",
  "themes/update",
  "app_subscriptions/update",
  // customers/data_request, customers/redact, shop/redact are "compliance webhooks": for a public app
  // they are configured in the Partner Dashboard, not via the API (the API rejects them).
];

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const STATE_TTL_MS = 10 * 60 * 1000;

function sanitizeShop(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // admin.shopify.com/store/<handle> form
  const m = raw.match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i);
  if (m) s = `${m[1]!.toLowerCase()}.myshopify.com`;
  return SHOP_RE.test(s) ? s : null;
}

/** HMAC of the callback query (all params except hmac/signature, sorted, joined with &). */
function verifyQueryHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, signature: _sig, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmac, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorizeUrl(container: Container, shop: string, state: string): string {
  const { clientId, scopes } = container.config.shopify;
  const params = new URLSearchParams({
    client_id: clientId ?? "",
    scope: scopes.join(","),
    redirect_uri: `${container.config.appUrl}/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

function breakoutHtml(target: string): string {
  const safe = JSON.stringify(target);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connecting…</title></head><body style="font-family:system-ui;padding:2rem">
<p>Redirecting to Shopify to authorize ShopManager AI…</p>
<script>
  var url = ${safe};
  if (window.top === window.self) { window.location.href = url; } else { window.top.location.href = url; }
</script>
<p><a href=${safe} target="_top">Continue</a></p>
</body></html>`;
}

export function mountShopifyAuth(app: Hono, container: Container): void {
  app.get("/auth", async (c) => {
    const shop = sanitizeShop(c.req.query("shop"));
    if (!shop) return c.text("Missing or invalid ?shop= (expected xxxx.myshopify.com).", 400);
    if (!container.config.shopify.clientId || !container.config.shopify.clientSecret) {
      return c.text("Shopify OAuth is not configured on this deployment (running in demo mode).", 400);
    }

    // application_url is this route (Shopify loads it on every embedded open, not just install).
    // A shop that already has a stored access token must land in the app UI, not restart the
    // grant - otherwise every open loops: authorize -> callback -> embed reload -> authorize...
    const existingShop = await container.shops.getByDomain(shop).catch(() => null);
    const existingToken = existingShop ? await container.secrets.get(existingShop.shopId, "admin_token").catch(() => null) : null;
    if (existingToken) {
      const host = c.req.query("host");
      const dest = `/admin?shop=${encodeURIComponent(shop)}${host ? `&host=${encodeURIComponent(host)}` : ""}`;
      // Same-frame redirect: /admin is itself embeddable (frame-ancestors CSP), unlike the OAuth
      // grant below, so there is no iframe to break out of here.
      return c.redirect(dest);
    }

    const state = randomBytes(24).toString("base64url");
    await container.kv.set(`oauth_state:${state}`, { shop, createdAt: Date.now() });
    const url = authorizeUrl(container, shop, state);

    // Embedded (iframe) load: Shopify passes `embedded=1` and/or `host`; the Sec-Fetch-Dest
    // header is "iframe" in modern browsers. Break out to the top window for the grant.
    const embedded = c.req.query("embedded") === "1" || !!c.req.query("host") || c.req.header("sec-fetch-dest") === "iframe";
    if (embedded) return c.html(breakoutHtml(url));
    return c.redirect(url);
  });

  app.get("/auth/callback", async (c) => {
    const { clientId, clientSecret } = container.config.shopify;
    if (!clientId || !clientSecret) return c.text("Shopify OAuth is not configured.", 400);

    const query: Record<string, string> = {};
    for (const [k, v] of new URL(c.req.url).searchParams) query[k] = v;

    const shop = sanitizeShop(query["shop"]);
    if (!shop) return c.text("Invalid shop in callback.", 400);
    if (!verifyQueryHmac(query, clientSecret)) {
      container.log.warn("oauth callback: HMAC mismatch", { shop });
      return c.text("Invalid HMAC.", 400);
    }
    const state = query["state"] ?? "";
    const stored = state ? await container.kv.get<{ shop: string; createdAt: number }>(`oauth_state:${state}`) : null;
    if (!stored || stored.shop !== shop || Date.now() - stored.createdAt > STATE_TTL_MS) {
      container.log.warn("oauth callback: bad or expired state", { shop });
      return c.text("Invalid or expired state. Start the install again.", 400);
    }
    await container.kv.delete(`oauth_state:${state}`);

    const code = query["code"];
    if (!code) return c.text("Missing code.", 400);
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      // expiring: 1 requests the current (non-deprecated) offline token type directly, same fix
      // as ensureFreshAccessToken's Token Exchange call below. Without it a fresh install mints a
      // permanent/non-expiring token that fails every Admin API call ("Non-expiring access tokens
      // are no longer accepted") until the merchant happens to reload the embedded app afterward
      // and the self-heal in verifyAdminSession gets a chance to run - a real install-to-broken
      // window we hit live (registerWebhooks/probe/billing all 403'd right after install, and
      // stayed broken for minutes because the embedded app was never reopened). Requesting it here
      // too means a fresh install should never produce a broken token in the first place.
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, expiring: 1 }),
    });
    if (!tokenRes.ok) {
      container.log.error("oauth callback: token exchange failed", { shop, status: tokenRes.status });
      return c.text(`Token exchange failed (${tokenRes.status}).`, 502);
    }
    const tokenJson = (await tokenRes.json()) as { access_token: string; scope: string };

    // A shop that previously connected via the merchant admin-API-token path (settings.connection
    // = "token") has that overwritten here: a real OAuth install just completed, so this is now
    // the authoritative connection method going forward.
    const existingRow = await container.shops.getById(shop).catch(() => null);
    const shopRow = await container.shops.upsert({
      shopId: shop,
      domain: shop,
      settings: { ...(existingRow?.settings as Record<string, unknown> | undefined), connection: "oauth" },
    });
    await container.secrets.set(shopRow.shopId, "admin_token", tokenJson.access_token);
    await container.kv.set(`shop_scopes:${shopRow.shopId}`, tokenJson.scope.split(",").map((s) => s.trim()));
    container.log.info("oauth callback: installed", { shop, scopes: tokenJson.scope.split(",").length });

    await registerWebhooks(container, shop, tokenJson.access_token).catch((e) => container.log.warn("webhook registration failed", { error: describeError(e) }));
    await container.shopService.probe(shopRow.shopId).catch(() => undefined);
    await syncShopifySubscription(container, shopRow.shopId, { force: true }).catch(() => undefined);

    // Account layer: an install started from the dashboard (or made while signed in) links the shop to that account.
    const session = await container.accounts.resolveSession(getCookie(c, SESSION_COOKIE)).catch(() => null);
    const linkedUser = await container.accounts.completeConnect(shopRow.shopId, session?.user.userId ?? null).catch((e) => {
      container.log.warn("account link after install failed", { shop, error: describeError(e) });
      return null;
    });
    if (linkedUser) return c.redirect(`/app/stores/${encodeURIComponent(shop)}?connected=1`);

    // Land inside the Shopify admin (embedded) rather than on a bare page.
    const handle = shop.replace(/\.myshopify\.com$/i, "");
    return c.redirect(`https://admin.shopify.com/store/${handle}/apps/${clientId}`);
  });
}

/** GraphQL-only (App Store rule 2.2.4): webhookSubscriptionCreate, one call per topic; "already exists" is fine. */
async function registerWebhooks(container: Container, shop: string, accessToken: string): Promise<void> {
  const base = container.config.appUrl;
  const client = new AdminGraphqlClient({ shopDomain: shop, accessToken, apiVersion: container.config.shopify.apiVersion, maxRetries: 1 });
  const mutation = /* GraphQL */ `
    mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $uri: String!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
        userErrors { field message }
      }
    }`;
  for (const topic of WEBHOOK_TOPICS) {
    const enumTopic = topic.toUpperCase().replace("/", "_");
    const uri = `${base}/webhooks/${topic.replace("/", "-")}`;
    try {
      const res = await client.mutate<{ webhookSubscriptionCreate: { userErrors: Array<{ message: string }> } }>(mutation, { topic: enumTopic, uri }, { cost: 10 });
      const errs = res.data?.webhookSubscriptionCreate?.userErrors ?? [];
      const real = errs.filter((e) => !/already|taken/i.test(e.message));
      if (real.length) container.log.warn("registerWebhooks: userErrors", { topic, errors: real.map((e) => e.message) });
    } catch (e) {
      container.log.warn("registerWebhooks: failed", { topic, error: describeError(e) });
    }
  }
}

export interface AdminSession {
  shopId: string;
  shopDomain: string;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifies an App Bridge session token (JWT, HS256 signed with the app's client secret):
 * signature, exp/nbf, aud === client id, and dest/iss shop. Demo mode bypasses this.
 */
export function verifySessionToken(token: string, clientId: string, clientSecret: string): { shop: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const expected = createHmac("sha256", clientSecret).update(`${h}.${p}`).digest();
  const given = b64urlToBuffer(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const header = JSON.parse(b64urlToBuffer(h).toString("utf8")) as { alg?: string };
  if (header.alg !== "HS256") return null;
  const payload = JSON.parse(b64urlToBuffer(p).toString("utf8")) as { aud?: string; exp?: number; nbf?: number; dest?: string; iss?: string };
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId) return null;
  // Session tokens are valid for 60s. Allow 60s of clock skew either way: a slow
  // host clock otherwise rejects every token and the embedded app shows
  // "Not authenticated" on load.
  if (typeof payload.exp !== "number" || payload.exp < now - 60) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  const dest = payload.dest ? new URL(payload.dest).hostname : null;
  const iss = payload.iss ? new URL(payload.iss).hostname : null;
  if (!dest || !SHOP_RE.test(dest) || (iss && iss !== dest)) return null;
  return { shop: dest.toLowerCase() };
}

export async function verifyAdminSession(container: Container, c: { req: { header(name: string): string | undefined; query(name: string): string | undefined } }): Promise<AdminSession | null> {
  if (container.config.demo) {
    const shop = c.req.query("shop") ?? c.req.header("x-cp-demo-shop") ?? DEMO_SHOP_DOMAIN;
    const row = shop === DEMO_SHOP_DOMAIN || shop === DEMO_SHOP_ID ? await container.shopService.ensureDemoShop() : await container.shopService.getByDomain(shop);
    if (!row) return null;
    return { shopId: row.shopId, shopDomain: row.domain };
  }

  const { clientId, clientSecret } = container.config.shopify;
  const authz = c.req.header("authorization");
  const token = authz?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !clientId || !clientSecret) return null;

  const verified = verifySessionToken(token, clientId, clientSecret);
  if (!verified) {
    container.log.warn("verifyAdminSession: session token rejected");
    return null;
  }
  const row = await container.shopService.getByDomain(verified.shop);
  if (!row) return null;

  // Self-heal: Shopify is retiring permanent offline tokens issued by the classic
  // authorization-code grant ("New expiring offline tokens are replacing tokens that grant
  // permanent offline access. Deprecated offline tokens can't be used to make calls."). Every
  // authenticated embedded request carries a valid App Bridge session token, which is exactly
  // the credential Token Exchange needs to mint the current, working token type - so refresh it
  // here rather than requiring a manual reinstall. Cheap to skip-if-recent via the kv timestamp.
  await ensureFreshAccessToken(container, row.shopId, token).catch((e) =>
    container.log.warn("verifyAdminSession: token exchange failed", { shopId: row.shopId, error: describeError(e) }),
  );

  return { shopId: row.shopId, shopDomain: row.domain };
}

// Exchange + self-check confirmed working live (real product data returned via MCP). Back to a
// sane interval - this now only guards against re-exchanging on every single /api/admin/* call
// within one page load, not against genuine reuse across sessions.
const TOKEN_EXCHANGE_COOLDOWN_MS = 20 * 60 * 1000;

/**
 * OAuth 2.0 Token Exchange (RFC 8693, Shopify's replacement for redeeming the classic
 * authorization-code grant into a token): swaps a short-lived App Bridge session token for a
 * real offline access token, in the current non-deprecated format.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */
async function exchangeSessionTokenForOfflineAccessToken(
  container: Container,
  shop: string,
  sessionToken: string,
): Promise<{ accessToken: string; scope: string }> {
  const { clientId, clientSecret } = container.config.shopify;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      // Shopify's own URN namespace, not the generic IETF one - "invalid_requested_token_type"
      // is what the generic urn:ietf:... form gets back. grant_type and subject_token_type
      // above ARE the standard IETF ones; this one specifically is Shopify-specific.
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      // Without this, Token Exchange defaults to the same deprecated permanent (non-expiring)
      // token type we are trying to get away from - it does NOT default to expiring just
      // because the grant type is token-exchange. Confirmed against Shopify's docs after the
      // first "successful" exchange came back with a shpat_ token that failed the exact same
      // "non-expiring access tokens are no longer accepted" check.
      expiring: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`token exchange failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json()) as { access_token: string; scope: string };
  return { accessToken: json.access_token, scope: json.scope };
}

/** Runs the exchange at most once per shop per TOKEN_EXCHANGE_COOLDOWN_MS. */
async function ensureFreshAccessToken(container: Container, shopId: string, sessionToken: string): Promise<void> {
  const cacheKey = `token_exchanged_at:${shopId}`;
  const last = await container.kv.get<number>(cacheKey);
  const now = Date.now();
  if (typeof last === "number" && now - last < TOKEN_EXCHANGE_COOLDOWN_MS) return;

  const { accessToken, scope } = await exchangeSessionTokenForOfflineAccessToken(container, shopId, sessionToken);
  await container.secrets.set(shopId, "admin_token", accessToken);
  await container.kv.set(`shop_scopes:${shopId}`, scope.split(",").map((s) => s.trim()).filter(Boolean));
  await container.kv.set(cacheKey, now);
  container.shopService.invalidate(shopId);
  // Silent success was indistinguishable from "never ran" in the logs - this made the last round
  // of debugging guesswork. Token prefix only (shpat_/shpua_/...), never the token itself.
  container.log.info("verifyAdminSession: token exchange succeeded", { shopId, tokenPrefix: accessToken.split("_")[0], scopeCount: scope.split(",").filter(Boolean).length });

  // Prove the new token actually works right now, rather than waiting for a later MCP call to
  // fail and re-open this whole investigation. Costs one call, at most every cooldown window.
  try {
    const check = new AdminGraphqlClient({ shopDomain: shopId, accessToken, apiVersion: container.config.shopify.apiVersion, maxRetries: 0 });
    await check.query(`query { shop { name } }`);
    container.log.info("verifyAdminSession: post-exchange self-check passed", { shopId });
    // shopService.invalidate() above only drops the in-memory admin client - it does not
    // recompute the persisted capability flags (theme.read/theme.write/admin.read/...) that
    // planesFor() reads from the capabilities table. Those were last written by whatever probe()
    // ran while the token was still broken, so theme tools stayed CAPABILITY_MISSING even after
    // the token itself started working. Re-probe now that we know the token is good.
    await container.shopService.probe(shopId).catch((e) =>
      container.log.warn("verifyAdminSession: post-exchange re-probe failed", { shopId, error: describeError(e) }),
    );
  } catch (e) {
    container.log.warn("verifyAdminSession: post-exchange self-check FAILED - the exchanged token still does not work", { shopId, error: describeError(e) });
  }
}
