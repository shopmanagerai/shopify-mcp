import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, EntitlementRepo, type OpenedDatabase } from "@shopmanagerai/storage";
import { effectiveState, FreemiusEntitlementProvider, GRACE_ENTITLEMENTS, PRO_ENTITLEMENTS } from "./provider.js";

describe("effectiveState", () => {
  it("keeps PRO_ACTIVE as-is", () => {
    expect(effectiveState("PRO_ACTIVE", null)).toBe("PRO_ACTIVE");
  });

  it("treats a PRO_EXPIRED row with a future graceUntil as PRO_GRACE", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    expect(effectiveState("PRO_EXPIRED", future)).toBe("PRO_GRACE");
  });

  it("collapses to PRO_EXPIRED once graceUntil has passed", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(effectiveState("PRO_EXPIRED", past)).toBe("PRO_EXPIRED");
    expect(effectiveState("PRO_GRACE", past)).toBe("PRO_EXPIRED");
  });

  it("falls back to FREE for an unknown state", () => {
    expect(effectiveState("SOMETHING_WEIRD", null)).toBe("FREE");
  });
});

describe("FreemiusEntitlementProvider", () => {
  let opened: OpenedDatabase;
  let repo: EntitlementRepo;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    repo = new EntitlementRepo(opened.db);
  });
  afterEach(() => opened.close());

  it("defaults an unknown shop to FREE", async () => {
    const provider = new FreemiusEntitlementProvider(repo);
    const state = await provider.getState("shop_none");
    expect(state.state).toBe("FREE");
    expect(state.entitlements).toContain("free.core");
  });

  it("returns the full pro.* set for PRO_ACTIVE", async () => {
    await repo.upsert({ shopId: "shop_1", state: "PRO_ACTIVE", plan: "pro" });
    const provider = new FreemiusEntitlementProvider(repo);
    const state = await provider.getState("shop_1");
    expect(state.state).toBe("PRO_ACTIVE");
    expect(state.entitlements).toEqual(PRO_ENTITLEMENTS);
    expect(await provider.has("shop_1", "pro.design_ai")).toBe(true);
  });

  it("returns only the read-only grace subset while grace is active", async () => {
    const graceUntil = new Date(Date.now() + 60_000).toISOString();
    await repo.upsert({ shopId: "shop_2", state: "PRO_EXPIRED", graceUntil });
    const provider = new FreemiusEntitlementProvider(repo);
    const state = await provider.getState("shop_2");
    expect(state.state).toBe("PRO_GRACE");
    expect(state.entitlements).toEqual(GRACE_ENTITLEMENTS);
    expect(await provider.has("shop_2", "pro.bulk")).toBe(false);
    expect(await provider.has("shop_2", "pro.seo_advanced")).toBe(true);
  });

  it("caches for the configured TTL, then re-reads storage", async () => {
    let now = 0;
    const provider = new FreemiusEntitlementProvider(repo, { cacheTtlMs: 1000, clock: () => new Date(now) });
    await repo.upsert({ shopId: "shop_3", state: "FREE" });

    const first = await provider.getState("shop_3");
    expect(first.state).toBe("FREE");

    // Mutate storage directly without going through the provider (simulating
    // a webhook write from elsewhere), should not be visible until the cache expires.
    await repo.upsert({ shopId: "shop_3", state: "PRO_ACTIVE" });
    const stillCached = await provider.getState("shop_3");
    expect(stillCached.state).toBe("FREE");

    now = 2000;
    const refreshed = await provider.getState("shop_3");
    expect(refreshed.state).toBe("PRO_ACTIVE");
  });

  it("invalidate() forces a fresh read even within the TTL window", async () => {
    const provider = new FreemiusEntitlementProvider(repo, { cacheTtlMs: 60_000 });
    await repo.upsert({ shopId: "shop_4", state: "FREE" });
    await provider.getState("shop_4");

    await repo.upsert({ shopId: "shop_4", state: "AGENCY_ACTIVE" });
    provider.invalidate("shop_4");
    const state = await provider.getState("shop_4");
    expect(state.state).toBe("AGENCY_ACTIVE");
    expect(state.entitlements).toContain("agency.multi_store");
  });
});
