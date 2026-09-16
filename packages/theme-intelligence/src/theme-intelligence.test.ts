import { describe, expect, it } from "vitest";
import { dawnMiniFiles } from "./__fixtures__/dawn-mini/index.js";
import { ThemeFileSet } from "./fileset.js";
import { inspectLiquid } from "./liquid.js";
import { buildArchitecture } from "./architecture.js";
import { buildDependencyGraph } from "./graph.js";
import { searchFiles, findReference } from "./search.js";
import { themeComplexity } from "./complexity.js";
import { extractDesignTokens, consistencyBasic } from "./design-tokens.js";
import { auditMetadata, auditHeadings, auditSchema, auditImageAlt } from "./seo-basic.js";
import { conflictsBasic } from "./conflicts-basic.js";
import { redactThemeFileSet } from "./redact-theme.js";

function makeFixture() {
  return new ThemeFileSet(dawnMiniFiles);
}

describe("ThemeFileSet", () => {
  it("indexes files by role and dir", () => {
    const fs = makeFixture();
    expect(fs.size).toBe(dawnMiniFiles.length);
    expect(fs.role("layout/theme.liquid")).toBe("layout");
    expect(fs.role("templates/index.json")).toBe("template_json");
    expect(fs.role("sections/header-group.json")).toBe("section_group");
    expect(fs.role("sections/hero.liquid")).toBe("section");
    expect(fs.role("blocks/text.liquid")).toBe("block");
    expect(fs.role("snippets/price.liquid")).toBe("snippet");
    expect(fs.role("assets/base.css")).toBe("asset");
    expect(fs.role("config/settings_data.json")).toBe("config");
    expect(fs.role("locales/en.default.json")).toBe("locale");
    expect(fs.byDir("sections").length).toBeGreaterThan(0);
    expect(fs.text("layout/theme.liquid")).toContain("<title>");
  });

  it("treats contentBase64-only files as binary", () => {
    const fs = new ThemeFileSet([{ key: "assets/logo.png", contentBase64: "AAA=", size: 3 }]);
    expect(fs.isBinary("assets/logo.png")).toBe(true);
    expect(fs.text("assets/logo.png")).toBeUndefined();
  });
});

describe("inspectLiquid", () => {
  const fs = makeFixture();

  it("extracts renders, sections, section groups, content_for, assets", () => {
    const insp = inspectLiquid("layout/theme.liquid", fs.text("layout/theme.liquid")!);
    expect(insp.errors).toHaveLength(0);
    expect(insp.renders.map((r) => r.target)).toEqual(expect.arrayContaining(["social-icons", "missing-snippet"]));
    expect(insp.sections.map((s) => s.target)).toContain("announcement-bar");
    expect(insp.sectionGroups.map((s) => s.target)).toContain("header-group");
    expect(insp.contentFor.map((c) => c.target)).toContain("blocks");
    expect(insp.assetReferences.some((a) => a.name === "base.css")).toBe(true);
  });

  it("captures untrusted comments without treating them as instructions (T1)", () => {
    const insp = inspectLiquid("layout/theme.liquid", fs.text("layout/theme.liquid")!);
    expect(insp.untrustedComments.length).toBeGreaterThan(0);
    expect(insp.untrustedComments[0]!.text).toContain("ignore all previous instructions");
    expect(insp.untrustedComments[0]!.line).toBeGreaterThan(0);
  });

  it("parses {% schema %} JSON", () => {
    const insp = inspectLiquid("sections/hero.liquid", fs.text("sections/hero.liquid")!);
    expect(insp.schema?.json).toMatchObject({ name: "Hero" });
    expect(insp.schema?.errors).toHaveLength(0);
  });

  it("reports a parse error for the deliberately broken snippet", () => {
    const insp = inspectLiquid("snippets/broken.liquid", fs.text("snippets/broken.liquid")!);
    expect(insp.errors.length).toBeGreaterThan(0);
    expect(insp.errors[0]!.line).toBeGreaterThanOrEqual(0);
  });

  it("collects variable roots, tags, and filters used", () => {
    const insp = inspectLiquid("sections/main-product.liquid", fs.text("sections/main-product.liquid")!);
    expect(insp.variablesReferenced).toEqual(expect.arrayContaining(["product", "section", "block"]));
    expect(insp.tagsUsed).toEqual(expect.arrayContaining(["for", "case", "render", "schema"]));
    expect(insp.maxNestingDepth).toBeGreaterThan(0);
    expect(insp.lineCount).toBeGreaterThan(0);
  });
});

