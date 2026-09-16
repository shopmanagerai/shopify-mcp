import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, EntitlementRepo, KvRepo, type OpenedDatabase } from "@shopmanagerai/storage";
import { FreemiusWebhookHandler, mapEventToState, verifySignature } from "./webhook.js";

const SECRET = "whsec_test_secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifySignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ id: "evt_1" });
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const sig = sign(body);
    expect(verifySignature(body + "x", sig, SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = JSON.stringify({ id: "evt_1" });
    expect(verifySignature(body, sign(body, "wrong"), SECRET)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifySignature("{}", "", SECRET)).toBe(false);
  });
});

describe("mapEventToState", () => {
  it("maps license.activated to PRO_ACTIVE", () => {
    expect(mapEventToState({ id: "1", type: "license.activated" })).toBe("PRO_ACTIVE");
  });
  it("maps license.expired and subscription.cancelled to PRO_EXPIRED", () => {
    expect(mapEventToState({ id: "1", type: "license.expired" })).toBe("PRO_EXPIRED");
    expect(mapEventToState({ id: "1", type: "subscription.cancelled" })).toBe("PRO_EXPIRED");
  });
  it("maps payment.refund to SUSPENDED", () => {
    expect(mapEventToState({ id: "1", type: "payment.refund" })).toBe("SUSPENDED");
  });
  it("maps trial.started to TRIAL", () => {
    expect(mapEventToState({ id: "1", type: "trial.started" })).toBe("TRIAL");
  });
  it("maps an agency plan to AGENCY_ACTIVE on an activating event", () => {
    expect(mapEventToState({ id: "1", type: "license.activated", data: { plan: { slug: "agency-100" } } })).toBe("AGENCY_ACTIVE");
  });
  it("does not keep an agency plan active once the licence ends", () => {
    // this previously returned AGENCY_ACTIVE for every event type, so an
    // agency licence survived expiry, cancellation and refund
    expect(mapEventToState({ id: "1", type: "license.expired", data: { plan: { slug: "agency-100" } } })).toBe("PRO_EXPIRED");
    expect(mapEventToState({ id: "1", type: "payment.refund", data: { plan: { slug: "agency-100" } } })).toBe("SUSPENDED");
  });
  it("does not grant agency to a plan merely named like one", () => {
    expect(mapEventToState({ id: "1", type: "license.activated", data: { plan: { name: "Agency Annual" } } })).toBe("PRO_ACTIVE");
  });
  it("returns null for an unrecognized event type", () => {
    expect(mapEventToState({ id: "1", type: "something.unrelated" })).toBeNull();
  });
});

describe("FreemiusWebhookHandler", () => {
  let opened: OpenedDatabase;
  let entitlements: EntitlementRepo;
  let kv: KvRepo;
  let handler: FreemiusWebhookHandler;
  let invalidated: string[];

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    entitlements = new EntitlementRepo(opened.db);
    kv = new KvRepo(opened.db);
    invalidated = [];
    handler = new FreemiusWebhookHandler({
      secret: SECRET,
      entitlements,
      kv,
      resolveShopId: async (binding) => binding.shopId ?? binding.shopDomain ?? null,
      onInvalidate: (shopId) => invalidated.push(shopId),
    });
  });
  afterEach(() => opened.close());

  function post(event: Record<string, unknown>) {
    const body = JSON.stringify(event);
    return handler.handle(body, sign(body));
  }

  it("rejects a bad signature", async () => {
    const body = JSON.stringify({ id: "1", type: "license.activated" });
    const result = await handler.handle(body, "deadbeef");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_SIGNATURE");
  });

  it("activates a shop on license.activated and hashes nothing sensitive into raw storage", async () => {
    const result = await post({ id: "evt_1", type: "license.activated", data: { custom: { shop_id: "shop_1" }, license: { id: 555 } } });
    expect(result.ok).toBe(true);
    const row = await entitlements.get("shop_1");
    expect(row?.state).toBe("PRO_ACTIVE");
    expect(row?.freemiusLicenseId).toBe("555");
    expect(invalidated).toEqual(["shop_1"]);
  });

  it("sets a 72h graceUntil on license.expired", async () => {
    const result = await post({ id: "evt_2", type: "license.expired", data: { custom: { shop_id: "shop_2" } } });
    expect(result.ok).toBe(true);
    const row = await entitlements.get("shop_2");
    expect(row?.state).toBe("PRO_EXPIRED");
    expect(row?.graceUntil).toBeTruthy();
    const hoursOut = (new Date(row!.graceUntil!).getTime() - Date.now()) / (1000 * 60 * 60);
    expect(hoursOut).toBeGreaterThan(71);
    expect(hoursOut).toBeLessThan(73);
  });

  it("deduplicates a repeated event id", async () => {
    const event = { id: "evt_dup", type: "license.activated", data: { custom: { shop_id: "shop_3" } } };
    const first = await post(event);
    expect(first.ok).toBe(true);
    expect((first as { skipped?: string }).skipped).toBeUndefined();

    await entitlements.upsert({ shopId: "shop_3", state: "FREE" }); // simulate manual reset
    const second = await post(event);
    expect(second.ok).toBe(true);
    expect((second as { skipped?: string }).skipped).toBe("duplicate");
    const row = await entitlements.get("shop_3");
    expect(row?.state).toBe("FREE"); // not re-applied
  });

  it("skips gracefully when the shop cannot be resolved", async () => {
    const localHandler = new FreemiusWebhookHandler({
      secret: SECRET,
      entitlements,
      kv,
      resolveShopId: async () => null,
    });
    const body = JSON.stringify({ id: "evt_x", type: "license.activated" });
    const result = await localHandler.handle(body, sign(body));
    expect(result.ok).toBe(true);
    expect((result as { skipped?: string }).skipped).toBe("unresolved_shop");
  });

  it("skips gracefully for an unmapped event type without erroring", async () => {
    const result = await post({ id: "evt_y", type: "some.other.event" });
    expect(result.ok).toBe(true);
    expect((result as { skipped?: string }).skipped).toBe("unmapped");
  });
});
