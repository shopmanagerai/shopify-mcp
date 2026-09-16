import { describe, expect, it } from "vitest";
import { FakeThemeEngine, seedDawnLike } from "./fake.js";

describe("FakeThemeEngine", () => {
  it("lists themes after seeding", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const themes = await engine.listThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0]!.id).toBe(ref.id);
    expect(themes[0]!.role).toBe("main");
  });

  it("reads seeded files back with content", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const [layout] = await engine.readFiles(ref.id, ["layout/theme.liquid"]);
    expect(layout?.content).toContain("content_for_header");
  });

  it("listFiles returns metadata only (no content)", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const files = await engine.listFiles(ref.id);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(f.content).toBeUndefined();
      expect(f.contentBase64).toBeUndefined();
    }
  });

  it("listFiles filters by prefix", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const files = await engine.listFiles(ref.id, { prefix: "sections/" });
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.key.startsWith("sections/")).toBe(true);
  });

  it("writeFiles validates keys and rejects invalid ones", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const result = await engine.writeFiles(ref.id, [
      { key: "snippets/new.liquid", content: "hello" },
      { key: "../escape.liquid", content: "bad" },
    ]);
    expect(result.written).toEqual(["snippets/new.liquid"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe("../escape.liquid");
  });

  it("deleteFiles removes existing files and reports missing ones", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const result = await engine.deleteFiles(ref.id, ["snippets/icon-cart.liquid", "snippets/nope.liquid"]);
    expect(result.deleted).toEqual(["snippets/icon-cart.liquid"]);
    expect(result.errors).toEqual([{ key: "snippets/nope.liquid", message: "not found" }]);
  });

  it("duplicateTheme copies all files into a new unpublished theme", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const dup = await engine.duplicateTheme(ref.id, "Working copy");
    expect(dup.role).toBe("unpublished");
    expect(dup.id).not.toBe(ref.id);
    const files = await engine.listFiles(dup.id);
    const originalFiles = await engine.listFiles(ref.id);
    expect(files.length).toBe(originalFiles.length);
  });

  it("publishTheme demotes the previous main theme", async () => {
    const engine = new FakeThemeEngine();
    const live = seedDawnLike(engine, { name: "Live", role: "main" });
    const dup = await engine.duplicateTheme(live.id, "Working");
    const published = await engine.publishTheme(dup.id);
    expect(published.role).toBe("main");
    const liveAfter = await engine.getTheme(live.id);
    expect(liveAfter?.role).toBe("unpublished");
  });

  it("deleteTheme removes the theme", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    await engine.deleteTheme(ref.id);
    expect(await engine.getTheme(ref.id)).toBeNull();
  });

  it("renameTheme updates the name", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const renamed = await engine.renameTheme(ref.id, "New name");
    expect(renamed.name).toBe("New name");
  });

  it("throws NOT_FOUND for operations on an unknown theme id", async () => {
    const engine = new FakeThemeEngine();
    await expect(engine.readFiles("999", ["layout/theme.liquid"])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("seedDawnLike includes an app block and an app embed", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const [product, settingsData] = await engine.readFiles(ref.id, ["templates/product.json", "config/settings_data.json"]);
    expect(product?.content).toContain("shopify://apps/judge-me-reviews/blocks/review-widget/abc123");
    expect(settingsData?.content).toContain("shopify://apps/klaviyo/blocks/onsite/xyz");
  });
});
