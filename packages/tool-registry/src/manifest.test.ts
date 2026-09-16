import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { ToolRegistry } from "./registry.js";
import { generateManifest, generateToolsMarkdown } from "./manifest.js";

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
    docs: {
      examples: [{ title: "Fetch a product", input: { id: "1" } }],
      failureModes: [{ code: "NOT_FOUND", meaning: "Product does not exist." }],
      limitations: ["Read-only."],
    },
    handler: async () => ({ ok: true }) as any,
    ...overrides,
  };
}

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(makeDef());
  registry.register(makeDef({ name: "shopify.collection.get", category: "collection" }));
  return registry;
}

describe("generateManifest", () => {
  it("has the expected structure", () => {
    const manifest = generateManifest(buildRegistry());
    expect(typeof manifest.generatedAt).toBe("string");
    expect(manifest.generatedAt).toBe("deterministic"); // no timestamp so CI can diff the committed file
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.tools.map((t) => t.name)).toEqual(["shopify.collection.get", "shopify.product.get"]);

    const entry = manifest.tools.find((t) => t.name === "shopify.product.get")!;
    expect(entry).toMatchObject({
      version: "1.0.0",
      tier: "free",
      category: "product",
      riskClass: "read",
      executionPlane: "shopify_admin",
      rollback: "none",
      approval: "none",
    });
    expect(entry.inputSchema).toBeTruthy();
    expect(entry.outputSchema).toBeTruthy();
    expect(entry.docs.examples).toHaveLength(1);
  });
});

describe("generateToolsMarkdown", () => {
  it("includes one section per tool with the required fields", () => {
    const md = generateToolsMarkdown(buildRegistry());
    expect(md).toContain("# Tool Manifest");
    expect(md).toContain("## collection");
    expect(md).toContain("## product");
    expect(md).toContain("### `shopify.product.get`");
    expect(md).toContain("**Tier:** free");
    expect(md).toContain("**Risk:** read");
    expect(md).toContain("**Plane:** shopify_admin");
    expect(md).toContain("**Scopes:** read_products");
    expect(md).toContain("**Rollback:** none");
    expect(md).toContain("**Approval:** none");
    expect(md).toContain("**Input schema**");
    expect(md).toContain("**Examples**");
    expect(md).toContain("**Failure modes**");
    expect(md).toContain("NOT_FOUND");
    expect(md).toContain("**Limitations**");
  });

  it("is stable in shape across two generations (ignoring the timestamp line)", () => {
    const registry = buildRegistry();
    const stripTimestamp = (s: string) => s.replace(/Generated .*\./, "Generated <ts>.");
    const a = stripTimestamp(generateToolsMarkdown(registry));
    const b = stripTimestamp(generateToolsMarkdown(registry));
    expect(a).toBe(b);
  });
});
