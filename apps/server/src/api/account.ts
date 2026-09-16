/**
 * Account API (dashboard at /app). Cookie session (httpOnly, SameSite=Lax, Secure on https),
 * magic-link login, store linking, per-store MCP tokens, account billing.
 *
 * All JSON routes live under /api/account/*. The one browser-navigated route is
 * GET /app/auth/verify?token=... (the link in the email), which sets the cookie and
 * redirects into the SPA.
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { BRAND, ShopManagerAIError, ERROR_CODES, isShopManagerAIError, newId, toShopManagerAIError } from "@shopmanagerai/shared";
import type { Container } from "../container.js";
import { grantedScopesFor } from "../shops/service.js";
import { buildClientConfigs } from "./client-configs.js";
import { effectiveUserState, SESSION_TTL_MS } from "../accounts/service.js";
import { effectiveState as effectiveShopState } from "@shopmanagerai/entitlement-freemius";
import type { UserRow } from "@shopmanagerai/storage";
import { connectWithToken, requiredScopes } from "../shopify/token-connect.js";

export const SESSION_COOKIE = "sm_session";

/** Shared by the support and admin-panel routers. */
export async function requireSession(container: Container, c: any): Promise<{ user: UserRow; sessionId: string }> {
  const session = await container.accounts.resolveSession(getCookie(c, SESSION_COOKIE));
  if (!session) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Not signed in.", { httpStatus: 401 });
  return session;
}

export function sessionCookieOptions(container: Container, maxAgeSeconds: number) {
  const secure = container.config.appUrl.startsWith("https://");
  return { path: "/", httpOnly: true, secure, sameSite: "Lax" as const, maxAge: maxAgeSeconds };
}

export function apiError(c: any, e: unknown) {
  const err = isShopManagerAIError(e) ? e : toShopManagerAIError(e);
  return c.json({ ok: false, code: err.code, message: err.message }, err.httpStatus as any);
}

function errResponse(c: any, e: unknown) {
  const err = isShopManagerAIError(e) ? e : toShopManagerAIError(e);
  return c.json({ ok: false, code: err.code, message: err.message }, err.httpStatus as any);
}

function cookieOptions(container: Container, maxAgeSeconds: number) {
  const secure = container.config.appUrl.startsWith("https://");
  return { path: "/", httpOnly: true, secure, sameSite: "Lax" as const, maxAge: maxAgeSeconds };
}

async function requireUser(container: Container, c: any): Promise<{ user: UserRow; sessionId: string }> {
  const session = await container.accounts.resolveSession(getCookie(c, SESSION_COOKIE));
  if (!session) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Not signed in.", { httpStatus: 401 });
  return session;
}

function planView(user: UserRow) {
  const state = effectiveUserState(user);
  const active = ["PRO_ACTIVE", "AGENCY_ACTIVE", "TRIAL", "PRO_GRACE"].includes(state);
  return {
    state,
    active,
    plan: user.plan,
    tier: active ? tierForSeats(user.seats?.shops).slug : "free",
    label: planLabel(user, state, active),
    seats: user.seats ?? { shops: active ? 1 : 0, members: 1 },
    graceUntil: user.graceUntil,
    licenseLinked: Boolean(user.licenseRef || user.freemiusLicenseId),
  };
}

/** Plans sold in the dashboard; prices mirror apps/site/src/data/pricing.ts. Seats come from plans.ts. */
export const SOLD_PLANS = [
  { slug: "pro", label: "Pro", tagline: "Everything, for one store.", seats: 1, monthlyUsd: 24.99, yearlyPerMonthUsd: 17.49, yearlyUsd: 209, support: "Email support" },
  { slug: "growth", label: "Growth", tagline: "Up to 10 stores.", seats: 10, monthlyUsd: 49.99, yearlyPerMonthUsd: 34.99, yearlyUsd: 419, support: "Email support" },
  { slug: "scale", label: "Scale", tagline: "Up to 100 stores.", seats: 100, monthlyUsd: 99.99, yearlyPerMonthUsd: 69.99, yearlyUsd: 839, support: "Priority email support" },
  { slug: "agency", label: "Agency", tagline: "Unlimited stores.", seats: null, monthlyUsd: 199.99, yearlyPerMonthUsd: 139.99, yearlyUsd: 1679, support: "Premium support: private channel, 1-business-day response, onboarding call" },
] as const;

