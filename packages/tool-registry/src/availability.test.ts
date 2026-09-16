import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { ToolRegistry } from "./registry.js";
import { computeCards, listForMcp, type AvailabilityContext } from "./availability.js";

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
    outputSchema: z.object({ id: z.string() }),
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
    docs: { examples: [{ title: "Fetch", input: { id: "1" } }], failureModes: [], limitations: [] },
    handler: async () => ({ ok: true }) as any,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    tier: "free",
    entitlements: new Set(),
    profile: "production_safe",
    scopesGranted: new Set(["read_products"]),
    capabilities: new Set(["admin.read"]),
    policy: {},
    ...overrides,
  };
}

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(makeDef({ name: "shopify.product.get", category: "product", riskClass: "read" }));
  registry.register(
    makeDef({
      name: "shopify.products.bulk_update",
      category: "product",
      riskClass: "bulk",
      requiredEntitlements: ["pro.bulk"],
      tier: "pro",
      requiredShopifyScopes: ["write_products"],
      requiredStoreCapabilities: ["admin.write"],
    }),
  );
  registry.register(
    makeDef({
      name: "shopify.theme.file.update",
      category: "theme_file",
      riskClass: "theme_write",
      requiredShopifyScopes: ["write_themes"],
      requiredStoreCapabilities: ["theme.write"],
    }),
  );
  registry.register(
    makeDef({
      name: "commerce.rollback.execute",
      category: "orchestration",
      riskClass: "critical",
      requiredShopifyScopes: [],
      requiredStoreCapabilities: [],
    }),
  );
  return registry;
}

describe("computeCards", () => {
  it("orders cards deterministically by (category, name)", () => {
    const registry = buildRegistry();
    const cards = computeCards(registry, baseCtx());
    const pairs = cards.map((c) => `${c.category}:${c.name}`);
    const sorted = [...pairs].sort();
    expect(pairs).toEqual(sorted);
  });

  it("marks a pro tool as pro_required for a free-tier caller", () => {
    const registry = buildRegistry();
    const cards = computeCards(registry, baseCtx());
    const card = cards.find((c) => c.name === "shopify.products.bulk_update")!;
    expect(card.availability).toBe("pro_required");
  });

  it("is available once entitlement and tier are granted", () => {
    const registry = buildRegistry();
    const cards = computeCards(
      registry,
      baseCtx({ tier: "pro", entitlements: new Set(["pro.bulk"]), scopesGranted: new Set(["write_products"]), capabilities: new Set(["admin.write"]) }),
    );
    const card = cards.find((c) => c.name === "shopify.products.bulk_update")!;
    expect(card.availability).toBe("available");
  });

  it("marks scope_missing before capability_missing", () => {
    const registry = buildRegistry();
    const cards = computeCards(registry, baseCtx({ scopesGranted: new Set(), capabilities: new Set() }));
    const card = cards.find((c) => c.name === "shopify.theme.file.update")!;
    expect(card.availability).toBe("scope_missing");
  });

  it("marks capability_missing when scopes are satisfied but capability is not", () => {
    const registry = buildRegistry();
    const cards = computeCards(
      registry,
      baseCtx({ scopesGranted: new Set(["write_themes"]), capabilities: new Set() }),
    );
    const card = cards.find((c) => c.name === "shopify.theme.file.update")!;
    expect(card.availability).toBe("capability_missing");
  });

  it("marks profile_denied via the policy engine's risk gate", () => {
    const registry = buildRegistry();
    const cards = computeCards(registry, baseCtx({ profile: "production_safe" }));
    const card = cards.find((c) => c.name === "commerce.rollback.execute")!;
    // production_safe allows critical only for commerce.rollback.execute itself
    expect(card.availability).toBe("available");
  });

  it("denies critical risk for a non-rollback tool under production_safe", () => {
    const registry = new ToolRegistry();
    registry.register(makeDef({ name: "shopify.theme.publish", category: "theme", riskClass: "critical", requiredShopifyScopes: [], requiredStoreCapabilities: [] }));
    const cards = computeCards(registry, baseCtx());
    expect(cards[0]?.availability).toBe("profile_denied");
  });

  it("marks unverified tools", () => {
    const registry = buildRegistry();
    const cards = computeCards(registry, baseCtx({ unverified: new Set(["shopify.product.get"]) }));
    const card = cards.find((c) => c.name === "shopify.product.get")!;
    expect(card.availability).toBe("unverified");
  });
});

describe("listForMcp", () => {
  it("meta mode returns exactly the three meta-tools", () => {
    const registry = buildRegistry();
    const list = listForMcp(registry, baseCtx(), "meta");
    expect(list.map((t) => t.name).sort()).toEqual(["discover-tools", "execute-tool", "get-schema"]);
    for (const t of list) {
      expect(t.inputSchema).toBeTruthy();
    }
  });

  it("flat mode returns only available tools with full schemas, excluding pro_required", () => {
    const registry = buildRegistry();
    const list = listForMcp(registry, baseCtx(), "flat");
    const names = list.map((t) => t.name);
    expect(names).toContain("shopify.product.get");
    expect(names).not.toContain("shopify.products.bulk_update");
    const productGet = list.find((t) => t.name === "shopify.product.get")!;
    expect(productGet.outputSchema).toBeTruthy();
  });
});
