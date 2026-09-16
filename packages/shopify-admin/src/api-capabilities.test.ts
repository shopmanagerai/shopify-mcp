import { describe, expect, it } from "vitest";
import { ShopifyApiVersionManager, API_CAPABILITIES } from "./api-capabilities.js";

describe("ShopifyApiVersionManager", () => {
  const mgr = new ShopifyApiVersionManager({ SHOPIFY_API_VERSION: "2026-07" });

  it("knows the capabilities we depend on, each with scopes and a verification level", () => {
    expect(API_CAPABILITIES.length).toBeGreaterThan(20);
    for (const c of API_CAPABILITIES) {
      expect(c.minVersion, c.name).toMatch(/^\d{4}-(01|04|07|10)$/);
      expect(["live", "docs"]).toContain(c.verified);
    }
    expect(mgr.capability("themeFilesUpsert")!.requiredScopes).toEqual(["write_themes"]);
  });

  it("explains missing scopes, plan gates, protected data and old versions", () => {
    const scopes = mgr.check("marketCreate", { scopesGranted: ["read_markets"] });
    expect(scopes.available).toBe(false);
    expect(scopes.missingScopes).toEqual(["write_markets"]);
    const plus = mgr.check("checkoutBranding", { plan: "Basic", scopesGranted: ["write_checkout_branding_settings"] });
    expect(plus.available).toBe(false);
    expect(plus.reasons.join(" ")).toMatch(/Shopify Plus/);
    expect(mgr.check("checkoutBranding", { plan: "Shopify Plus", scopesGranted: ["write_checkout_branding_settings"] }).available).toBe(true);
    const pcd = mgr.check("orders", { scopesGranted: ["read_orders"], distribution: "public", protectedCustomerDataApproved: false });
    expect(pcd.reasons.join(" ")).toMatch(/protected customer data/);
    const old = new ShopifyApiVersionManager({ SHOPIFY_API_VERSION: "2024-07" }).check("productSet", { scopesGranted: ["write_products"] });
    expect(old.available).toBe(false);
    expect(old.reasons[0]).toMatch(/2024-10/);
    expect(mgr.check("themeFilesUpsert", { scopesGranted: ["write_themes"], distribution: "public" }).reasons.join(" ")).toMatch(/exemption/);
    expect(mgr.check("themeFilesUpsert", { scopesGranted: ["write_themes"], distribution: "custom" }).available).toBe(true);
    expect(mgr.check("nope").available).toBe(false);
  });
});
