import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { ok, fail } from "./envelope.js";

function makeDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "shopify.product.update_basic",
    version: "1.0.0",
    description: "Update basic product fields.",
    tier: "free",
    category: "product",
    riskClass: "write",
    executionPlane: "shopify_admin",
    requiredEntitlements: [],
    requiredShopifyScopes: ["write_products"],
    requiredStoreCapabilities: ["admin.write"],
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ id: z.string() }),
    supportsDryRun: true,
    rollback: "ledger_before_image",
    supportsPagination: false,
    taskMode: "sync",
    idempotency: "none",
    timeoutMs: 30000,
    rateLimitCategory: "admin_write",
    audit: "always",
    approval: "none",
    dataCategories: { reads: [], writes: ["product"], stores: [], returnsToClient: [] },
    docs: { examples: [{ title: "x", input: {} }], failureModes: [], limitations: [] },
    handler: async () => ({ ok: true }) as any,
    ...overrides,
  };
}

describe("ok", () => {
  it("fills operationId/tool/risk and defaults arrays", () => {
    const def = makeDef();
    const result = ok({ operationId: "op_1" }, def, { data: { id: "1" }, summary: "Updated product 1." });
    expect(result.ok).toBe(true);
    expect(result.operationId).toBe("op_1");
    expect(result.tool).toBe(def.name);
    expect(result.risk).toBe(def.riskClass);
    expect(result.changes).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.nextActions).toEqual([]);
    expect(result.rollback).toEqual({ available: false, strategy: "ledger_before_image" });
  });

  it("respects explicit overrides", () => {
    const def = makeDef();
    const result = ok({ operationId: "op_1" }, def, {
      data: { id: "1" },
      summary: "x",
      warnings: ["careful"],
      rollback: { available: true, strategy: "snapshot", snapshotId: "snap_1" },
      jobId: "job_1",
    });
    expect(result.warnings).toEqual(["careful"]);
    expect(result.rollback).toEqual({ available: true, strategy: "snapshot", snapshotId: "snap_1" });
    expect(result.jobId).toBe("job_1");
  });
});

describe("fail", () => {
  it("converts a ShopManagerAIError", () => {
    const def = makeDef();
    const err = new ShopManagerAIError("NOT_FOUND", "Product not found.", { retryable: false });
    const result = fail({ operationId: "op_1" }, def, err);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_FOUND");
    expect(result.message).toBe("Product not found.");
    expect(result.tool).toBe(def.name);
    expect(result.risk).toBe(def.riskClass);
    expect(result.operationId).toBe("op_1");
  });

  it("converts a plain {code, message} error shape", () => {
    const def = makeDef();
    const result = fail({ operationId: "op_2" }, def, { code: "INVALID_INPUT", message: "Bad id." });
    expect(result.code).toBe("INVALID_INPUT");
    expect(result.message).toBe("Bad id.");
  });

  it("wraps an arbitrary thrown value as INTERNAL", () => {
    const def = makeDef();
    const result = fail({ operationId: "op_3" }, def, new Error("boom"));
    expect(result.code).toBe("INTERNAL");
    expect(result.technicalMessage).toBe("boom");
  });
});
