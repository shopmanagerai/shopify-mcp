/**
 * Which Freemius plan grants which tier, and how many store seats it carries.
 *
 * Matching is against a stable identifier (slug or id), exact, from an
 * allowlist. Anything unrecognised resolves to "pro" with one seat, never to
 * a bigger plan: an unknown plan should under-grant and be reported, not
 * over-grant. (An earlier rule matched the substring "agency" in the display
 * name, which let "Agency trial" grant agency access forever.)
 *
 * The slugs mirror `freemiusPlanSlug` in apps/site/src/data/pricing.ts. If a
 * plan is added there, add it here too: the site sells it, this decides what
 * it unlocks.
 */

/** Plan tiers this product sells. `free` needs no Freemius licence. */
export type PlanTier = "free" | "pro" | "agency";

/** Effectively unlimited seats; large enough that no account hits it. */
export const UNLIMITED_SEATS = 100_000;

/**
 * Store seats per plan slug. Single-seat plans are plain Pro; anything with
 * more than one seat carries the `agency.*` entitlements (multi-store, team,
 * cross-store), because that is what those entitlements gate.
 */
export const PLAN_SEATS: Record<string, number> = {
  pro: 1,
  growth: 10,
  scale: 100,
  agency: UNLIMITED_SEATS,
  // pre-2026-09 slugs, kept so an old licence still resolves
  operator: 1,
  studio: 10,
  "agency-100": 100,
  network: 300,
  enterprise: UNLIMITED_SEATS,
};

/** Normalises a Freemius plan reference to a comparable slug. */
function normaliseSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * A Freemius plan as it may arrive on a webhook or an activation response.
 * Freemius' exact field set is UNVERIFIED, so every field is optional and the
 * most stable identifier available is preferred.
 */
export interface FreemiusPlanRef {
  slug?: string | null;
  id?: string | number | null;
  name?: string | null;
}

/**
 * Resolves a plan reference to its tier and seat count.
 *
 * Preference order is slug, then id, then name, name last because it is the
 * only one a human edits in the Freemius dashboard. A name is still accepted
 * (some payloads carry nothing else) but only as an exact match against a
 * known slug once normalised, never as a substring.
 */
export function resolvePlanTier(plan: FreemiusPlanRef | null | undefined): {
  tier: PlanTier;
  recognised: boolean;
  slug: string | null;
  seats: number;
} {
  const candidates = [plan?.slug, plan?.id === undefined || plan?.id === null ? null : String(plan.id), plan?.name]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map(normaliseSlug);

  for (const slug of candidates) {
    const seats = PLAN_SEATS[slug];
    if (seats !== undefined) return { tier: seats > 1 ? "agency" : "pro", recognised: true, slug, seats };
  }

  return { tier: "pro", recognised: false, slug: candidates[0] ?? null, seats: 1 };
}

/** True when the plan carries the `agency.*` entitlements (more than one store seat). */
export function isAgencyPlan(plan: FreemiusPlanRef | null | undefined): boolean {
  return resolvePlanTier(plan).tier === "agency";
}

/** Store seats a plan grants; 1 for anything unrecognised. */
export function seatsForPlan(plan: FreemiusPlanRef | null | undefined): number {
  return resolvePlanTier(plan).seats;
}