function checkoutUrl(container: Container, user: UserRow, slug: string, cycle: "monthly" | "annual"): string | null {
  const { productId } = container.config.freemius;
  const { base, planIds, pricingIds } = container.config.freemiusCheckout;
  // Either a dedicated plan per tier, or the single "pro" plan with a pricing id per unit tier.
  const planId = planIds[slug] ?? (pricingIds[slug] ? planIds.pro : undefined);
  const pricingId = pricingIds[slug];
  if (!productId || !planId) return null;
  const q = new URLSearchParams({
    billing_cycle: cycle,
    ...(pricingId ? { pricing_id: pricingId } : {}),
    user_email: user.email,
    "custom[account_id]": user.userId,
    "custom[source]": "dashboard",
    success_url: `${container.config.appUrl}/app/billing?checkout=success`,
    cancel_url: `${container.config.appUrl}/app/billing?checkout=cancelled`,
  });
  return `${base}/product/${productId}/plan/${planId}/?${q.toString()}`;
}

/** Our tier for a seat count: the Freemius side may be one plan with unit tiers, so seats decide, not the slug. */
export function tierForSeats(seats: number | null | undefined): (typeof SOLD_PLANS)[number] {
  const n = seats ?? 1;
  if (n >= 100_000) return SOLD_PLANS[3]!;
  if (n >= 100) return SOLD_PLANS[2]!;
  if (n >= 10) return SOLD_PLANS[1]!;
  return SOLD_PLANS[0]!;
}

function planLabel(user: UserRow, state: string, active: boolean): string {
  if (!active) return "Free";
  const bySlug = SOLD_PLANS.find((p) => p.slug === (user.plan ?? "").toLowerCase() && p.slug !== "pro");
  const base = (bySlug ?? tierForSeats(user.seats?.shops)).label;
  if (state === "TRIAL") return `${base} trial`;
  if (state === "PRO_GRACE") return `${base} (grace period)`;
  return base;
}

async function shopView(container: Container, user: UserRow, link: { shopId: string; proSeat: boolean; role: string; createdAt: string }) {
  const shop = await container.shopService.getById(link.shopId);
  const ent = await container.entitlementRepo.get(link.shopId);
  const state = ent ? effectiveShopState(ent.state as any, ent.graceUntil) : "FREE";
  const installed = shop ? await container.secrets.has(shop.shopId, "admin_token") : false;
  const tokens = await container.credentials.listByShop(link.shopId);
  return {
    shopId: link.shopId,
    domain: shop?.domain ?? link.shopId,
    name: shop?.name ?? null,
    shopifyPlan: shop?.plan ?? null,
    installed: installed || container.config.demo,
    connection: (shop?.settings as any)?.connection === "token" ? "token" : "oauth",
    uninstalledAt: shop?.uninstalledAt ?? null,
    connectedAt: link.createdAt,
    role: link.role,
    proSeat: link.proSeat,
    entitlement: state,
    entitlementLabel: state === "AGENCY_ACTIVE" ? "Agency" : state === "TRIAL" ? "Pro trial" : state === "PRO_GRACE" ? "Pro (grace)" : state === "PRO_ACTIVE" ? "Pro" : "Free",
    managedByAccount: !ent || ent.freemiusUserId === `account:${user.userId}` || ent.state === "FREE",
    tokenCount: tokens.filter((t) => !t.revokedAt).length,
    mcpUrl: `${container.config.appUrl}/mcp/${shop?.domain ?? link.shopId}`,
    adminUrl: shop ? `https://admin.shopify.com/store/${shop.domain.replace(/\.myshopify\.com$/i, "")}/apps/${container.config.shopify.clientId ?? ""}` : null,
  };
}

