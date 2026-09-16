import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "./db.js";
import { DesignManifestRepo, EntitlementRepo } from "./repos.js";

describe("storage: design manifests", () => {
  let opened: OpenedDatabase;
  let repo: DesignManifestRepo;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    repo = new DesignManifestRepo(opened.db);
  });
  afterEach(() => {
    opened.close();
  });

  it("creates a manifest at version 1 and auto-increments on subsequent creates", async () => {
    const first = await repo.create({
      manifestId: "dm_1",
      shopId: "shop_1",
      name: "v1",
      manifest: { color: { primary: "#000000" } },
      source: "authored",
      createdBy: "cred_1",
    });
    expect(first.version).toBe(1);

    const second = await repo.create({
      manifestId: "dm_2",
      shopId: "shop_1",
      name: "v2",
      manifest: { color: { primary: "#111111" } },
      source: "authored",
      createdBy: "cred_1",
    });
    expect(second.version).toBe(2);
  });

  it("activate flag deactivates prior active manifests for the shop", async () => {
    await repo.create({ manifestId: "dm_a", shopId: "shop_1", name: "a", manifest: {}, source: "authored", createdBy: "c", activate: true });
    await repo.create({ manifestId: "dm_b", shopId: "shop_1", name: "b", manifest: {}, source: "authored", createdBy: "c", activate: true });

    const active = await repo.getActive("shop_1");
    expect(active?.manifestId).toBe("dm_b");
    const a = await repo.get("dm_a");
    expect(a?.isActive).toBe(false);
  });

  it("setActive switches the active manifest", async () => {
    await repo.create({ manifestId: "dm_x", shopId: "shop_2", name: "x", manifest: {}, source: "authored", createdBy: "c", activate: true });
    await repo.create({ manifestId: "dm_y", shopId: "shop_2", name: "y", manifest: {}, source: "authored", createdBy: "c" });

    await repo.setActive("shop_2", "dm_y");
    const active = await repo.getActive("shop_2");
    expect(active?.manifestId).toBe("dm_y");
  });

  it("lists manifests for a shop ordered by version desc, and delete removes one", async () => {
    await repo.create({ manifestId: "dm_1", shopId: "shop_3", name: "a", manifest: {}, source: "authored", createdBy: "c" });
    await repo.create({ manifestId: "dm_2", shopId: "shop_3", name: "b", manifest: {}, source: "authored", createdBy: "c" });

    const list = await repo.list("shop_3");
    expect(list.map((m) => m.manifestId)).toEqual(["dm_2", "dm_1"]);

    await repo.delete("dm_2");
    const afterDelete = await repo.list("shop_3");
    expect(afterDelete.map((m) => m.manifestId)).toEqual(["dm_1"]);
  });
});

describe("storage: entitlements", () => {
  let opened: OpenedDatabase;
  let repo: EntitlementRepo;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    repo = new EntitlementRepo(opened.db);
  });
  afterEach(() => {
    opened.close();
  });

  it("returns null for a shop with no entitlement row", async () => {
    expect(await repo.get("shop_none")).toBeNull();
  });

  it("upserts and preserves fields not passed on a subsequent partial upsert", async () => {
    await repo.upsert({
      shopId: "shop_1",
      state: "PRO_ACTIVE",
      plan: "pro",
      entitlements: ["pro.design_ai"],
      licenseRef: "hash123",
    });
    const row = await repo.upsert({ shopId: "shop_1", state: "PRO_GRACE", graceUntil: "2026-01-01T00:00:00.000Z" });
    expect(row.state).toBe("PRO_GRACE");
    expect(row.plan).toBe("pro");
    expect(row.entitlements).toEqual(["pro.design_ai"]);
    expect(row.licenseRef).toBe("hash123");
    expect(row.graceUntil).toBe("2026-01-01T00:00:00.000Z");
  });

  it("never requires a raw license key field, only licenseRef (a hash) is stored", async () => {
    const row = await repo.upsert({ shopId: "shop_2", state: "PRO_ACTIVE", licenseRef: "sha256:abcdef" });
    expect(row.licenseRef).toBe("sha256:abcdef");
    expect(JSON.stringify(row)).not.toMatch(/license_key|licenseKey/i);
  });
});
