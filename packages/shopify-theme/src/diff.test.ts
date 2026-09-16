import { describe, expect, it } from "vitest";
import type { ThemeFile } from "@shopmanagerai/shared";
import { diffFileSets, diffStrings, summarizeFileSetDiff } from "./diff.js";

describe("diffStrings", () => {
  it("produces a unified diff between two strings", () => {
    const patch = diffStrings("line1\nline2\n", "line1\nline2-changed\n", { fileNameBefore: "a.txt", fileNameAfter: "a.txt" });
    expect(patch).toContain("-line2");
    expect(patch).toContain("+line2-changed");
  });

  it("produces an empty-ish diff for identical strings", () => {
    const patch = diffStrings("same\n", "same\n");
    expect(patch).not.toContain("-same");
  });
});

describe("diffFileSets / summarizeFileSetDiff", () => {
  const before: ThemeFile[] = [
    { key: "sections/hero.liquid", content: "old hero" },
    { key: "sections/gone.liquid", content: "removed section" },
    { key: "assets/base.css", content: "body{}" },
  ];
  const after: ThemeFile[] = [
    { key: "sections/hero.liquid", content: "new hero" },
    { key: "assets/base.css", content: "body{}" },
    { key: "sections/new.liquid", content: "added section" },
  ];

  it("classifies added, removed, changed, and unchanged files", () => {
    const entries = diffFileSets(before, after);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e.kind]));
    expect(byKey["sections/hero.liquid"]).toBe("changed");
    expect(byKey["sections/gone.liquid"]).toBe("removed");
    expect(byKey["sections/new.liquid"]).toBe("added");
    expect(byKey["assets/base.css"]).toBe("unchanged");
  });

  it("includes a unified diff for changed files", () => {
    const entries = diffFileSets(before, after);
    const hero = entries.find((e) => e.key === "sections/hero.liquid");
    expect(hero?.diff).toContain("-old hero");
    expect(hero?.diff).toContain("+new hero");
  });

  it("summarizes the file set diff", () => {
    const summary = summarizeFileSetDiff(before, after);
    expect(summary.added.map((a) => a.key)).toEqual(["sections/new.liquid"]);
    expect(summary.removed.map((r) => r.key)).toEqual(["sections/gone.liquid"]);
    expect(summary.changed.map((c) => c.key)).toEqual(["sections/hero.liquid"]);
    expect(summary.unchangedCount).toBe(1);
  });

  it("handles binary (base64) files without content text", () => {
    const b: ThemeFile[] = [{ key: "assets/logo.png", contentBase64: Buffer.from("abc").toString("base64") }];
    const a: ThemeFile[] = [{ key: "assets/logo.png", contentBase64: Buffer.from("abcd").toString("base64") }];
    const entries = diffFileSets(b, a);
    expect(entries[0]!.kind).toBe("changed");
  });
});
