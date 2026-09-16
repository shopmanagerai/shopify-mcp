/**
 * Server-side license-key activation against Freemius (docs/
 * CURRENT_FREEMIUS_RESEARCH.md). UNVERIFIED: the exact
 * `/v1/products/{id}/licenses/activate.json` request/response shape below is
 * inferred from Freemius's public docs, not confirmed against a live
 * account, treat field names as best-effort and re-verify before shipping.
 *
 * The raw license key is never persisted: only its sha256 hash (`licenseRef`)
 * is stored, and only after Freemius itself confirms activation.
 */
import { createHash } from "node:crypto";
import type { EntitlementRepo } from "@shopmanagerai/storage";
import { isAgencyPlan, seatsForPlan, UNLIMITED_SEATS } from "./plans.js";

export type FetchLike = typeof fetch;

export interface LicenseActivationOptions {
  productId: string;
  secretKey: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
}

export interface ActivationResult {
  ok: boolean;
  reason?: "invalid_key" | "network_error" | "already_activated_elsewhere";
  message?: string;
}

/** What a successful Freemius activation told us, for callers that bind licenses to accounts rather than shops. */
export interface VerifiedLicense {
  state: "PRO_ACTIVE" | "AGENCY_ACTIVE";
  plan: string;
  licenseRef: string;
  freemiusLicenseId: string | null;
  freemiusUserId: string | null;
  /** Shop seats the license carries: the plan's seat count (plans.ts), or Freemius quota when it reports one. */
  seats: number;
}

export type VerifyResult = ({ ok: true } & VerifiedLicense) | { ok: false; reason: NonNullable<ActivationResult["reason"]>; message?: string };

function hashLicenseKey(key: string): string {
  return `sha256:${createHash("sha256").update(key, "utf8").digest("hex")}`;
}

export class LicenseActivation {
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly entitlements: EntitlementRepo,
    private readonly opts: LicenseActivationOptions,
  ) {
    this.apiBase = (opts.apiBase ?? "https://api.freemius.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Activates a license key server-side. On Freemius success, upserts
   * PRO_ACTIVE with a hashed `licenseRef`, the plaintext key is discarded
   * immediately after the request. On a network/transport error the prior
   * entitlement state is left untouched (fail safe, not fail open/closed).
   */
  async activateKey(shopId: string, licenseKey: string): Promise<ActivationResult> {
    const verified = await this.verify(licenseKey);
    if (!verified.ok) return { ok: false, reason: verified.reason, message: verified.message };
    await this.entitlements.upsert({
      shopId,
      state: verified.state,
      plan: verified.plan,
      licenseRef: verified.licenseRef,
      freemiusLicenseId: verified.freemiusLicenseId,
      freemiusUserId: verified.freemiusUserId,
      graceUntil: null,
    });
    return { ok: true };
  }

  /** Calls Freemius to activate the key and returns what it said; writes nothing. */
  async verify(licenseKey: string): Promise<VerifyResult> {
    const url = `${this.apiBase}/v1/products/${this.opts.productId}/licenses/activate.json`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.secretKey}`,
        },
        body: JSON.stringify({ license_key: licenseKey }),
      });
    } catch (e) {
      return { ok: false, reason: "network_error", message: e instanceof Error ? e.message : String(e) };
    }

    if (!response.ok) {
      if (response.status === 409) return { ok: false, reason: "already_activated_elsewhere" };
      return { ok: false, reason: "invalid_key", message: `Freemius rejected the license key (HTTP ${response.status}).` };
    }

    let body: {
      license?: { id?: string | number };
      user?: { id?: string | number };
      // slug and id are preferred over name when Freemius sends them: a display
      // name is the one field a human edits in the dashboard.
      plan?: { name?: string; slug?: string; id?: string | number };
      quota?: number | string | null;
      activations_limit?: number | string;
      is_unlimited?: boolean;
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Freemius returned 2xx with an unparseable body, still treat as activated
      // (UNVERIFIED response shape), just without license/user ids to record.
    }

    // A successful activation is by definition active, so the plan only picks
    // the tier. Matching is on a stable identifier, not a display name.
    const state = isAgencyPlan(body.plan ?? null) ? "AGENCY_ACTIVE" : "PRO_ACTIVE";
    const unlimited = ("quota" in body && body.quota === null) || body.is_unlimited === true;
    const quota = Number(body.quota ?? body.activations_limit ?? NaN);
    return {
      ok: true,
      state,
      plan: body.plan?.name ?? (state === "AGENCY_ACTIVE" ? "agency" : "pro"),
      licenseRef: hashLicenseKey(licenseKey),
      freemiusLicenseId: body.license?.id !== undefined ? String(body.license.id) : null,
      freemiusUserId: body.user?.id !== undefined ? String(body.user.id) : null,
      seats: unlimited ? UNLIMITED_SEATS : Number.isFinite(quota) && quota > 0 ? quota : seatsForPlan(body.plan ?? null),
    };
  }

  /** Deactivates locally (moves the shop back to FREE). Does not call Freemius. */
  async deactivate(shopId: string): Promise<void> {
    await this.entitlements.upsert({ shopId, state: "FREE", licenseRef: null, freemiusLicenseId: null, freemiusUserId: null, graceUntil: null });
  }
}
