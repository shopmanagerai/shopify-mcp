import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { ToolRegistry, ToolRegistryError, TOOL_NAME_PATTERN } from "./registry.js";

function makeDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "shopify.product.get",
    version: "1.0.0",
    description: "Get a product by id.",
    tier: "free",
    category: "product",
    riskClass: "read",
    executionPlane: "shopify_admin",
    requiredEntitlements: [],
    requiredShopifyScopes: ["read_products"],
    requiredStoreCapabilities: ["admin.read"],
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ id: z.string(), title: z.string() }),
    supportsDryRun: false,
    rollback: "none",
    supportsPagination: false,
    taskMode: "sync",
    idempotency: "natural",
    timeoutMs: 30000,
    rateLimitCategory: "admin_read",
    audit: "mutations_only",
    approval: "none",
    dataCategories: { reads: ["product"], writes: [], stores: [], returnsToClient: ["product"] },
    docs: {
      examples: [{ title: "Fetch a product", input: { id: "gid://shopify/Product/1" } }],
      failureModes: [{ code: "NOT_FOUND", meaning: "Product does not exist." }],
      limitations: [],
    },
    handler: async () => {
      throw new Error("not implemented in tests");
    },
    ...overrides,
  };
}

describe("TOOL_NAME_PATTERN", () => {
  it("accepts shopify.* and commerce.* dotted names", () => {
    expect(TOOL_NAME_PATTERN.test("shopify.product.get")).toBe(true);
    expect(TOOL_NAME_PATTERN.test("commerce.rollback.execute")).toBe(true);
    expect(TOOL_NAME_PATTERN.test("shopify.page_type.inspect")).toBe(true);
  });

  it("rejects bad names", () => {
    expect(TOOL_NAME_PATTERN.test("Shopify.product.get")).toBe(false);
    expect(TOOL_NAME_PATTERN.test("acme.product.get")).toBe(false);
    expect(TOOL_NAME_PATTERN.test("shopify.Product.Get")).toBe(false);
    expect(TOOL_NAME_PATTERN.test("shopify")).toBe(false);
  });
});

describe("ToolRegistry.register: validation", () => {
  it("registers a valid definition", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef());
    expect(registry.size).toBe(1);
    expect(registry.get("shopify.product.get")?.name).toBe("shopify.product.get");
  });

  it("rejects an invalid name pattern", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(makeDef({ name: "bad-name" }))).toThrow(ToolRegistryError);
  });

  it("rejects duplicate names", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef());
    expect(() => registry.register(makeDef())).toThrow(/Duplicate tool name/);
  });

  it("rejects alias collisions with an existing tool name", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef());
    expect(() =>
      registry.register(makeDef({ name: "shopify.product.fetch", aliases: ["shopify.product.get"] })),
    ).toThrow(/Alias collision/);
  });

  it("rejects alias collisions with an existing alias", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef({ aliases: ["shopify.product.fetch"] }));
    expect(() =>
      registry.register(makeDef({ name: "shopify.product.read", aliases: ["shopify.product.fetch"] })),
    ).toThrow(/Alias collision/);
  });

  it("validates every enum field", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(makeDef({ tier: "enterprise" as any }))).toThrow(/tier/);
    expect(() => registry.register(makeDef({ category: "bogus" as any }))).toThrow(/category/);
    expect(() => registry.register(makeDef({ riskClass: "bogus" as any }))).toThrow(/riskClass/);
    expect(() => registry.register(makeDef({ executionPlane: "bogus" as any }))).toThrow(/executionPlane/);
    expect(() => registry.register(makeDef({ rollback: "bogus" as any }))).toThrow(/rollback/);
    expect(() => registry.register(makeDef({ idempotency: "bogus" as any }))).toThrow(/idempotency/);
    expect(() => registry.register(makeDef({ taskMode: "bogus" as any }))).toThrow(/taskMode/);
    expect(() => registry.register(makeDef({ rateLimitCategory: "bogus" as any }))).toThrow(/rateLimitCategory/);
    expect(() => registry.register(makeDef({ audit: "bogus" as any }))).toThrow(/audit/);
    expect(() => registry.register(makeDef({ approval: "bogus" as any }))).toThrow(/approval/);
    expect(() => registry.register(makeDef({ requiredEntitlements: ["bogus" as any] }))).toThrow(/requiredEntitlements/);
    expect(() => registry.register(makeDef({ requiredStoreCapabilities: ["bogus" as any] }))).toThrow(/requiredStoreCapabilities/);
  });

  it("requires at least one example", () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(makeDef({ docs: { examples: [], failureModes: [], limitations: [] } })),
    ).toThrow(/docs.examples/);
  });

  it("requires dataCategories", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(makeDef({ dataCategories: undefined as any }))).toThrow(/dataCategories/);
  });

  it("validates escalation rules", () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register(makeDef({ escalation: [{ whenInputHas: [], toRisk: "write" }] })),
    ).toThrow(/escalation/);
    expect(() =>
      registry.register(makeDef({ escalation: [{ whenInputHas: ["price"], toRisk: "bogus" as any }] })),
    ).toThrow(/toRisk/);
  });
});

