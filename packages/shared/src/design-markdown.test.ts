import { describe, expect, it } from "vitest";
import { manifestToMarkdown, markdownToManifest, manifestSummaryForInstructions } from "./design-markdown.js";
import type { DesignManifest } from "./design-manifest.js";

const manifest: DesignManifest = {
  brand: { personality: ["precise", "quiet"], tone: "plain words", targetCustomer: "riders 25-40" },
  color: { primary: "#0E1116", accent: "#FF4D2E", surfaces: ["#F4F6F8", "#FFFFFF"], semantic: { success: "#1c7c4d" } },
  typography: { families: ["Fraunces", "Inter"], weights: [400, 500, 600], scale: [12, 16, 44, 110], headingStyle: "tight display" },
  layout: { containerWidths: [1600], gaps: [16, 24, 40], density: "airy" },
  components: { buttons: { radius: "99rem", style: "pill" } },
  motion: { reveals: "16px rise + fade, once", reducedMotion: "static" },
  commerce: { ctaHierarchy: ["Shop all boards", "Find your size"] },
};

describe("DESIGN.md codec", () => {
  it("round-trips a manifest through markdown", () => {
    const md = manifestToMarkdown({ name: "Alpine editorial", manifest });
    expect(md.startsWith("# Design: Alpine editorial")).toBe(true);
    expect(md).toContain("## Color");
    expect(md).toContain("- primary: #0E1116");
    expect(md).toContain("- container widths: 1600");
    expect(md).toContain("```json");
    const back = markdownToManifest(md);
    expect(back.name).toBe("Alpine editorial");
    expect(back.manifest).toEqual(manifest);
  });

  it("keeps prose and unknown keys as notes instead of dropping them", () => {
    const md = `# Design: Notes test

Intro paragraph about the brand.

## Color
The accent is used three times per page.
- primary: #111111
- vibe: moody

## Typography
- families: Inter
`;
    const doc = markdownToManifest(md);
    expect(doc.intro).toBe("Intro paragraph about the brand.");
    expect(doc.manifest.color).toEqual({ primary: "#111111" });
    expect(doc.notes.color).toContain("The accent is used three times per page.");
    expect(doc.notes.color).toContain("- vibe: moody");
    expect(doc.manifest.typography?.families).toEqual(["Inter"]);
  });

  it("rejects wrong shapes with a field-level message", () => {
    expect(() => markdownToManifest("# Design: Bad\n\n## Typography\n- weights: heavy, light\n")).toThrow(/weights/);
  });

  it("summarises the active design for server instructions as fenced, backtick-free text", () => {
    const s = manifestSummaryForInstructions("Alp`ine", manifest);
    expect(s).toContain("```design");
    expect(s).toContain("name: Alp'ine");
    expect(s).toContain("colour: primary #0E1116, accent #FF4D2E");
    expect(s).toContain("type: Fraunces + Inter (tight display)");
    expect(s).toContain("untrusted data");
  });
});
