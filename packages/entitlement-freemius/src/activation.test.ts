import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, EntitlementRepo, type OpenedDatabase } from "@shopmanagerai/storage";
import { LicenseActivation, type FetchLike } from "./activation.js";

function fakeFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response): FetchLike {
  return (async (url: any, init?: any) => impl(String(url), init)) as unknown as FetchLike;
}

describe("LicenseActivation", () => {
  let opened: OpenedDatabase;
  let repo: EntitlementRepo;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    repo = new EntitlementRepo(opened.db);
  });
  afterEach(() => opened.close());

  it("activates successfully and stores only a hashed licenseRef, never the raw key", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ license: { id: 42 }, user: { id: 7 }, plan: { name: "pro" } }), { status: 200 }));
    const activation = new LicenseActivation(repo, { productId: "123", secretKey: "sk_test", fetchImpl });

    const result = await activation.activateKey("shop_1", "SECRET-LICENSE-KEY-XYZ");
    expect(result.ok).toBe(true);

    const row = await repo.get("shop_1");
    expect(row?.state).toBe("PRO_ACTIVE");
    expect(row?.freemiusLicenseId).toBe("42");
    expect(row?.licenseRef).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(row?.licenseRef).not.toContain("SECRET-LICENSE-KEY-XYZ");
    expect(JSON.stringify(row)).not.toContain("SECRET-LICENSE-KEY-XYZ");
  });

  it("activates AGENCY_ACTIVE for a known agency plan", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ plan: { name: "Agency" } }), { status: 200 }));
    const activation = new LicenseActivation(repo, { productId: "123", secretKey: "sk_test", fetchImpl });
    await activation.activateKey("shop_2", "KEY");
    const row = await repo.get("shop_2");
    expect(row?.state).toBe("AGENCY_ACTIVE");
  });

  it("rejects an invalid key without mutating stored entitlement state", async () => {
    await repo.upsert({ shopId: "shop_3", state: "FREE" });
    const fetchImpl = fakeFetch(() => new Response("bad key", { status: 422 }));
    const activation = new LicenseActivation(repo, { productId: "123", secretKey: "sk_test", fetchImpl });

    const result = await activation.activateKey("shop_3", "BAD-KEY");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_key");
    const row = await repo.get("shop_3");
    expect(row?.state).toBe("FREE");
  });

  it("on a network error, keeps the prior entitlement state untouched", async () => {
    await repo.upsert({ shopId: "shop_4", state: "PRO_ACTIVE", plan: "pro" });
    const fetchImpl = fakeFetch(() => {
      throw new Error("ECONNRESET");
    });
    const activation = new LicenseActivation(repo, { productId: "123", secretKey: "sk_test", fetchImpl });

    const result = await activation.activateKey("shop_4", "SOME-KEY");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network_error");
    const row = await repo.get("shop_4");
    expect(row?.state).toBe("PRO_ACTIVE");
  });

  it("deactivate() moves a shop back to FREE and clears license fields", async () => {
    await repo.upsert({ shopId: "shop_5", state: "PRO_ACTIVE", licenseRef: "sha256:abc", freemiusLicenseId: "1" });
    const activation = new LicenseActivation(repo, { productId: "123", secretKey: "sk_test", fetchImpl: fakeFetch(() => new Response("{}")) });
    await activation.deactivate("shop_5");
    const row = await repo.get("shop_5");
    expect(row?.state).toBe("FREE");
    expect(row?.licenseRef).toBeNull();
  });
});