export function mountAccountApi(app: Hono, container: Container): void {
  // ---- magic link landing (browser navigation) ----
  app.get("/app/auth/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    try {
      const { sessionToken, redirect } = await container.accounts.consumeMagicLink(token, { userAgent: c.req.header("user-agent") ?? "" });
      setCookie(c, SESSION_COOKIE, sessionToken, cookieOptions(container, SESSION_TTL_MS / 1000));
      return c.redirect(redirect ?? "/app");
    } catch {
      return c.redirect("/app/login?error=link");
    }
  });

  const api = new Hono();

  const LoginBody = z.object({ email: z.string().min(3).max(254), redirect: z.string().max(300).optional() });
  api.post("/login", async (c) => {
    try {
      const body = LoginBody.parse(await c.req.json());
      const result = await container.accounts.requestMagicLink(body.email, { redirect: body.redirect ?? null });
      return c.json({ ok: true, ...(result.devLink ? { devLink: result.devLink } : {}), provider: container.email.kind });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const SignupBody = z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(200), name: z.string().max(120).optional() });
  api.post("/signup", async (c) => {
    try {
      const body = SignupBody.parse(await c.req.json());
      const r = await container.accounts.signup({ email: body.email, password: body.password, name: body.name }, { userAgent: c.req.header("user-agent") ?? "" });
      setCookie(c, SESSION_COOKIE, r.sessionToken, cookieOptions(container, SESSION_TTL_MS / 1000));
      return c.json({ ok: true, user: { userId: r.user.userId, email: r.user.email, name: r.user.name }, ...(r.devLink ? { devLink: r.devLink } : {}) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const PasswordLoginBody = z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(200) });
  api.post("/login-password", async (c) => {
    try {
      const body = PasswordLoginBody.parse(await c.req.json());
      const r = await container.accounts.loginWithPassword(body, { userAgent: c.req.header("user-agent") ?? "" });
      setCookie(c, SESSION_COOKIE, r.sessionToken, cookieOptions(container, SESSION_TTL_MS / 1000));
      return c.json({ ok: true, user: { userId: r.user.userId, email: r.user.email, name: r.user.name, role: r.user.role } });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const ResetBody = z.object({ email: z.string().min(3).max(254) });
  api.post("/password/forgot", async (c) => {
    try {
      const body = ResetBody.parse(await c.req.json());
      const r = await container.accounts.requestPasswordReset(body.email);
      return c.json({ ok: true, ...(r.devLink ? { devLink: r.devLink } : {}) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const SetPasswordBody = z.object({ current: z.string().max(200).optional(), next: z.string().min(1).max(200) });
  api.post("/password", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const body = SetPasswordBody.parse(await c.req.json());
      await container.accounts.setPassword(user.userId, body);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/verify/resend", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      if (user.emailVerifiedAt) return c.json({ ok: true, already: true });
      const r = await container.accounts.sendVerification(user.email);
      return c.json({ ok: true, ...(r.devLink ? { devLink: r.devLink } : {}) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/logout", async (c) => {
    try {
      const session = await container.accounts.resolveSession(getCookie(c, SESSION_COOKIE));
      if (session) await container.accounts.logout(session.sessionId);
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/me", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const links = await container.userShops.listForUser(user.userId);
      const shops = await Promise.all(links.map((l) => shopView(container, user, l)));
      const seats = await container.accounts.seatUsage(user.userId);
      return c.json({
        ok: true,
        user: { userId: user.userId, email: user.email, name: user.name, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, role: user.role, hasPassword: user.hasPassword, emailVerified: Boolean(user.emailVerifiedAt) },
        plan: planView(user),
        seats,
        shops,
        billing: {
          configured: Boolean(container.config.freemius.productId),
          plans: SOLD_PLANS.map((p) => ({ ...p, checkoutMonthly: checkoutUrl(container, user, p.slug, "monthly"), checkoutYearly: checkoutUrl(container, user, p.slug, "annual") })),
          manualActivation: Boolean(container.licenseActivation),
        },
        brand: { name: BRAND.name, siteUrl: container.config.siteUrl, appUrl: container.config.appUrl, demo: container.config.demo },
      });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const ProfileBody = z.object({ name: z.string().max(120) });
  api.put("/me", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const body = ProfileBody.parse(await c.req.json());
      const updated = await container.users.updateProfile(user.userId, { name: body.name.trim() });
      return c.json({ ok: true, user: { userId: updated!.userId, email: updated!.email, name: updated!.name } });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/logout-everywhere", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      await container.accounts.logoutEverywhere(user.userId);
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/sessions", async (c) => {
    try {
      const { user, sessionId } = await requireUser(container, c);
      const sessions = await container.sessions.listForUser(user.userId);
      return c.json({ ok: true, sessions: sessions.map((s) => ({ ...s, current: s.sessionId === sessionId })) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---- stores ----
  const ConnectBody = z.object({ shop: z.string().min(3).max(120) });
  api.post("/shops/connect", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const body = ConnectBody.parse(await c.req.json());
      if (container.config.demo) {
        // Demo mode has no Shopify OAuth: link the demo shop directly so the dashboard can be exercised.
        const demo = await container.shopService.ensureDemoShop();
        await container.accounts.linkShop(user.userId, demo.shopId);
        return c.json({ ok: true, installUrl: `/app/stores/${encodeURIComponent(demo.domain)}?connected=1`, shop: demo.domain, demo: true });
      }
      const existing = await container.shopService.getByDomain(body.shop.trim().toLowerCase());
      const installed = existing ? await container.secrets.has(existing.shopId, "admin_token") : false;
      const result = await container.accounts.beginConnect(user.userId, body.shop);
      if (existing && installed && !existing.uninstalledAt) {
        // Already installed: no need to re-run OAuth; owner attribution is by the signed-in session.
        await container.accounts.linkShop(user.userId, existing.shopId);
        return c.json({ ok: true, installUrl: `/app/stores/${encodeURIComponent(existing.domain)}?connected=1`, shop: existing.domain, alreadyInstalled: true });
      }
      return c.json({ ok: true, ...result });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // Merchant-created custom app token (works on any store, no App Store review needed).
  const TokenConnectBody = z.object({ shop: z.string().min(3).max(120), token: z.string().min(10).max(200) });
  api.post("/shops/connect-token", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const body = TokenConnectBody.parse(await c.req.json());
      const r = await connectWithToken(container, body);
      await container.accounts.linkShop(user.userId, r.shopId);
      return c.json({ ok: true, shop: r.domain, name: r.name, missingScopes: r.missing, installUrl: `/app/stores/${encodeURIComponent(r.shopId)}?connected=1` });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/shops/connect-token/scopes", async (c) => {
    try {
      await requireUser(container, c);
      return c.json({ ok: true, scopes: requiredScopes(container), appName: "ShopManager AI" });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/shops/:shopId", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const link = await container.userShops.get(user.userId, c.req.param("shopId"));
      if (!link) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "That store is not linked to your account.");
      const view = await shopView(container, user, link);
      // Same fix as the embedded admin's /connect: a revoked token stays in the table for the
      // audit trail, but the dashboard's "your tokens" list must never show it as live.
      const tokens = (await container.credentials.listByShop(link.shopId))
        .filter((t) => !t.revokedAt)
        .map((t) => ({
          credentialId: t.credentialId,
          label: t.label,
          profile: t.profile,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          expiresAt: t.expiresAt,
          revokedAt: t.revokedAt,
        }));
      const connections = await container.connections.list(link.shopId).catch(() => []);
      return c.json({ ok: true, shop: view, tokens, connections, clientConfigs: buildClientConfigs(view.mcpUrl) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/shops/:shopId", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      await container.accounts.unlinkShop(user.userId, c.req.param("shopId"));
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const SeatBody = z.object({ pro: z.boolean() });
  api.post("/shops/:shopId/seat", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const body = SeatBody.parse(await c.req.json());
      await container.accounts.setSeat(user.userId, c.req.param("shopId"), body.pro);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---- tokens ----
  const CreateTokenBody = z.object({
    label: z.string().min(1).max(80),
    profile: z.enum(["read_only", "production_safe", "developer_full_access", "admin"]).default("production_safe"),
    expiresInDays: z.number().int().positive().max(3650).optional(),
  });
  api.post("/shops/:shopId/tokens", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const shopId = c.req.param("shopId");
      const link = await container.userShops.get(user.userId, shopId);
      if (!link) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "That store is not linked to your account.");
      const shop = await container.shopService.getById(shopId);
      if (!shop) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Shop not found.");
      const body = CreateTokenBody.parse(await c.req.json());
      const token = `${BRAND.tokenPrefix}${newId()}`;
      const credential = await container.credentials.create({
        credentialId: newId("cred"),
        shopId,
        kind: "token",
        label: body.label,
        profile: body.profile,
        policy: {},
        token,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86400000).toISOString() : null,
        scopes: await grantedScopesFor(container, shopId),
      });
      const mcpUrl = `${container.config.appUrl}/mcp/${shop.domain}`;
      return c.json({ ok: true, token, credential: { credentialId: credential.credentialId, label: credential.label, profile: credential.profile, createdAt: credential.createdAt, expiresAt: credential.expiresAt }, clientConfigs: buildClientConfigs(mcpUrl, token) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/shops/:shopId/tokens/:credentialId", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const shopId = c.req.param("shopId");
      const link = await container.userShops.get(user.userId, shopId);
      if (!link) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "That store is not linked to your account.");
      const row = await container.credentials.get(c.req.param("credentialId"));
      if (!row || row.shopId !== shopId) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown token.");
      await container.credentials.revoke(row.credentialId);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---- billing ----
  const ActivateBody = z.object({ licenseKey: z.string().min(4).max(200) });
  api.post("/billing/activate", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      const body = ActivateBody.parse(await c.req.json());
      const result = await container.accounts.activateLicense(user.userId, body.licenseKey);
      return c.json({ ok: true, planState: result.planState, seats: result.seats });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/billing/deactivate", async (c) => {
    try {
      const { user } = await requireUser(container, c);
      await container.accounts.deactivateLicense(user.userId);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  app.route("/api/account", api);
}
