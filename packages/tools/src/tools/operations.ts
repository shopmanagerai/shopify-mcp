import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Operation ledger tools (category "orchestration"): commerce.operation.*
 * wrap ctx.ledger (and ctx.jobs for cancel); commerce.operation.approve mints
 * an approval token via ctx.approvals, gated to the "admin" profile per
 * policy-engine's canApprove.
 */
import { z } from "zod";
import { planHash as computePlanHash } from "@shopmanagerai/policy-engine";
import { canApprove } from "@shopmanagerai/policy-engine";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";

export const operationGetTool: ToolDefinition = defineTool({
  name: "commerce.operation.get",
  description: "Fetches one operation record from the ledger by id.",
  tier: "free",
  category: "orchestration",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ operationId: z.string() }),
  outputSchema: z.object({ operation: z.unknown() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["operation ledger"], writes: [], stores: [], returnsToClient: ["operation record"] },
  docs: { examples: [{ title: "Get an operation", input: { operationId: "op_123" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No operation with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const operation = await ctx.ledger.get(input.operationId);
    if (!operation) return fail({ operationId: ctx.operationId }, operationGetTool, { code: "NOT_FOUND", message: `Operation "${input.operationId}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, operationGetTool, { summary: `Operation ${operation.operationId}: ${operation.status}`, data: { operation } });
  },
});

export const operationListTool: ToolDefinition = defineTool({
  name: "commerce.operation.list",
  description: "Lists operations for this shop, optionally filtered by tool or status.",
  tier: "free",
  category: "orchestration",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ tool: z.string().optional(), status: z.enum(["pending", "succeeded", "failed", "rolled_back"]).optional(), limit: z.number().optional(), cursor: z.string().optional() }),
  outputSchema: z.object({ items: z.array(z.unknown()), nextCursor: z.string().optional() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  supportsPagination: true,
  dataCategories: { reads: ["operation ledger"], writes: [], stores: [], returnsToClient: ["operation list"] },
  docs: { examples: [{ title: "List recent operations", input: {} }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const result = await ctx.ledger.list(ctx.shop.shopId, input);
    return ok({ operationId: ctx.operationId }, operationListTool, { summary: `${result.items.length} operation(s)`, data: result });
  },
});

export const operationsListTool: ToolDefinition = defineTool({
  ...operationListTool,
  name: "commerce.operations.list",
  description: "Alias-style bulk listing of operations for this shop (same as commerce.operation.list).",
  handler: async (ctx, input) => {
    const result = await ctx.ledger.list(ctx.shop.shopId, input);
    return ok({ operationId: ctx.operationId }, operationsListTool, { summary: `${result.items.length} operation(s)`, data: result });
  },
});

export const operationCancelTool: ToolDefinition = defineTool({
  name: "commerce.operation.cancel",
  description: "Cancels a running task-mode operation (job), if the job engine is configured.",
  tier: "free",
  category: "orchestration",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ jobId: z.string() }),
  outputSchema: z.object({ job: z.unknown() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["job state"], writes: ["job state"], stores: [], returnsToClient: ["job record"] },
  docs: {
    examples: [{ title: "Cancel a job", input: { jobId: "job_123" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "No job with that id." }, { code: "CAPABILITY_MISSING", meaning: "No job engine configured." }],
    limitations: ["0.1 has no long-running task-mode tools, so this mostly applies to future/Pro tools."],
  },
  handler: async (ctx, input) => {
    if (!ctx.jobs) return fail({ operationId: ctx.operationId }, operationCancelTool, { code: "CAPABILITY_MISSING", message: "No job engine is configured.", retryable: false });
    const job = await ctx.jobs.cancel(input.jobId);
    if (!job) return fail({ operationId: ctx.operationId }, operationCancelTool, { code: "NOT_FOUND", message: `Job "${input.jobId}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, operationCancelTool, { summary: `Job ${job.jobId}: ${job.status}`, data: { job } });
  },
});

export const operationApproveTool: ToolDefinition = defineTool({
  name: "commerce.operation.approve",
  description: "Mints an approval token for a specific tool + input plan hash, so a subsequent call can carry out a publish/critical-risk operation. Only the admin profile may call this.",
  tier: "free",
  category: "orchestration",
  riskClass: "commerce_sensitive",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ tool: z.string(), planHash: z.string().optional(), input: z.record(z.unknown()).optional() }),
  outputSchema: z.object({ token: z.string(), expiresAt: z.string() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: ["approval token"], returnsToClient: ["approval token"] },
  docs: {
    examples: [{ title: "Approve a publish", input: { tool: "shopify.theme.publish", input: { themeId: "123", confirm: true } } }],
    failureModes: [{ code: "PROFILE_DENIED", meaning: "Only the admin profile may mint approval tokens." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    if (!canApprove(ctx.credential.profile)) {
      return fail({ operationId: ctx.operationId }, operationApproveTool, {
        code: "PROFILE_DENIED",
        message: `Only the admin profile may call commerce.operation.approve (current: "${ctx.credential.profile}").`,
        retryable: false,
      });
    }
    // Must match the hash the MCP pipeline computes before evaluate(): planHash(tool, shopId, input).
    const planHash = input.planHash ?? computePlanHash(input.tool, ctx.shop.shopId, input.input ?? {});
    const result = await ctx.approvals.issue({
      shopId: ctx.shop.shopId,
      credentialId: ctx.credential.credentialId,
      tool: input.tool,
      planHash,
      issuedBy: ctx.credential.credentialId,
    });
    return ok({ operationId: ctx.operationId }, operationApproveTool, { summary: `Approval token issued for ${input.tool}`, data: result });
  },
});

export function registerOperationsTools(registry: ToolRegistry): void {
  registry.register(operationGetTool);
  registry.register(operationListTool);
  registry.register(operationsListTool);
  registry.register(operationCancelTool);
  registry.register(operationApproveTool);
}
