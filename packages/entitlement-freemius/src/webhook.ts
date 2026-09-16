/**
 * Freemius webhook ingestion (docs/CURRENT_FREEMIUS_RESEARCH.md, event names
 * and payload shape are UNVERIFIED against a live Freemius account; this
 * module is deliberately tolerant of shape drift and documents every
 * assumption inline).
 *
 * Signature verification: HMAC-SHA256 over the *raw* request body using
 * FREEMIUS_WEBHOOK_SECRET, constant-time compared against the signature
 * header. UNVERIFIED: the exact header name and encoding Freemius sends , 
 * `verifySignature` accepts a caller-supplied signature string so the HTTP
 * layer can adapt to whichever header Freemius actually uses.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EntitlementRepo } from "@shopmanagerai/storage";
import type { KvRepo } from "@shopmanagerai/storage";
import { GRACE_WINDOW_MS } from "./provider.js";
import { isAgencyPlan, seatsForPlan, UNLIMITED_SEATS, type FreemiusPlanRef } from "./plans.js";

export interface FreemiusEvent {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export type FreemiusStateOutcome = "PRO_ACTIVE" | "PRO_EXPIRED" | "TRIAL" | "AGENCY_ACTIVE" | "SUSPENDED" | "FREE" | null;

/** Constant-time HMAC-SHA256 verification over the raw body. */
export function verifySignature(rawBody: string, signatureHex: string, secret: string): boolean {
  if (!signatureHex || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHex.trim().toLowerCase().replace(/^sha256=/, ""), "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Maps a Freemius event type to the resulting entitlement state.
 * UNVERIFIED event names, mapped per the task brief:
 *   license.activated | license.created | license.extended -> PRO_ACTIVE
 *   license.expired | license.cancelled | subscription.cancelled -> PRO_EXPIRED (+72h grace)
 *   payment.refund -> SUSPENDED
 *   trial.started -> TRIAL
 *
 * The plan only decides *which* active tier is granted. It never decides
 * whether the licence is active: an expired, cancelled or refunded agency
 * licence loses access exactly like any other. An earlier version tested the
 * plan name before this switch, so any plan named "agency" stayed active
 * permanently and survived a refund, see plans.ts.
 */
export function mapEventToState(event: FreemiusEvent): FreemiusStateOutcome {
  const plan = ((event.data as any)?.plan ?? (event as any).plan ?? null) as FreemiusPlanRef | null;

  switch (event.type) {
    case "license.activated":
    case "license.created":
    case "license.extended":
      return isAgencyPlan(plan) ? "AGENCY_ACTIVE" : "PRO_ACTIVE";
    case "license.expired":
    case "license.cancelled":
    case "subscription.cancelled":
      return "PRO_EXPIRED";
    case "payment.refund":
      return "SUSPENDED";
    case "trial.started":
      return "TRIAL";
    default:
      return null;
  }
}

/** UNVERIFIED: exact field names Freemius uses for shop binding on custom metadata. */
export interface EventBinding {
  shopDomain?: string;
  shopId?: string;
  /** ShopManager account (users.user_id) the checkout was started from; billing binds to the account, not a shop. */
  accountId?: string;
  licenseId?: string;
  userId?: string;
  userEmail?: string;
  plan?: FreemiusPlanRef | null;
  /** Shop seats on the license when Freemius reports one (quota / activations limit). */
  seats?: number;
}

export function shopBindingFromEvent(event: FreemiusEvent): EventBinding {
  const data = (event.data as any) ?? {};
  const custom = data.custom ?? (event as any).custom ?? {};
  const license = data.license ?? (event as any).license ?? {};
  // Freemius: license.quota = units bought; an explicit null quota means the unlimited-units tier.
  const unlimited = ("quota" in license && license.quota === null) || license.is_unlimited === true;
  const quota = Number(license.quota ?? license.activations_limit ?? data.quota ?? NaN);
  const plan = (data.plan ?? (event as any).plan ?? null) as FreemiusPlanRef | null;
  return {
    shopDomain: custom.shop_domain ?? custom.shopDomain,
    shopId: custom.shop_id ?? custom.shopId,
    accountId: custom.account_id ?? custom.accountId,
    licenseId: license.id ? String(license.id) : undefined,
    userId: data.user?.id ? String(data.user.id) : undefined,
    userEmail: typeof data.user?.email === "string" ? data.user.email : undefined,
    plan,
    seats: unlimited ? UNLIMITED_SEATS : Number.isFinite(quota) && quota > 0 ? quota : plan ? seatsForPlan(plan) : undefined,
  };
}

export interface ResolveShopId {
  (binding: { shopDomain?: string; shopId?: string; licenseId?: string }): Promise<string | null>;
}

/** Account-level handler: receives the mapped outcome for a checkout bound to a ShopManager account. Return true when handled. */
export interface ApplyToAccount {
  (binding: EventBinding, outcome: Exclude<FreemiusStateOutcome, null>, graceUntil: string | null, event: FreemiusEvent): Promise<boolean>;
}

export interface FreemiusWebhookHandlerOptions {
  secret: string;
  entitlements: EntitlementRepo;
  kv: KvRepo;
  resolveShopId: ResolveShopId;
  applyToAccount?: ApplyToAccount;
  clock?: () => Date;
  onInvalidate?: (shopId: string) => void;
}

export type WebhookResult =
  | { ok: true; skipped?: "duplicate" | "unmapped" | "unresolved_shop"; account?: true }
  | { ok: false; code: "INVALID_SIGNATURE" | "INVALID_PAYLOAD"; message: string };

export class FreemiusWebhookHandler {
  constructor(private readonly opts: FreemiusWebhookHandlerOptions) {}

  async handle(rawBody: string, signatureHeader: string | null | undefined): Promise<WebhookResult> {
    if (!verifySignature(rawBody, signatureHeader ?? "", this.opts.secret)) {
      return { ok: false, code: "INVALID_SIGNATURE", message: "Freemius webhook signature did not verify." };
    }

    let event: FreemiusEvent;
    try {
      event = JSON.parse(rawBody) as FreemiusEvent;
    } catch {
      return { ok: false, code: "INVALID_PAYLOAD", message: "Webhook body was not valid JSON." };
    }
    if (!event || typeof event !== "object" || !event.id || !event.type) {
      return { ok: false, code: "INVALID_PAYLOAD", message: "Webhook payload missing id/type." };
    }

    const dedupeKey = `freemius:event:${event.id}`;
    const already = await this.opts.kv.get<{ processedAt: string }>(dedupeKey);
    if (already) return { ok: true, skipped: "duplicate" };

    const outcome = mapEventToState(event);
    if (!outcome) {
      await this.opts.kv.set(dedupeKey, { processedAt: (this.opts.clock?.() ?? new Date()).toISOString(), type: event.type, mapped: false });
      return { ok: true, skipped: "unmapped" };
    }

    const binding = shopBindingFromEvent(event);
    const now0 = this.opts.clock?.() ?? new Date();
    if (this.opts.applyToAccount && (binding.accountId || binding.userEmail || binding.userId)) {
      const grace = outcome === "PRO_EXPIRED" ? new Date(now0.getTime() + GRACE_WINDOW_MS).toISOString() : null;
      const handled = await this.opts.applyToAccount(binding, outcome, grace, event);
      if (handled) {
        await this.opts.kv.set(dedupeKey, { processedAt: now0.toISOString(), type: event.type, mapped: true, resolved: true, accountId: binding.accountId ?? null });
        return { ok: true, account: true };
      }
    }
    const shopId = await this.opts.resolveShopId(binding);
    if (!shopId) {
      await this.opts.kv.set(dedupeKey, { processedAt: (this.opts.clock?.() ?? new Date()).toISOString(), type: event.type, mapped: true, resolved: false });
      return { ok: true, skipped: "unresolved_shop" };
    }

    const now = this.opts.clock?.() ?? new Date();
    // A license.expired/cancelled webhook stores the raw "PRO_EXPIRED" state
    // directly, but starts a 72h grace window (see provider.ts effectiveState)
    // during which the shop still gets read-only Pro tools.
    const graceUntil = outcome === "PRO_EXPIRED" ? new Date(now.getTime() + GRACE_WINDOW_MS).toISOString() : null;

    await this.opts.entitlements.upsert({
      shopId,
      state: outcome,
      freemiusLicenseId: binding.licenseId ?? null,
      freemiusUserId: binding.userId ?? null,
      graceUntil,
      rawLastEvent: event as unknown as Record<string, unknown>,
    });
    this.opts.onInvalidate?.(shopId);

    await this.opts.kv.set(dedupeKey, { processedAt: now.toISOString(), type: event.type, mapped: true, resolved: true, shopId });
    return { ok: true };
  }
}