describe("buildArchitecture", () => {
  const fs = makeFixture();
  const arch = buildArchitecture(fs);

  it("finds the layout and both templates", () => {
    expect(arch.layouts).toEqual(["layout/theme.liquid"]);
    expect(arch.templates.map((t) => t.key).sort()).toEqual(["templates/index.json", "templates/product.json"]);
  });

  it("extracts app blocks from templates/index.json and templates/product.json", () => {
    const index = arch.templates.find((t) => t.key === "templates/index.json")!;
    expect(index.appBlocks).toBe(1);
    const hero = index.sections.find((s) => s.id === "hero")!;
    expect(hero.blocks[0]!.isAppBlock).toBe(true);
    expect(hero.blocks[0]!.type).toContain("shopify://apps/judge-me-reviews");

    const product = arch.templates.find((t) => t.key === "templates/product.json")!;
    expect(product.appBlocks).toBe(1);
  });

  it("builds section groups", () => {
    expect(arch.sectionGroups).toHaveLength(1);
    expect(arch.sectionGroups[0]!.sections.map((s) => s.id)).toEqual(["logo", "nav"]);
  });

  it("marks sections accepting @app blocks", () => {
    const hero = arch.sections.find((s) => s.key === "sections/hero.liquid")!;
    expect(hero.acceptsAppBlocks).toBe(true);
    const announcement = arch.sections.find((s) => s.key === "sections/announcement-bar.liquid")!;
    expect(announcement.acceptsAppBlocks).toBe(false);
  });

  it("extracts settings_schema summary and settings_data app embeds", () => {
    expect(arch.config.settingsSchema.length).toBeGreaterThan(0);
    expect(arch.config.settingsData.appEmbeds).toHaveLength(1);
    expect(arch.config.settingsData.appEmbeds[0]!.type).toContain("shopify://apps/loox-reviews");
  });

  it("counts files by category", () => {
    expect(arch.counts.total).toBe(fs.size);
    expect(arch.counts.snippets).toBe(fs.byRole("snippet").length);
  });
});

describe("buildDependencyGraph", () => {
  const fs = makeFixture();
  const arch = buildArchitecture(fs);
  const graph = buildDependencyGraph(fs, arch);

  it("finds the unused snippet", () => {
    expect(graph.unusedFiles()).toContain("snippets/unused-snippet.liquid");
  });

  it("does not consider referenced snippets unused", () => {
    expect(graph.unusedFiles()).not.toContain("snippets/social-icons.liquid");
    expect(graph.unusedFiles()).not.toContain("snippets/price.liquid");
  });

  it("finds the orphan reference to the missing snippet", () => {
    const orphans = graph.orphanReferences();
    expect(orphans.some((e) => e.to === "snippets/missing-snippet.liquid")).toBe(true);
  });

  it("resolves references and back-references", () => {
    expect(graph.referencesOf("layout/theme.liquid")).toEqual(expect.arrayContaining(["snippets/social-icons.liquid"]));
    expect(graph.referencedBy("snippets/social-icons.liquid").length).toBeGreaterThan(0);
  });

  it("produces a focused excerpt from a root", () => {
    const excerpt = graph.focusedExcerpt("layout/theme.liquid", 2);
    expect(excerpt).toContain("layout/theme.liquid");
    expect(excerpt.length).toBeGreaterThan(1);
  });
});

