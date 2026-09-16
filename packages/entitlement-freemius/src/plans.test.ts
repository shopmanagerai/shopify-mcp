import { describe, expect, it } from "vitest";
import { isAgencyPlan, resolvePlanTier, seatsForPlan, UNLIMITED_SEATS } from "./plans.js";

describe("resolvePlanTier", () => {
  it("maps the sold plans to seats and tiers", () => {
    expect(resolvePlanTier({ slug: "pro" })).toEqual({ tier: "pro", recognised: true, slug: "pro", seats: 1 });
    expect(resolvePlanTier({ slug: "growth" })).toEqual({ tier: "agency", recognised: true, slug: "growth", seats: 10 });
    expect(resolvePlanTier({ slug: "scale" })).toEqual({ tier: "agency", recognised: true, slug: "scale", seats: 100 });
    expect(resolvePlanTier({ slug: "agency" })).toEqual({ tier: "agency", recognised: true, slug: "agency", seats: UNLIMITED_SEATS });
  });
  it("still resolves the legacy slugs", () => {
    expect(seatsForPlan({ slug: "operator" })).toBe(1);
    expect(seatsForPlan({ slug: "studio" })).toBe(10);
    expect(isAgencyPlan({ slug: "enterprise" })).toBe(true);
  });
  it("prefers slug over a misleading display name", () => {
    expect(resolvePlanTier({ slug: "pro", name: "Agency" }).tier).toBe("pro");
  });
  it("never matches a display name by substring", () => {
    for (const name of ["Agency trial", "Studio (agency add-on)", "Pro Agency Bundle"]) {
      expect(isAgencyPlan({ name })).toBe(false);
    }
    expect(isAgencyPlan({ name: "Agency" })).toBe(true); // exact, normalised
  });
  it("under-grants unknown plans", () => {
    expect(resolvePlanTier({ slug: "mystery" })).toEqual({ tier: "pro", recognised: false, slug: "mystery", seats: 1 });
    expect(resolvePlanTier(null)).toEqual({ tier: "pro", recognised: false, slug: null, seats: 1 });
  });
});
