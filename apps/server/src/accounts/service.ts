/**
 * Account layer: passwordless login, sessions, user<->shop links, account billing.
 *
 * Billing model: the Freemius license binds to the *user* (users.plan_state and
 * friends). Each linked shop can hold one of the plan's shop seats (user_shops.pro_seat).
 * `applySeats` projects that onto the per-shop `entitlements` rows the tool gate
 * already reads, so nothing in the MCP path had to change. Rows this layer manages
 * are tagged `freemius_user_id = account:<userId>` so a seat removal only ever
 * downgrades rows the account created (never a shop-level license activated in the
 * embedded admin).
 */
import { randomBytes } from "node:crypto";
import { ShopManagerAIError, ERROR_CODES, newId, type Logger } from "@shopmanagerai/shared";
import type { EntitlementRepo, KvRepo, MagicLinkRepo, SessionRepo, ShopRepo, UserRepo, UserRow, UserShopRepo, UserShopRow } from "@shopmanagerai/storage";
import { normalizeEmail } from "@shopmanagerai/storage";
import { seatsForPlan, type LicenseActivation } from "@shopmanagerai/entitlement-freemius";
import { magicLinkEmail, resetPasswordTemplate, verifyEmailTemplate, type EmailSender } from "./email.js";
import { hashPassword, passwordProblem, verifyPassword } from "./password.js";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_LINKS_PER_HOUR = 5;
const ACTIVE_STATES = new Set(["PRO_ACTIVE", "AGENCY_ACTIVE", "TRIAL", "PRO_GRACE"]);

export interface AccountServiceDeps {
  users: UserRepo;
  magicLinks: MagicLinkRepo;
  sessions: SessionRepo;
  userShops: UserShopRepo;
  shops: ShopRepo;
  entitlements: EntitlementRepo;
  kv: KvRepo;
  email: EmailSender;
  licenseActivation: LicenseActivation | null;
  invalidateEntitlements: (shopId: string) => void;
  log: Logger;
  appUrl: string;
  brand: string;
  /** Demo/dev: echo the magic link back to the caller instead of relying on an inbox. */
  echoMagicLinks: boolean;
  /** Emails that get the admin role on every sign-in. */
  adminEmails: string[];
}

