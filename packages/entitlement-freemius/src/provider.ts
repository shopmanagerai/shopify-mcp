/**
 * Freemius-backed EntitlementProvider (docs/FREE_PRO_AGENCY_MATRIX.md).
 *
 * State -> entitlement-set mapping:
 *   FREE          -> free.*
 *   TRIAL         -> pro.* (full Pro access during trial)
 *   PRO_ACTIVE    -> pro.*
 *   PRO_GRACE     -> a read-only Pro subset only (["pro.seo_advanced",
 *                    "pro.conflict_doctor", "pro.app_compat", "pro.perf_a11y"]) , 
 *                    Freemius was unreachable to reconfirm the license within
 *                    72h of the last confirmed PRO_ACTIVE state; write-risk
 *                    Pro tools (bulk, orchestration, auto_repair, content,
 *                    design_ai, visual_ai) fall back to Free.
 *   PRO_EXPIRED   -> free.* (license lapsed with no valid grace window)
 *   AGENCY_ACTIVE -> pro.* + agency.*
 *   SUSPENDED     -> free.* (refunded/chargeback. No paid features)
 *
 * Grace itself is time-boxed: if `grace_until` has passed, the shop is
 * treated as PRO_EXPIRED even though the stored `state` may still say
 * PRO_GRACE until the next webhook/activation call corrects it.
 */
import { BRAND, type Entitlement, type EntitlementProvider, type EntitlementState } from "@shopmanagerai/shared";
import type { EntitlementRepo } from "@shopmanagerai/storage";

export const FREE_ENTITLEMENTS: Entitlement[] = ["free.core", "free.theme", "free.catalog", "free.seo_basic", "free.visual_capture"];
export const PRO_ENTITLEMENTS: Entitlement[] = [
  "pro.design_ai",
  "pro.visual_ai",
  "pro.auto_repair",
  "pro.seo_advanced",
  "pro.conflict_doctor",
  "pro.app_compat",
  "pro.bulk",
  "pro.orchestration",
  "pro.content",
  "pro.perf_a11y",
  "pro.commerce_ops",
  "pro.analytics",
  "pro.extensions",
];
export const AGENCY_ONLY_ENTITLEMENTS: Entitlement[] = ["agency.multi_store", "agency.team", "agency.cross_store"];
/** Read-only Pro subset kept alive during the 72h grace window. */
export const GRACE_ENTITLEMENTS: Entitlement[] = ["pro.seo_advanced", "pro.conflict_doctor", "pro.app_compat", "pro.perf_a11y"];

export const GRACE_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface EntitlementSnapshot {
  state: EntitlementState;
  plan?: string;
  entitlements: Entitlement[];
  seats?: { shops: number; members: number };
  upgradeUrl: string;
  graceUntil?: string;
}

function entitlementsFor(state: EntitlementState): Entitlement[] {
  switch (state) {
    case "TRIAL":
    case "PRO_ACTIVE":
      return PRO_ENTITLEMENTS;
    case "PRO_GRACE":
      return GRACE_ENTITLEMENTS;
    case "AGENCY_ACTIVE":
      return [...PRO_ENTITLEMENTS, ...AGENCY_ONLY_ENTITLEMENTS];
    case "PRO_EXPIRED":
    case "SUSPENDED":
    case "FREE":
    default:
      return FREE_ENTITLEMENTS;
  }
}

/**
 * Effective state after applying grace-window expiry (pure, no I/O).
 *
 * The stored row's `state` is the raw Freemius-derived state (e.g. a
 * license.expired webhook stores "PRO_EXPIRED" directly, alongside a
 * `graceUntil` 72h out). While `graceUntil` is still in the future, the
 * *effective* state served to tools is "PRO_GRACE" (a read-only Pro
 * subset) rather than the raw "PRO_EXPIRED". This is the 72h soft-landing
 * window described in docs/FREE_PRO_AGENCY_MATRIX.md. Once it passes, the
 * effective state collapses to the raw one.
 */
export function effectiveState(state: string, graceUntil: string | null, now: Date = new Date()): EntitlementState {
  const graceActive = !!graceUntil && new Date(graceUntil).getTime() >= now.getTime();
  if ((state === "PRO_EXPIRED" || state === "PRO_GRACE") && graceActive) return "PRO_GRACE";
  if (state === "PRO_GRACE" && !graceActive) return "PRO_EXPIRED";
  const known: EntitlementState[] = ["FREE", "TRIAL", "PRO_ACTIVE", "PRO_GRACE", "PRO_EXPIRED", "AGENCY_ACTIVE", "SUSPENDED"];
  return (known as string[]).includes(state) ? (state as EntitlementState) : "FREE";
}

interface CacheEntry {
  value: EntitlementSnapshot;
  expiresAt: number;
}

export interface FreemiusEntitlementProviderOptions {
  cacheTtlMs?: number;
  upgradeUrl?: string;
  clock?: () => Date;
}

export class FreemiusEntitlementProvider implements EntitlementProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly upgradeUrl: string;
  private readonly clock: () => Date;

  constructor(
    private readonly repo: EntitlementRepo,
    opts: FreemiusEntitlementProviderOptions = {},
  ) {
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
    this.upgradeUrl = opts.upgradeUrl ?? `https://${BRAND.domain}/upgrade`;
    this.clock = opts.clock ?? (() => new Date());
  }

  /** Drops any cached snapshot for a shop, call after a webhook/activation write. */
  invalidate(shopId: string): void {
    this.cache.delete(shopId);
  }

  async getState(shopId: string): Promise<EntitlementSnapshot> {
    const cached = this.cache.get(shopId);
    const now = this.clock();
    if (cached && cached.expiresAt > now.getTime()) return cached.value;

    const row = await this.repo.get(shopId);
    const snapshot: EntitlementSnapshot = row
      ? {
          state: effectiveState(row.state, row.graceUntil, now),
          plan: row.plan ?? undefined,
          entitlements: entitlementsFor(effectiveState(row.state, row.graceUntil, now)),
          seats: row.seats ?? undefined,
          upgradeUrl: this.upgradeUrl,
          graceUntil: row.graceUntil ?? undefined,
        }
      : {
          state: "FREE",
          plan: "free",
          entitlements: FREE_ENTITLEMENTS,
          upgradeUrl: this.upgradeUrl,
        };

    this.cache.set(shopId, { value: snapshot, expiresAt: now.getTime() + this.cacheTtlMs });
    return snapshot;
  }

  async has(shopId: string, e: Entitlement): Promise<boolean> {
    const state = await this.getState(shopId);
    return state.entitlements.includes(e);
  }
}
