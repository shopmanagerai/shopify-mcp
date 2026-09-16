import { describe, expect, it } from "vitest";
import { ThemeFileSet, buildArchitecture } from "@shopmanagerai/theme-intelligence";
import { dawnMiniFiles } from "@shopmanagerai/theme-intelligence/fixtures/dawn-mini";
import { detectApps, SCRIPT_TAG_SUNSET_DATE } from "./detect.js";
import { buildIntegrationMap, preservationManifestBasic, checkPreservation } from "./integration-map.js";

function makeArch() {
  const fileSet = new ThemeFileSet(dawnMiniFiles);
  const architecture = buildArchitecture(fileSet);
  return { fileSet, architecture };
}

describe("detectApps", () => {
  it("detects app blocks from templates with confidence 1.0", () => {
    const { fileSet, architecture } = makeArch();
    const apps = detectApps({ fileSet, architecture });
    const judgeMe = apps.find((a) => a.id === "judge-me-reviews");
    expect(judgeMe).toBeDefined();
    expect(judgeMe!.confidence).toBe(1.0);
    expect(judgeMe!.integrationTypes).toContain("app_block");
    expect(judgeMe!.locations.some((l) => l.file === "templates/index.json")).toBe(true);
    expect(judgeMe!.locations.some((l) => l.file === "templates/product.json")).toBe(true);
    expect(judgeMe!.name).toBe("Judge.me Product Reviews");
    expect(judgeMe!.category).toBe("reviews");
  });

  it("detects app embeds from settings_data.json with confidence 1.0", () => {
    const { fileSet, architecture } = makeArch();
    const apps = detectApps({ fileSet, architecture });
    const loox = apps.find((a) => a.id === "loox-reviews");
    expect(loox).toBeDefined();
    expect(loox!.confidence).toBe(1.0);
    expect(loox!.integrationTypes).toContain("app_embed");
    expect(loox!.locations.some((l) => l.file === "config/settings_data.json")).toBe(true);
  });

  it("flags legacy script tags with a sunset warning at confidence 0.9", () => {
    const { fileSet, architecture } = makeArch();
    const apps = detectApps({
      fileSet,
      architecture,
      // hotjar has no other evidence in the fixture, so its confidence is driven
      // purely by this script tag match (unlike judge-me, which is already at 1.0
      // via its app block).
      scriptTags: [{ id: "1", src: "https://static.hotjar.com/c/hotjar-123.js", displayScope: "all" }],
    });
    const app = apps.find((a) => a.integrationTypes.includes("script_tag"));
    expect(app).toBeDefined();
    expect(app!.confidence).toBe(0.9);
    expect(app!.id).toBe("hotjar");
    const scriptEvidence = app!.evidence.find((e) => e.label === "legacy script tag");
    expect(String(scriptEvidence?.value)).toContain(SCRIPT_TAG_SUNSET_DATE);
  });

  it("matches known apps via theme references (snippet/asset/css)", () => {
    const fileSet = new ThemeFileSet([
      ...dawnMiniFiles,
      { key: "snippets/klaviyo-form.liquid", content: "<div>klaviyo form</div>", size: 30 },
    ]);
    const architecture = buildArchitecture(fileSet);
    const apps = detectApps({ fileSet, architecture });
    const klaviyo = apps.find((a) => a.id === "klaviyo");
    expect(klaviyo).toBeDefined();
    expect(klaviyo!.integrationTypes).toContain("theme_reference");
    expect(klaviyo!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(klaviyo!.confidence).toBeLessThanOrEqual(0.8);
  });

  it("records metafield namespace matches at confidence 0.5", () => {
    const { fileSet, architecture } = makeArch();
    const apps = detectApps({ fileSet, architecture, metafieldNamespaces: ["judgeme"] });
    const judgeMe = apps.find((a) => a.id === "judge-me-reviews");
    expect(judgeMe!.integrationTypes).toContain("metafield_namespace");
    // confidence is the max across evidence, so app_block's 1.0 still wins here, assert the
    // namespace evidence itself was recorded.
    expect(judgeMe!.evidence.some((e) => e.label === "metafield namespace")).toBe(true);
  });

  it("records rendered script hosts at confidence 0.7 for unknown apps", () => {
    const { fileSet, architecture } = makeArch();
    const apps = detectApps({ fileSet, architecture, renderedScriptHosts: ["totally-unknown-app.example.com"] });
    const unknown = apps.find((a) => a.id === "script:totally-unknown-app.example.com");
    expect(unknown).toBeDefined();
    expect(unknown!.name).toBeUndefined();
    expect(unknown!.confidence).toBe(0.7);
    expect(unknown!.integrationTypes).toContain("rendered_script");
  });
});

describe("integration map", () => {
  it("maps app blocks and embeds to their template/config locations", () => {
    const { architecture } = makeArch();
    const map = buildIntegrationMap(architecture);
    const indexEntry = map.find((e) => e.location === "templates/index.json");
    expect(indexEntry?.appBlocks[0]).toMatchObject({ appId: "judge-me-reviews", sectionId: "hero" });
    const settingsEntry = map.find((e) => e.location === "config/settings_data.json");
    expect(settingsEntry?.appEmbeds[0]).toMatchObject({ appId: "loox-reviews" });
  });

  it("builds a basic preservation manifest marking reviews as critical", () => {
    const { fileSet, architecture } = makeArch();
    const detected = detectApps({ fileSet, architecture });
    const manifest = preservationManifestBasic(detected, architecture);
    const judgeMeEntry = manifest.find((e) => e.app === "judge-me-reviews");
    expect(judgeMeEntry).toBeDefined();
    expect(judgeMeEntry!.importance).toBe("critical");
    expect(judgeMeEntry!.action).toBe("preserve");
    expect(judgeMeEntry!.verification).toBe("dom");
  });

  it("catches a removed app block via checkPreservation", () => {
    const { fileSet, architecture: before } = makeArch();
    // Simulate a theme write that dropped the judge-me app block from templates/index.json.
    const strippedIndex = JSON.stringify({
      sections: { hero: { type: "hero" }, featured: { type: "featured-collection" } },
      order: ["hero", "featured"],
    });
    const afterFileSet = new ThemeFileSet(
      dawnMiniFiles.map((f) => (f.key === "templates/index.json" ? { ...f, content: strippedIndex } : f)),
    );
    const after = buildArchitecture(afterFileSet);
    const { missing, added } = checkPreservation(before, after);
    expect(missing.some((m) => m.app === "judge-me-reviews" && m.location === "templates/index.json")).toBe(true);
    // The product.json app block is untouched, so it should not show up as missing.
    expect(missing.some((m) => m.location === "templates/product.json")).toBe(false);
    expect(added).toHaveLength(0);
    void fileSet;
  });
});
