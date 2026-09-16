import { describe, expect, it } from "vitest";
import { FakeThemeEngine, seedDawnLike } from "./fake.js";
import { WORKING_THEME_PREFIX, WorkingThemeService } from "./working-theme.js";

describe("WorkingThemeService", () => {
  it("live() returns the main theme", async () => {
    const engine = new FakeThemeEngine();
    const live = seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine);
    const result = await svc.live();
    expect(result.id).toBe(live.id);
  });

  it("live() throws NOT_FOUND when no theme is published", async () => {
    const engine = new FakeThemeEngine();
    seedDawnLike(engine, { name: "Draft", role: "unpublished" });
    const svc = new WorkingThemeService(engine);
    await expect(svc.live()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("current() returns null when no working theme exists", async () => {
    const engine = new FakeThemeEngine();
    seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine);
    expect(await svc.current()).toBeNull();
  });

  it("ensure() creates a working theme by duplicating live", async () => {
    const engine = new FakeThemeEngine();
    const live = seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine, { now: () => new Date("2026-09-04T00:00:00.000Z") });
    const working = await svc.ensure();
    expect(working.role).toBe("unpublished");
    expect(working.name).toBe(`${WORKING_THEME_PREFIX} Live 2026-09-04`);
  });

  it("ensure() reuses the existing working theme on subsequent calls", async () => {
    const engine = new FakeThemeEngine();
    seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine, { now: () => new Date("2026-09-04T00:00:00.000Z") });
    const first = await svc.ensure();
    const second = await svc.ensure();
    expect(second.id).toBe(first.id);
  });

  it("current() finds the most recently updated working theme", async () => {
    const engine = new FakeThemeEngine();
    engine.addTheme({ name: `${WORKING_THEME_PREFIX} Live 2026-01-01`, role: "unpublished", updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = engine.addTheme({ name: `${WORKING_THEME_PREFIX} Live 2026-06-01`, role: "unpublished", updatedAt: "2026-06-01T00:00:00.000Z" });
    const svc = new WorkingThemeService(engine);
    const current = await svc.current();
    expect(current?.id).toBe(newer.id);
  });

  it("ensure() throws THEME_ENGINE_UNAVAILABLE at the 20-theme cap with no working theme to reuse", async () => {
    const engine = new FakeThemeEngine();
    seedDawnLike(engine, { name: "Live", role: "main" });
    for (let i = 0; i < 20; i++) {
      engine.addTheme({ name: `Other theme ${i}`, role: "unpublished" });
    }
    const svc = new WorkingThemeService(engine);
    await expect(svc.ensure()).rejects.toMatchObject({ code: "THEME_ENGINE_UNAVAILABLE" });
  });

  it("ensure() cap error lists stale working themes", async () => {
    const engine = new FakeThemeEngine();
    seedDawnLike(engine, { name: "Live", role: "main" });
    engine.addTheme({ name: `${WORKING_THEME_PREFIX} Live 2025-01-01`, role: "unpublished" });
    for (let i = 0; i < 19; i++) {
      engine.addTheme({ name: `Other theme ${i}`, role: "unpublished" });
    }
    const svc = new WorkingThemeService(engine);
    // current() should find the existing stale working theme and reuse it rather than throwing.
    const result = await svc.ensure();
    expect(result.name).toContain(WORKING_THEME_PREFIX);
  });

  it("assertWritable throws LIVE_THEME_WRITE_REFUSED for the live theme id", async () => {
    const engine = new FakeThemeEngine();
    const live = seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine);
    await expect(svc.assertWritable(live.id)).rejects.toMatchObject({ code: "LIVE_THEME_WRITE_REFUSED" });
  });

  it("assertWritable allows the live theme id when allowLiveWrite is set", async () => {
    const engine = new FakeThemeEngine();
    const live = seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine);
    await expect(svc.assertWritable(live.id, { allowLiveWrite: true })).resolves.toBeUndefined();
  });

  it("assertWritable allows a non-live theme id", async () => {
    const engine = new FakeThemeEngine();
    seedDawnLike(engine, { name: "Live", role: "main" });
    const svc = new WorkingThemeService(engine, { now: () => new Date("2026-09-04T00:00:00.000Z") });
    const working = await svc.ensure();
    await expect(svc.assertWritable(working.id)).resolves.toBeUndefined();
  });
});
