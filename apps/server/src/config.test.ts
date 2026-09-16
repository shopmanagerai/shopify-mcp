import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/**
 * The env vars were renamed from SHOPMANAGERAI_* to SHOPMANAGER_* during the
 * brand rename. The old names are still read so an existing .env keeps
 * working; these tests are what make that a guarantee rather than a claim.
 */
describe("config env var rename", () => {
  const base = { DATA_DIR: "./data", APP_URL: "http://localhost:3000" };

  it("reads the current demo flag", () => {
    expect(loadConfig({ ...base, SHOPMANAGER_DEMO: "1" }).demo).toBe(true);
  });

  it("still reads the pre-rename demo flag", () => {
    expect(loadConfig({ ...base, SHOPMANAGERAI_DEMO: "1" }).demo).toBe(true);
  });

  it("prefers the current name when both are set", () => {
    const cfg = loadConfig({
      ...base,
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "secret",
      SHOPMANAGER_MASTER_KEY: "current",
      SHOPMANAGERAI_MASTER_KEY: "legacy",
    });
    expect(cfg.masterKey).toBe("current");
  });

  it("falls back to the pre-rename master key", () => {
    const cfg = loadConfig({
      ...base,
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "secret",
      SHOPMANAGERAI_MASTER_KEY: "legacy",
    });
    expect(cfg.masterKey).toBe("legacy");
  });

  it("demo mode is on when no Shopify client id is configured", () => {
    expect(loadConfig({ ...base }).demo).toBe(true);
  });
});
