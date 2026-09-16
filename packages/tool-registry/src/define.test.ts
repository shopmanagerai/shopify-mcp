import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define.js";

const baseFields = {
  name: "shopify.product.get",
  description: "Get a product.",
  tier: "free" as const,
  category: "product" as const,
  requiredEntitlements: [],
  requiredShopifyScopes: ["read_products"],
  requiredStoreCapabilities: ["admin.read" as const],
  supportsDryRun: false,
  rollback: "none" as const,
  taskMode: "sync" as const,
  approval: "none" as const,
  dataCategories: { reads: ["product"], writes: [], stores: [], returnsToClient: ["product"] },
  docs: { examples: [{ title: "x", input: {} }], failureModes: [], limitations: [] },
};

describe("defineTool", () => {
  it("fills defaults for a read tool", () => {
    const def = defineTool({
      ...baseFields,
      riskClass: "read",
      executionPlane: "shopify_admin",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ id: z.string() }),
      handler: async () => ({ ok: true }) as any,
    });

    expect(def.version).toBe("1.0.0");
    expect(def.timeoutMs).toBe(120000);
    expect(def.audit).toBe("mutations_only");
    expect(def.rateLimitCategory).toBe("admin_read");
    expect(def.supportsPagination).toBe(false);
    expect(def.idempotency).toBe("natural");
  });

  it("fills defaults for a mutating tool", () => {
    const def = defineTool({
      ...baseFields,
      name: "shopify.product.update_basic",
      riskClass: "write",
      executionPlane: "shopify_admin",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ id: z.string() }),
      handler: async () => ({ ok: true }) as any,
    });

    expect(def.audit).toBe("always");
    expect(def.rateLimitCategory).toBe("admin_write");
    expect(def.idempotency).toBe("none");
  });

  it("maps execution planes to rate-limit categories", () => {
    const themeDef = defineTool({
      ...baseFields,
      name: "shopify.theme.file.update",
      riskClass: "theme_write",
      executionPlane: "theme_engine",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({ ok: true }) as any,
    });
    expect(themeDef.rateLimitCategory).toBe("theme");

    const browserDef = defineTool({
      ...baseFields,
      name: "shopify.visual.capture",
      riskClass: "read",
      executionPlane: "browser",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({ ok: true }) as any,
    });
    expect(browserDef.rateLimitCategory).toBe("browser");
  });

  it("respects explicit overrides", () => {
    const def = defineTool({
      ...baseFields,
      riskClass: "read",
      executionPlane: "shopify_admin",
      version: "2.0.0",
      timeoutMs: 5000,
      supportsPagination: true,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({ ok: true }) as any,
    });
    expect(def.version).toBe("2.0.0");
    expect(def.timeoutMs).toBe(5000);
    expect(def.supportsPagination).toBe(true);
  });
});
