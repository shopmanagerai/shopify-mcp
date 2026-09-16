/**
 * Bearer auth for `/mcp/:shop` (task brief §6).
 */
import { newId, type Credential, type Entitlement, type Tier } from "@shopmanagerai/shared";
import type { Container } from "../container.js";
import { CredentialRepo, type ShopRow } from "@shopmanagerai/storage";
import { resolveShop } from "../shops/resolve.js";
import { DEMO_SHOP_ID, grantedScopesFor } from "../shops/service.js";
import type { McpRequestCtx } from "../mcp/execute.js";

export const DEMO_TOKEN = "cp_demo";

export class McpAuthError extends Error {
  constructor(
    public readonly status: 401,
    public readonly wwwAuthenticate: string,
    message: string,
  ) {
    super(message);
  }
}

function tierFromEntitlementState(state: string): Tier {
  if (state === "AGENCY_ACTIVE") return "agency";
  if (state === "PRO_ACTIVE" || state === "PRO_GRACE" || state === "TRIAL") return "pro";
  return "free";
}

/** Ensures the demo bearer token exists; returns it. Called once at boot in demo mode. */
export async function ensureDemoToken(container: Container): Promise<string> {
  const existing = await container.credentials.findByTokenHash(CredentialRepo.hashToken(DEMO_TOKEN));
  if (existing) return DEMO_TOKEN;
  await container.shopService.ensureDemoShop();
  await container.credentials.create({
    credentialId: newId("cred"),
    shopId: DEMO_SHOP_ID,
    kind: "token",
    label: "Demo token",
    profile: "developer_full_access",
    token: DEMO_TOKEN,
    scopes: [
      "read_products",
      "write_products",
      "read_content",
      "write_content",
      "read_online_store_navigation",
      "write_online_store_navigation",
      "read_files",
      "write_files",
      "read_publications",
      "write_publications",
      "read_metaobject_definitions",
      "read_metaobjects",
      "write_metaobjects",
    ],
  });
  return DEMO_TOKEN;
}

export async function authenticateMcp(container: Container, shopHandle: string, authorizationHeader: string | undefined): Promise<McpRequestCtx> {
  const shopRow = await resolveShop(container.shopService, shopHandle);
  if (!shopRow) {
    throw new McpAuthError(401, wwwAuthenticateFor(container, shopHandle), "Unknown shop.");
  }

  const bearer = extractBearer(authorizationHeader);
  if (!bearer) {
    throw new McpAuthError(401, wwwAuthenticateFor(container, shopHandle), "Missing bearer token.");
  }

  const credentialRow = await resolveCredential(container, shopRow, bearer);
  if (!credentialRow) {
    throw new McpAuthError(401, wwwAuthenticateFor(container, shopHandle), "Invalid or revoked token.");
  }

  const entitlementState = await container.entitlements.getState(shopRow.shopId);
  const planes = await container.shopService.planesFor(shopRow.shopId);

  // credentialRow.scopes is a snapshot taken once at token-creation time - it goes stale the
  // moment Shopify's actual grant changes (a scope update, a reinstall, or simply a fix to how
  // granted scopes get interpreted, as happened here: write-implies-read expansion landed in
  // grantedScopesFor but every already-issued token kept reading its own frozen, pre-fix list
  // forever). Read live instead, except for the hardcoded demo credential.
  const scopesGranted = shopRow.shopId === DEMO_SHOP_ID ? credentialRow.scopes : await grantedScopesFor(container, shopRow.shopId);

  const credential: Credential = {
    credentialId: credentialRow.credentialId,
    shopId: shopRow.shopId,
    shopDomain: shopRow.domain,
    kind: credentialRow.kind === "oauth" ? "oauth" : "token",
    label: credentialRow.label,
    profile: credentialRow.profile as Credential["profile"],
    policy: mergeDisabledTools(credentialRow.policy, shopRow),
    scopesGranted,
  };

  return {
    credential,
    shop: container.shopService.toSummary(shopRow),
    planes,
    tier: tierFromEntitlementState(entitlementState.state),
    entitlements: new Set<Entitlement>(entitlementState.entitlements),
    entitlementState: entitlementState.state,
    upgradeUrl: entitlementState.upgradeUrl,
    era: "modern",
  };
}

function mergeDisabledTools(policy: Record<string, boolean | number | string>, shop: ShopRow): Record<string, boolean | number | string> {
  const settings = (shop.settings ?? {}) as { disabledTools?: string[] };
  const merged = { ...policy };
  for (const name of settings.disabledTools ?? []) merged[`tool.${name}`] = false;
  return merged;
}

async function resolveCredential(container: Container, shop: ShopRow, token: string) {
  if (container.config.demo && shop.shopId === DEMO_SHOP_ID && token === DEMO_TOKEN) {
    await ensureDemoToken(container);
  }

  const tokenHash = CredentialRepo.hashToken(token);
  const byToken = await container.credentials.findByTokenHash(tokenHash);
  if (byToken && byToken.shopId === shop.shopId && !byToken.revokedAt && !isExpired(byToken.expiresAt)) {
    await container.credentials.touch(byToken.credentialId);
    return byToken;
  }

  const oauthToken = await container.oauth.findToken(token);
  if (oauthToken && oauthToken.kind === "access" && !oauthToken.revokedAt && !isExpired(oauthToken.expiresAt)) {
    const cred = await container.credentials.get(oauthToken.credentialId);
    if (cred && cred.shopId === shop.shopId && !cred.revokedAt) {
      await container.credentials.touch(cred.credentialId);
      return cred;
    }
  }

  return null;
}

function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

function wwwAuthenticateFor(container: Container, shopHandle: string): string {
  return `Bearer resource_metadata="${container.config.appUrl}/.well-known/oauth-protected-resource/mcp/${shopHandle}"`;
}