describe("search", () => {
  const fs = makeFixture();

  it("finds text matches with line numbers", () => {
    const matches = searchFiles(fs, { query: "asset_url", maxResults: 50 });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.line).toBeGreaterThan(0);
  });

  it("finds a settings id reference", () => {
    const matches = findReference(fs, "heading");
    expect(matches.some((m) => m.kind === "settings_id")).toBe(true);
  });
});

describe("complexity", () => {
  it("computes theme-level complexity with an explanation", () => {
    const c = themeComplexity(makeFixture());
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.explanation.length).toBeGreaterThan(0);
    expect(c.files.length).toBeGreaterThan(0);
  });
});

describe("design tokens", () => {
  const tokens = extractDesignTokens(makeFixture());

  it("extracts colors from settings and CSS", () => {
    expect(tokens.colors.length).toBeGreaterThan(0);
    expect(tokens.colors.some((c) => c.value.toLowerCase() === "#336699")).toBe(true);
  });

  it("extracts spacing, radii, shadows, breakpoints", () => {
    expect(tokens.spacing.length).toBeGreaterThan(0);
    expect(tokens.radii.length).toBeGreaterThan(0);
    expect(tokens.shadows.length).toBeGreaterThan(0);
    expect(tokens.breakpoints.length).toBeGreaterThan(0);
  });

  it("flags off-scale spacing as a basic consistency finding", () => {
    const findings = consistencyBasic(tokens);
    expect(findings.some((f) => f.category === "design_tokens")).toBe(true);
  });
});

describe("seo-basic", () => {
  const fs = makeFixture();

  it("audits metadata against the layout", () => {
    const findings = auditMetadata(fs);
    // title/meta description/canonical/og:title are present; robots is absent.
    expect(findings.some((f) => f.title.includes("robots"))).toBe(true);
  });

  it("flags images without alt text", () => {
    const findings = auditImageAlt(fs);
    expect(findings.some((f) => f.location?.file === "sections/announcement-bar.liquid")).toBe(true);
  });

  it("runs heading and schema audits without throwing", () => {
    expect(() => auditHeadings(fs)).not.toThrow();
    expect(() => auditSchema(fs)).not.toThrow();
  });
});

describe("conflicts-basic", () => {
  const fs = makeFixture();
  const arch = buildArchitecture(fs);
  const graph = buildDependencyGraph(fs, arch);

  it("finds duplicate schema ids", () => {
    const findings = conflictsBasic(fs, graph);
    expect(findings.some((f) => f.category === "conflicts_schema")).toBe(true);
  });

  it("finds a global CSS rule inside a scoped style block", () => {
    const findings = conflictsBasic(fs, graph);
    expect(findings.some((f) => f.category === "conflicts_css" && f.title.includes("Global"))).toBe(true);
  });

  it("surfaces orphan references from the graph", () => {
    const findings = conflictsBasic(fs, graph);
    expect(findings.some((f) => f.category === "conflicts_orphan")).toBe(true);
  });

  it("finds the duplicated base.css script include", () => {
    const findings = conflictsBasic(fs, graph);
    expect(findings.some((f) => f.category === "conflicts_scripts" && f.title.includes("more than once"))).toBe(true);
  });
});

describe("redact-theme", () => {
  it("masks the leaked Shopify admin token", () => {
    const fs = makeFixture();
    const report = redactThemeFileSet(fs);
    expect(report.maskedKeys).toContain("assets/leaked-config.js");
    const redacted = report.files.find((f) => f.key === "assets/leaked-config.js")!;
    expect(redacted.content).not.toContain("shpat_abcdefghij1234567890");
    expect(redacted.content).toContain("[REDACTED]");
  });

  it("leaves clean files untouched", () => {
    const fs = makeFixture();
    const report = redactThemeFileSet(fs);
    expect(report.maskedKeys).not.toContain("layout/theme.liquid");
  });
});
