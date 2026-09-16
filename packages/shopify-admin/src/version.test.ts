import { describe, expect, it } from "vitest";
import { ShopifyApiVersionService } from "./version.js";

describe("ShopifyApiVersionService", () => {
  it("defaults to 2026-07 when no env var is set", () => {
    const svc = new ShopifyApiVersionService({});
    expect(svc.current()).toBe("2026-07");
  });

  it("uses SHOPIFY_API_VERSION when valid", () => {
    const svc = new ShopifyApiVersionService({ SHOPIFY_API_VERSION: "2026-10" });
    expect(svc.current()).toBe("2026-10");
  });

  it("falls back to default for an invalid env value", () => {
    const svc = new ShopifyApiVersionService({ SHOPIFY_API_VERSION: "not-a-version" });
    expect(svc.current()).toBe("2026-07");
  });

  it.each(["2026-01", "2026-04", "2026-07", "2026-10"])("accepts valid quarterly version %s", (v) => {
    const svc = new ShopifyApiVersionService({});
    expect(svc.isValid(v)).toBe(true);
  });

  it.each(["2026-02", "26-01", "2026-13", "abc", ""])("rejects invalid version %s", (v) => {
    const svc = new ShopifyApiVersionService({});
    expect(svc.isValid(v)).toBe(false);
  });

  it("computes release date and end-of-support 12 months later", () => {
    const svc = new ShopifyApiVersionService({});
    const window = svc.supportedWindow("2026-07");
    expect(window.releaseDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(window.endOfSupport.toISOString()).toBe("2027-07-01T00:00:00.000Z");
  });

  it("warnIfExpiring returns null when well within the support window", () => {
    const svc = new ShopifyApiVersionService({ SHOPIFY_API_VERSION: "2026-07" });
    const warning = svc.warnIfExpiring(new Date("2026-08-01T00:00:00.000Z"), 90);
    expect(warning).toBeNull();
  });

  it("warnIfExpiring returns a message inside the warning window", () => {
    const svc = new ShopifyApiVersionService({ SHOPIFY_API_VERSION: "2026-07" });
    // end of support is 2027-07-01; 30 days before that is 2027-06-01
    const warning = svc.warnIfExpiring(new Date("2027-06-15T00:00:00.000Z"), 90);
    expect(warning).toContain("2026-07");
    expect(warning).toContain("2027-07-01");
  });

  it("warnIfExpiring returns a message once support has already ended", () => {
    const svc = new ShopifyApiVersionService({ SHOPIFY_API_VERSION: "2026-07" });
    const warning = svc.warnIfExpiring(new Date("2027-08-01T00:00:00.000Z"), 90);
    expect(warning).not.toBeNull();
  });

  it("throws on an invalid version passed to supportedWindow", () => {
    const svc = new ShopifyApiVersionService({});
    expect(() => svc.supportedWindow("garbage")).toThrow();
  });
});
