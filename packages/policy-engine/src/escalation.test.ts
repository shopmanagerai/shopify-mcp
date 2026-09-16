import { describe, expect, it } from "vitest";
import { applyEscalation, pathPresent } from "./escalation.js";
import type { ToolDefinition } from "@shopmanagerai/shared";

function def(escalation: ToolDefinition["escalation"]): Pick<ToolDefinition, "riskClass" | "escalation"> {
  return { riskClass: "write", escalation };
}

describe("pathPresent", () => {
  it("finds a top-level field", () => {
    expect(pathPresent({ price: "10.00" }, "price")).toBe(true);
    expect(pathPresent({ title: "x" }, "price")).toBe(false);
  });

  it("finds a nested field", () => {
    expect(pathPresent({ variant: { price: "10.00" } }, "variant.price")).toBe(true);
    expect(pathPresent({ variant: {} }, "variant.price")).toBe(false);
  });

  it("checks arrays element-wise", () => {
    expect(pathPresent({ variants: [{ title: "a" }, { price: "9.99" }] }, "variants.price")).toBe(true);
    expect(pathPresent({ variants: [{ title: "a" }, { title: "b" }] }, "variants.price")).toBe(false);
  });

  it("treats null as absent", () => {
    expect(pathPresent({ price: null }, "price")).toBe(false);
  });
});

describe("applyEscalation", () => {
  it("returns the base risk when nothing matches", () => {
    const result = applyEscalation(def([{ whenInputHas: ["price"], toRisk: "commerce_sensitive", policyKey: "product.price.write" }]), {
      title: "New title",
    });
    expect(result.effectiveRisk).toBe("write");
    expect(result.policyKey).toBeUndefined();
    expect(result.matchedRules).toEqual([]);
  });

  it("escalates on a price field per ARCHITECTURE_REVIEW A3", () => {
    const result = applyEscalation(def([{ whenInputHas: ["price", "compareAtPrice"], toRisk: "commerce_sensitive", policyKey: "product.price.write" }]), {
      price: "19.99",
    });
    expect(result.effectiveRisk).toBe("commerce_sensitive");
    expect(result.policyKey).toBe("product.price.write");
    expect(result.matchedRules.length).toBe(1);
  });

  it("escalates on price fields nested in a bulk variants array", () => {
    const result = applyEscalation(
      def([{ whenInputHas: ["variants.price", "variants.inventoryQuantity"], toRisk: "commerce_sensitive", policyKey: "product.price.write" }]),
      { variants: [{ id: "1" }, { id: "2", price: "5.00" }] },
    );
    expect(result.effectiveRisk).toBe("commerce_sensitive");
  });

  it("picks the highest-risk match across multiple rules", () => {
    const result = applyEscalation(
      def([
        { whenInputHas: ["price"], toRisk: "commerce_sensitive", policyKey: "product.price.write" },
        { whenInputHas: ["publish"], toRisk: "publish", policyKey: "theme.publish" },
      ]),
      { price: "1.00", publish: true },
    );
    expect(result.effectiveRisk).toBe("publish");
    expect(result.policyKey).toBe("theme.publish");
    expect(result.matchedRules.length).toBe(2);
  });

  it("no-ops when the tool declares no escalation rules", () => {
    const result = applyEscalation({ riskClass: "read", escalation: undefined }, { anything: true });
    expect(result.effectiveRisk).toBe("read");
  });
});