export function accountTag(userId: string): string {
  return `account:${userId}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

/** A user's effective plan state, applying the grace window the same way the shop provider does. */
export function effectiveUserState(user: Pick<UserRow, "planState" | "graceUntil">, now = new Date()): string {
  if (user.planState === "PRO_EXPIRED" && user.graceUntil && new Date(user.graceUntil).getTime() > now.getTime()) return "PRO_GRACE";
  return user.planState;
}

export class AccountService {
  constructor(private readonly d: AccountServiceDeps) {}

  // ---------------------------------------------------------------- login

  async requestMagicLink(rawEmail: string, opts: { redirect?: string | null } = {}): Promise<{ ok: true; devLink?: string }> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Enter a valid email address.");
    const recent = await this.d.magicLinks.countRecent(email, 60 * 60 * 1000);
    if (recent >= MAGIC_LINKS_PER_HOUR) throw new ShopManagerAIError(ERROR_CODES.RATE_LIMITED, "Too many sign-in links requested. Try again in an hour.", { retryable: true });

    const token = randomBytes(32).toString("base64url");
    const redirect = sanitizeRedirect(opts.redirect);
    await this.d.magicLinks.create({ token, email, redirect, ttlMs: MAGIC_LINK_TTL_MS });
    const link = `${this.d.appUrl}/app/auth/verify?token=${encodeURIComponent(token)}`;
    const mail = magicLinkEmail({ brand: this.d.brand, link, minutes: MAGIC_LINK_TTL_MS / 60000 });
    const sent = await this.d.email.send({ to: email, ...mail });
    if (!sent.ok && !this.d.echoMagicLinks) {
      throw new ShopManagerAIError(ERROR_CODES.UPSTREAM_ERROR, sent.error ?? "Could not send the sign-in email.", { retryable: true });
    }
    return this.d.echoMagicLinks ? { ok: true, devLink: link } : { ok: true };
  }

  /** Consumes a magic link (sign-in, email confirmation, or password reset), creating the user on first use, and opens a session. */
  async consumeMagicLink(token: string, meta: { userAgent?: string } = {}): Promise<{ sessionToken: string; user: UserRow; redirect: string | null }> {
    const link = await this.d.magicLinks.consume(token);
    if (!link) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "This sign-in link is invalid or has expired. Request a new one.", { httpStatus: 401 });
    let user = await this.d.users.ensure({ userId: newId("usr"), email: link.email, emailVerified: true });
    // Clicking a link we emailed proves ownership of the address.
    if (!user.emailVerifiedAt) await this.d.users.markEmailVerified(user.userId);
    user = await this.syncRole(user);
    await this.d.users.touchLogin(user.userId);
    const sessionToken = await this.openSession(user.userId, meta.userAgent);
    return { sessionToken, user: (await this.d.users.get(user.userId))!, redirect: link.redirect };
  }

  /** Email + password signup. Sends a confirmation link; the account is usable immediately. */
  async signup(input: { email: string; password: string; name?: string }, meta: { userAgent?: string } = {}): Promise<{ sessionToken: string; user: UserRow; devLink?: string }> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Enter a valid email address.");
    const problem = passwordProblem(input.password);
    if (problem) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, problem);
    const existing = await this.d.users.getByEmail(email);
    if (existing?.hasPassword) throw new ShopManagerAIError(ERROR_CODES.VERSION_CONFLICT, "An account with this email already exists. Sign in instead.", { httpStatus: 409 });
    const hash = await hashPassword(input.password);
    let user: UserRow;
    if (existing) {
      // Account created earlier through a magic link: attach the password.
      await this.d.users.setPasswordHash(existing.userId, hash);
      if (input.name && !existing.name) await this.d.users.updateProfile(existing.userId, { name: input.name.trim() });
      user = (await this.d.users.get(existing.userId))!;
    } else {
      user = await this.d.users.ensure({ userId: newId("usr"), email, name: input.name?.trim(), passwordHash: hash });
    }
    user = await this.syncRole(user);
    await this.d.users.touchLogin(user.userId);
    const sessionToken = await this.openSession(user.userId, meta.userAgent);
    const verify = user.emailVerifiedAt ? undefined : await this.sendVerification(email);
    return { sessionToken, user, devLink: verify?.devLink };
  }

  /** Email + password sign-in. Same error for unknown email and wrong password. */
  async loginWithPassword(input: { email: string; password: string }, meta: { userAgent?: string } = {}): Promise<{ sessionToken: string; user: UserRow }> {
    const email = normalizeEmail(input.email);
    const generic = () => new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Email or password is incorrect.", { httpStatus: 401 });
    const attempts = await this.d.kv.get<{ n: number; until: number }>(`login_fail:${email}`);
    if (attempts && attempts.n >= 10 && attempts.until > Date.now()) throw new ShopManagerAIError(ERROR_CODES.RATE_LIMITED, "Too many failed sign-ins. Try again in 15 minutes or use an email link.", { retryable: true });
    const user = await this.d.users.getByEmail(email);
    if (!user) throw generic();
    if (!user.hasPassword) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "This account has no password yet. Use \"Email me a link\" to sign in, then set one in Settings.", { httpStatus: 401 });
    const ok = await verifyPassword(input.password, await this.d.users.getPasswordHash(user.userId));
    if (!ok) {
      await this.d.kv.set(`login_fail:${email}`, { n: (attempts?.n ?? 0) + 1, until: Date.now() + 15 * 60 * 1000 });
      throw generic();
    }
    await this.d.kv.delete(`login_fail:${email}`).catch(() => undefined);
    const synced = await this.syncRole(user);
    await this.d.users.touchLogin(user.userId);
    const sessionToken = await this.openSession(user.userId, meta.userAgent);
    return { sessionToken, user: synced };
  }

  async setPassword(userId: string, input: { current?: string; next: string }): Promise<void> {
    const problem = passwordProblem(input.next);
    if (problem) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, problem);
    const user = await this.requireUser(userId);
    if (user.hasPassword) {
      const ok = await verifyPassword(input.current ?? "", await this.d.users.getPasswordHash(userId));
      if (!ok) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Current password is incorrect.", { httpStatus: 403 });
    }
    await this.d.users.setPasswordHash(userId, await hashPassword(input.next));
  }

  /** Password reset = magic link that lands on Settings with the password form open. Never reveals whether the email exists. */
  async requestPasswordReset(rawEmail: string): Promise<{ ok: true; devLink?: string }> {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Enter a valid email address.");
    const user = await this.d.users.getByEmail(email);
    if (!user) return { ok: true };
    const recent = await this.d.magicLinks.countRecent(email, 60 * 60 * 1000);
    if (recent >= MAGIC_LINKS_PER_HOUR) return { ok: true };
    const token = randomBytes(32).toString("base64url");
    await this.d.magicLinks.create({ token, email, redirect: "/app/settings?reset=1", ttlMs: MAGIC_LINK_TTL_MS });
    const link = `${this.d.appUrl}/app/auth/verify?token=${encodeURIComponent(token)}`;
    await this.d.email.send({ to: email, ...resetPasswordTemplate({ brand: this.d.brand, link, minutes: MAGIC_LINK_TTL_MS / 60000 }) });
    return this.d.echoMagicLinks ? { ok: true, devLink: link } : { ok: true };
  }

  async sendVerification(rawEmail: string): Promise<{ ok: true; devLink?: string }> {
    const email = normalizeEmail(rawEmail);
    const recent = await this.d.magicLinks.countRecent(email, 60 * 60 * 1000);
    if (recent >= MAGIC_LINKS_PER_HOUR) return { ok: true };
    const token = randomBytes(32).toString("base64url");
    await this.d.magicLinks.create({ token, email, redirect: "/app?verified=1", ttlMs: 24 * 60 * 60 * 1000 });
    const link = `${this.d.appUrl}/app/auth/verify?token=${encodeURIComponent(token)}`;
    await this.d.email.send({ to: email, ...verifyEmailTemplate({ brand: this.d.brand, link }) });
    return this.d.echoMagicLinks ? { ok: true, devLink: link } : { ok: true };
  }

  /** ADMIN_EMAILS get the admin role; a removed email loses it on next sign-in. */
  private async syncRole(user: UserRow): Promise<UserRow> {
    const shouldBeAdmin = this.d.adminEmails.includes(user.email);
    if (shouldBeAdmin && user.role !== "admin") await this.d.users.setRole(user.userId, "admin");
    if (!shouldBeAdmin && user.role === "admin" && this.d.adminEmails.length > 0) await this.d.users.setRole(user.userId, "user");
    return (await this.d.users.get(user.userId))!;
  }

  private async openSession(userId: string, userAgent?: string): Promise<string> {
    const sessionToken = randomBytes(32).toString("base64url");
    await this.d.sessions.create({ sessionId: newId("ses"), token: sessionToken, userId, ttlMs: SESSION_TTL_MS, userAgent });
    return sessionToken;
  }

  // ---------------------------------------------------------------- operator (admin panel)

  /** Manual plan grant from the admin panel: seats decide the tier; null seats = revoke. */
  async adminSetPlan(userId: string, input: { seats: number | null; note?: string }): Promise<UserRow> {
    const user = await this.requireUser(userId);
    if (input.seats === null || input.seats <= 0) {
      await this.d.users.updatePlan(userId, { planState: "FREE", plan: null, seats: null, licenseRef: null, freemiusLicenseId: null, freemiusUserId: null, graceUntil: null });
    } else {
      await this.d.users.updatePlan(userId, { planState: input.seats > 1 ? "AGENCY_ACTIVE" : "PRO_ACTIVE", plan: "manual", seats: { shops: input.seats, members: user.seats?.members ?? 1 }, licenseRef: "manual:admin", graceUntil: null });
      await this.autoAssignSeats(userId);
    }
    await this.applySeats(userId);
    if (input.note !== undefined) await this.d.users.setNotes(userId, input.note);
    return (await this.d.users.get(userId))!;
  }

  async resolveSession(sessionToken: string | undefined | null): Promise<{ user: UserRow; sessionId: string } | null> {
    if (!sessionToken) return null;
    const session = await this.d.sessions.findByToken(sessionToken);
    if (!session) return null;
    const user = await this.d.users.get(session.userId);
    if (!user) return null;
    void this.d.sessions.touch(session.sessionId).catch(() => undefined);
    return { user, sessionId: session.sessionId };
  }

  async logout(sessionId: string): Promise<void> {
    await this.d.sessions.revoke(sessionId);
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.d.sessions.revokeAllForUser(userId);
  }

  // ---------------------------------------------------------------- shops

  /** Starts a store connection from the dashboard: returns the install URL and remembers who asked. */
  async beginConnect(userId: string, shopDomain: string): Promise<{ installUrl: string; shop: string }> {
    const shop = normalizeShopDomain(shopDomain);
    if (!shop) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Enter your store's myshopify.com domain, for example my-store.myshopify.com.");
    // Ten-minute claim so the OAuth callback (which has no dashboard cookie when Shopify redirects
    // top-level) can still attribute the install to this account.
    await this.d.kv.set(`connect_claim:${shop}`, { userId, createdAt: Date.now() });
    return { installUrl: `${this.d.appUrl}/auth?shop=${encodeURIComponent(shop)}`, shop };
  }

  /** Called from the OAuth callback: links the freshly installed shop to the account that started the install (or holds the session). */
  async completeConnect(shopId: string, sessionUserId: string | null): Promise<string | null> {
    let userId = sessionUserId;
    if (!userId) {
      const claim = await this.d.kv.get<{ userId: string; createdAt: number }>(`connect_claim:${shopId}`);
      if (claim && Date.now() - claim.createdAt < 10 * 60 * 1000) userId = claim.userId;
    }
    await this.d.kv.delete(`connect_claim:${shopId}`).catch(() => undefined);
    if (!userId) return null;
    await this.linkShop(userId, shopId);
    return userId;
  }

  async linkShop(userId: string, shopId: string): Promise<UserShopRow> {
    const user = await this.requireUser(userId);
    const link = await this.d.userShops.link({ userId, shopId, role: "owner" });
    // Auto-assign a seat when the plan has one free, so a paying customer never has to think about seats.
    if (ACTIVE_STATES.has(effectiveUserState(user)) && !link.proSeat) {
      const { used, total } = await this.seatUsage(userId);
      if (used < total) await this.d.userShops.setProSeat(userId, shopId, true);
    }
    await this.applySeats(userId);
    return (await this.d.userShops.get(userId, shopId))!;
  }

  async unlinkShop(userId: string, shopId: string): Promise<void> {
    const link = await this.d.userShops.get(userId, shopId);
    if (!link) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "That store is not linked to your account.");
    await this.d.userShops.unlink(userId, shopId);
    await this.releaseSeat(userId, shopId);
  }

  async setSeat(userId: string, shopId: string, pro: boolean): Promise<void> {
    const link = await this.d.userShops.get(userId, shopId);
    if (!link) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "That store is not linked to your account.");
    if (pro) {
      const user = await this.requireUser(userId);
      if (!ACTIVE_STATES.has(effectiveUserState(user))) throw new ShopManagerAIError(ERROR_CODES.PRO_REQUIRED, "Upgrade to Pro to assign a seat.");
      const { used, total } = await this.seatUsage(userId);
      if (!link.proSeat && used >= total) throw new ShopManagerAIError(ERROR_CODES.PRO_REQUIRED, `All ${total} shop seat(s) are in use. Free a seat or upgrade to Agency.`);
    }
    await this.d.userShops.setProSeat(userId, shopId, pro);
    await this.applySeats(userId);
  }

  async seatUsage(userId: string): Promise<{ used: number; total: number }> {
    const user = await this.requireUser(userId);
    const links = await this.d.userShops.listForUser(userId);
    return { used: links.filter((l) => l.proSeat).length, total: ACTIVE_STATES.has(effectiveUserState(user)) ? (user.seats?.shops ?? 1) : 0 };
  }

  /** Projects the account's plan onto the per-shop entitlement rows the tool gate reads. */
  async applySeats(userId: string): Promise<void> {
    const user = await this.requireUser(userId);
    const links = await this.d.userShops.listForUser(userId);
    const active = ACTIVE_STATES.has(effectiveUserState(user));
    const total = active ? (user.seats?.shops ?? 1) : 0;
    let granted = 0;
    for (const link of links) {
      const existing = await this.d.entitlements.get(link.shopId);
      const managedByThisAccount = !existing || existing.freemiusUserId === accountTag(userId) || existing.state === "FREE";
      if (!managedByThisAccount) continue; // a shop-level license from the embedded admin wins
      if (link.proSeat && granted < total) {
        granted++;
        await this.d.entitlements.upsert({
          shopId: link.shopId,
          state: user.planState,
          plan: user.plan ?? "pro",
          seats: user.seats ?? null,
          licenseRef: user.licenseRef ?? null,
          freemiusLicenseId: user.freemiusLicenseId ?? null,
          freemiusUserId: accountTag(userId),
          graceUntil: user.graceUntil ?? null,
        });
      } else if (existing && existing.freemiusUserId === accountTag(userId) && existing.state !== "FREE") {
        await this.d.entitlements.upsert({ shopId: link.shopId, state: "FREE", licenseRef: null, freemiusLicenseId: null, freemiusUserId: null, graceUntil: null, seats: null });
      }
      this.d.invalidateEntitlements(link.shopId);
    }
  }

  private async releaseSeat(userId: string, shopId: string): Promise<void> {
    const existing = await this.d.entitlements.get(shopId);
    if (existing && existing.freemiusUserId === accountTag(userId)) {
      await this.d.entitlements.upsert({ shopId, state: "FREE", licenseRef: null, freemiusLicenseId: null, freemiusUserId: null, graceUntil: null, seats: null });
      this.d.invalidateEntitlements(shopId);
    }
  }

  // ---------------------------------------------------------------- billing

  /** Manual fallback: paste the license key from the Freemius receipt email. */
  async activateLicense(userId: string, licenseKey: string): Promise<{ ok: true; planState: string; seats: number }> {
    if (!this.d.licenseActivation) throw new ShopManagerAIError(ERROR_CODES.NOT_SUPPORTED, "Billing is not configured on this server.");
    const key = licenseKey.trim();
    if (!key) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Paste your license key.");
    const verified = await this.d.licenseActivation.verify(key);
    if (!verified.ok) {
      const msg = verified.reason === "already_activated_elsewhere" ? "This license is already activated on another account." : verified.reason === "network_error" ? "Could not reach the billing provider. Try again." : "That license key was not accepted.";
      throw new ShopManagerAIError(verified.reason === "network_error" ? ERROR_CODES.UPSTREAM_ERROR : ERROR_CODES.INVALID_INPUT, msg, { retryable: verified.reason === "network_error" });
    }
    const planState = verified.seats > 1 ? "AGENCY_ACTIVE" : verified.state;
    await this.d.users.updatePlan(userId, {
      planState,
      plan: verified.plan,
      seats: { shops: verified.seats, members: 1 },
      licenseRef: verified.licenseRef,
      freemiusLicenseId: verified.freemiusLicenseId,
      freemiusUserId: verified.freemiusUserId,
      graceUntil: null,
    });
    await this.autoAssignSeats(userId);
    await this.applySeats(userId);
    return { ok: true, planState, seats: verified.seats };
  }

  /** Webhook path: Freemius told us about a license bound to an account. */
  async applyWebhookOutcome(binding: { accountId?: string; userEmail?: string; userId?: string; licenseId?: string; plan?: { name?: string | null; slug?: string | null; id?: string | number | null } | null; seats?: number }, outcome: string, graceUntil: string | null): Promise<boolean> {
    let user: UserRow | null = null;
    if (binding.accountId) user = await this.d.users.get(binding.accountId);
    if (!user && binding.userId) user = await this.d.users.getByFreemiusUserId(binding.userId);
    if (!user && binding.userEmail) user = await this.d.users.getByEmail(binding.userEmail);
    if (!user) return false;
    const active = ACTIVE_STATES.has(outcome);
    const seats = active ? (binding.seats ?? seatsForPlan(binding.plan ?? null)) : (user.seats?.shops ?? 1);
    // One Freemius plan with unit tiers: the quota, not the slug, says whether this is a multi-store (agency-tier) licence.
    const planState = outcome === "PRO_ACTIVE" && seats > 1 ? "AGENCY_ACTIVE" : outcome;
    await this.d.users.updatePlan(user.userId, {
      planState,
      plan: binding.plan?.slug ?? binding.plan?.name ?? (outcome === "AGENCY_ACTIVE" ? "agency" : "pro"),
      seats: { shops: seats, members: user.seats?.members ?? 1 },
      freemiusLicenseId: binding.licenseId ?? user.freemiusLicenseId ?? null,
      freemiusUserId: binding.userId ?? user.freemiusUserId ?? null,
      graceUntil,
    });
    if (active) await this.autoAssignSeats(user.userId);
    await this.applySeats(user.userId);
    this.d.log.info("account billing updated", { userId: user.userId, outcome, seats });
    return true;
  }

  async deactivateLicense(userId: string): Promise<void> {
    await this.d.users.updatePlan(userId, { planState: "FREE", plan: null, seats: null, licenseRef: null, freemiusLicenseId: null, freemiusUserId: null, graceUntil: null });
    await this.applySeats(userId);
  }

  /** Fills free seats with linked shops that have none yet, oldest first. */
  private async autoAssignSeats(userId: string): Promise<void> {
    const { used, total } = await this.seatUsage(userId);
    let free = total - used;
    if (free <= 0) return;
    for (const link of await this.d.userShops.listForUser(userId)) {
      if (free <= 0) break;
      if (!link.proSeat) {
        await this.d.userShops.setProSeat(userId, link.shopId, true);
        free--;
      }
    }
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const user = await this.d.users.get(userId);
    if (!user) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Sign in again.", { httpStatus: 401 });
    return user;
  }
}

export function normalizeShopDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null;
  return s;
}

function sanitizeRedirect(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  // Only same-app relative paths under /app are honoured (no open redirects).
  return /^\/app(\/[A-Za-z0-9_\-./?=&]*)?$/.test(redirect) ? redirect : null;
}
