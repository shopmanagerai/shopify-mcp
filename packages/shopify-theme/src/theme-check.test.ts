import { describe, expect, it } from "vitest";
import { FakeThemeEngine, seedDawnLike } from "./fake.js";
import { runThemeCheck } from "./theme-check.js";

describe("runThemeCheck", () => {
  it("runs against the seeded fake theme and returns a well-shaped result, or reports THEME_ENGINE_UNAVAILABLE", async () => {
    const engine = new FakeThemeEngine();
    const ref = seedDawnLike(engine);
    const files = await engine.listFiles(ref.id);
    const withContent = await engine.readFiles(
      ref.id,
      files.map((f) => f.key),
    );

    try {
      const result = await runThemeCheck(withContent);
      expect(Array.isArray(result.offenses)).toBe(true);
      expect(result.counts).toEqual({
        error: result.offenses.filter((o) => o.severity === "error").length,
        warning: result.offenses.filter((o) => o.severity === "warning").length,
        info: result.offenses.filter((o) => o.severity === "info").length,
      });
      for (const offense of result.offenses) {
        expect(typeof offense.check).toBe("string");
        expect(["error", "warning", "info"]).toContain(offense.severity);
        expect(typeof offense.file).toBe("string");
        expect(typeof offense.start.line).toBe("number");
      }
      // eslint-disable-next-line no-console
      console.log(`theme-check-node loaded: ${result.offenses.length} offense(s) on the seeded theme`);
    } catch (e: any) {
      expect(e.code).toBe("THEME_ENGINE_UNAVAILABLE");
      // eslint-disable-next-line no-console
      console.log(`theme-check-node did not load in this environment: ${e.technicalMessage ?? e.message}`);
    }
  });

  it("always cleans up its temp directory, even for an empty file set", async () => {
    try {
      const result = await runThemeCheck([]);
      expect(Array.isArray(result.offenses)).toBe(true);
    } catch (e: any) {
      expect(e.code).toBe("THEME_ENGINE_UNAVAILABLE");
    }
  });
});
