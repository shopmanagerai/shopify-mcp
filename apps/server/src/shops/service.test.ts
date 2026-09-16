import { describe, expect, it } from "vitest";
import { grantedScopesFor } from "./service.js";

function fakeContainer(stored: string[] | null, configScopes: string[] = []) {
  return {
    kv: { get: async <T>() => stored as unknown as T },
    config: { shopify: { scopes: configScopes } },
  };
}

describe("grantedScopesFor", () => {
  it("adds the implied read_x for every granted write_x (Shopify collapses read+write requests into write-only)", async () => {
    const scopes = await grantedScopesFor(fakeContainer(["write_products", "write_content", "read_locations"]), "shop.myshopify.com");
    expect(scopes).toEqual(expect.arrayContaining(["write_products", "read_products", "write_content", "read_content", "read_locations"]));
    expect(scopes).not.toContain("write_locations");
  });

  it("does not duplicate a read_x that was already explicitly granted", async () => {
    const scopes = await grantedScopesFor(fakeContainer(["write_products", "read_products"]), "shop.myshopify.com");
    expect(scopes.filter((s) => s === "read_products")).toHaveLength(1);
  });

  it("falls back to the configured scope list when nothing is stored, still expanding it", async () => {
    const scopes = await grantedScopesFor(fakeContainer(null, ["write_themes"]), "shop.myshopify.com");
    expect(scopes).toEqual(expect.arrayContaining(["write_themes", "read_themes"]));
  });

  it("leaves a plain read-only scope with no write counterpart untouched", async () => {
    const scopes = await grantedScopesFor(fakeContainer(["read_script_tags"]), "shop.myshopify.com");
    expect(scopes).toEqual(["read_script_tags"]);
  });
});
