import { describe, expect, it } from "vitest";
import { planHash } from "./planHash.js";

describe("planHash", () => {
  it("is deterministic regardless of key order", () => {
    const a = planHash("shopify.product.update", "shop_1", { title: "x", price: "9.99" });
    const b = planHash("shopify.product.update", "shop_1", { price: "9.99", title: "x" });
    expect(a).toBe(b);
  });

  it("changes when the input changes", () => {
    const a = planHash("shopify.product.update", "shop_1", { price: "9.99" });
    const b = planHash("shopify.product.update", "shop_1", { price: "8.99" });
    expect(a).not.toBe(b);
  });

  it("changes when the tool or shop changes", () => {
    const base = planHash("shopify.product.update", "shop_1", { price: "9.99" });
    expect(planHash("shopify.product.delete", "shop_1", { price: "9.99" })).not.toBe(base);
    expect(planHash("shopify.product.update", "shop_2", { price: "9.99" })).not.toBe(base);
  });

  it("is a 64-char hex sha256 digest", () => {
    expect(planHash("t", "s", {})).toMatch(/^[a-f0-9]{64}$/);
  });
});
