/**
 * "Connect with an Admin API token": the merchant creates a custom app inside their own Shopify
 * admin (Settings → Apps and sales channels → Develop apps), grants the scopes, installs it and pastes
 * the shpat_ token here. Works on any store without App Store review. The token is validated against
 * the store before anything is saved, then stored encrypted exactly like an OAuth token.
 *
 * Webhooks are not registered for token installs (they would be signed with the merchant's custom-app
 * secret, not ours); uninstall is detected lazily when the token starts failing.
 */
import { AdminGraphqlClient } from "@shopmanagerai/shopify-admin";
import { ShopManagerAIError, ERROR_CODES } from "@shopmanagerai/shared";
import type { Container } from "../container.js";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const m = raw.match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i);
  if (m) s = `${m[1]!.toLowerCase()}.myshopify.com`;
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return SHOP_RE.test(s) ? s : null;
}

const VERIFY_QUERY = /* GraphQL */ `
  query TokenConnectVerify {
    shop { name myshopifyDomain primaryDomain { host } currencyCode plan { displayName } passwordEnabled }
    currentAppInstallation { accessScopes { handle } }
  }
`;

/** Scopes a merchant should tick when creating the custom app; mirrors SHOPIFY_SCOPES. */
export function requiredScopes(container: Container): string[] {
  return container.config.shopify.scopes;
}

export async function connectWithToken(container: Container, input: { shop: string; token: string }, opts: { fetchImpl?: typeof fetch } = {}) {
  const shop = normalizeShop(input.shop);
  if (!shop) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Enter your store's myshopify.com domain, for example my-store.myshopify.com.");
  const token = input.token.trim();
  if (!/^shpat_[a-f0-9]{20,}$/i.test(token) && !/^shpca_[a-f0-9]{20,}$/i.test(token)) {
    throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "That does not look like an Admin API access token (it starts with shpat_).");
  }

  const client = new AdminGraphqlClient({ shopDomain: shop, accessToken: token, apiVersion: container.config.shopify.apiVersion, maxRetries: 1, fetch: opts.fetchImpl });
  let data: any;
  try {
    data = (await client.query(VERIFY_QUERY, {}, { cost: 5 })).data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tech = e instanceof ShopManagerAIError ? `${e.httpStatus} ${e.technicalMessage ?? ""}` : "";
    if (/401|403|unauthor|invalid api key|access token/i.test(`${msg} ${tech}`)) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Shopify rejected that token. Check the store domain and paste the token again (it is shown only once when you install the custom app).", { httpStatus: 400 });
    throw new ShopManagerAIError(ERROR_CODES.UPSTREAM_ERROR, `Could not reach ${shop}: ${msg}`, { retryable: true });
  }
  const s = data?.shop;
  if (!s?.myshopifyDomain) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Shopify rejected that token.", { httpStatus: 400 });
  const granted: string[] = (data.currentAppInstallation?.accessScopes ?? []).map((x: { handle: string }) => x.handle);
  const required = requiredScopes(container);
  const missing = required.filter((r) => !granted.includes(r) && !(r.startsWith("read_") && granted.includes(r.replace(/^read_/, "write_"))));

  const shopId = s.myshopifyDomain.toLowerCase();
  const row = await container.shops.upsert({
    shopId,
    domain: shopId,
    name: s.name ?? null,
    plan: s.plan?.displayName ?? null,
    primaryDomain: s.primaryDomain?.host ?? null,
    currency: s.currencyCode ?? null,
    passwordProtected: Boolean(s.passwordEnabled),
    settings: { connection: "token", connectedAt: new Date().toISOString(), grantedScopes: granted.length },
  });
  await container.secrets.set(row.shopId, "admin_token", token);
  await container.kv.set(`shop_scopes:${row.shopId}`, granted.length ? granted : required);
  container.shopService.invalidate(row.shopId);
  await container.shopService.probe(row.shopId).catch(() => undefined);
  return { shopId: row.shopId, domain: row.domain, name: row.name, granted, missing };
}