describe("ToolRegistry: alias resolution", () => {
  it("get() resolves an alias to the canonical definition", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef({ aliases: ["shopify.seo.update_product_metadata"] }));
    const viaAlias = registry.get("shopify.seo.update_product_metadata");
    expect(viaAlias?.name).toBe("shopify.product.get");
    expect(registry.resolveAlias("shopify.seo.update_product_metadata")).toBe("shopify.product.get");
  });

  it("get() returns undefined for unknown names", () => {
    const registry = new ToolRegistry();
    expect(registry.get("shopify.nope.nope")).toBeUndefined();
  });
});

describe("ToolRegistry.registerFamily", () => {
  it("expands family.values into derived tool names", () => {
    const registry = new ToolRegistry();
    const calls: unknown[] = [];
    registry.registerFamily(
      makeDef({
        name: "shopify.page_type.inspect",
        family: { param: "target", values: ["home", "pdp", "plp"] },
        familyNameTemplate: "shopify.{target}.inspect",
        handler: async (_ctx, input) => {
          calls.push(input);
          return { ok: true } as any;
        },
      }),
    );

    expect(registry.size).toBe(3);
    expect(registry.get("shopify.home.inspect")).toBeDefined();
    expect(registry.get("shopify.pdp.inspect")).toBeDefined();
    expect(registry.get("shopify.plp.inspect")).toBeDefined();
    expect(registry.get("shopify.page_type.inspect")).toBeUndefined();
  });

  it("derived handlers inject the family param", async () => {
    const registry = new ToolRegistry();
    const calls: unknown[] = [];
    registry.registerFamily(
      makeDef({
        name: "shopify.page_type.inspect",
        family: { param: "target", values: ["home", "pdp"] },
        familyNameTemplate: "shopify.{target}.inspect",
        handler: async (_ctx, input) => {
          calls.push(input);
          return { ok: true } as any;
        },
      }),
    );

    const homeTool = registry.get("shopify.home.inspect")!;
    await homeTool.handler({} as any, { extra: 1 });
    expect(calls[0]).toEqual({ extra: 1, target: "home" });
  });

  it("throws without a familyNameTemplate", () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.registerFamily(makeDef({ family: { param: "target", values: ["home"] } })),
    ).toThrow(/familyNameTemplate/);
  });

  it("throws when def.family is missing", () => {
    const registry = new ToolRegistry();
    expect(() => registry.registerFamily(makeDef({ familyNameTemplate: "shopify.{target}.inspect" }))).toThrow(
      /no "family"/,
    );
  });
});

describe("ToolRegistry.list / byCategory / size", () => {
  it("lists everything and filters by category", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef({ name: "shopify.product.get", category: "product" }));
    registry.register(makeDef({ name: "shopify.collection.get", category: "collection" }));
    expect(registry.list().length).toBe(2);
    expect(registry.byCategory("product").map((d) => d.name)).toEqual(["shopify.product.get"]);
    expect(registry.size).toBe(2);
  });
});
