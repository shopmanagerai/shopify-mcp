/**
 * change.* façade (spec "CHANGESET ENGINE"): one uniform way for an agent to
 * plan → preview → validate → apply → inspect → roll back any mutation, on top of
 * the machinery every tool already has (dryRun, policy evaluation, ledger,
 * snapshots, approvals, rollback strategies). Nothing here bypasses the pipeline:
 * every call goes through the same executor the MCP endpoint uses, so scopes,
 * tiers, approvals and the ledger apply exactly as for a direct call.
 */
import { z } from "zod";
import type { RiskLevel, ToolDefinition, ToolResult } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";

/**
 * Looked up as `ctx.services.get("executor")`; provided by the server.
 *
 * In this build the facade can only reach the Free tools that are registered,
 * none of which write to a Shopify store. Asking it for a tool that is not
 * registered returns TOOL_NOT_FOUND rather than executing anything.
 */
export interface ToolExecutorService {
  /** Full pipeline: schema → policy → ledger → handler. Same as an MCP execute-tool call. */
  execute(name: string, input: unknown): Promise<ToolResult>;
  /** Schema + policy only; never runs the handler. */
  validate(name: string, input: unknown): Promise<{ ok: true; tool: string; effectiveRisk: string; riskLevel: RiskLevel; approval?: string; planHash: string } | { ok: false; tool: string; code: string; message: string; details?: Record<string, unknown> }>;
  /** Registry lookup for descriptions/flags. */
  describe(name: string): { name: string; riskClass: string; riskLevel: RiskLevel; supportsDryRun: boolean; rollback: string; approval: string; tier: string } | null;
}
export const EXECUTOR_SERVICE_KEY = "executor";

function requireExecutor(ctx: { services: Map<string, unknown> }): ToolExecutorService | null {
  return (ctx.services.get(EXECUTOR_SERVICE_KEY) as ToolExecutorService | undefined) ?? null;
}

const TargetInput = z.object({ tool: z.string(), input: z.record(z.unknown()).optional() });
const common = {
  tier: "free" as const,
  category: "orchestration" as const,
  executionPlane: "server" as const,
  requiredEntitlements: [] as never[],
  requiredShopifyScopes: [] as string[],
  requiredStoreCapabilities: [] as never[],
  supportsDryRun: false,
  rollback: "none" as const,
  taskMode: "sync" as const,
  approval: "none" as const,
};

function noExecutor(ctx: { operationId: string }, def: ToolDefinition) {
  return fail({ operationId: ctx.operationId }, def, { code: "CAPABILITY_MISSING", message: "No tool executor is configured on this server.", retryable: false });
}

export const changePlanTool: ToolDefinition = defineTool({
  name: "commerce.change.plan",
  description: "Plans a mutation without applying it: runs the target tool in dryRun mode through the full policy pipeline and returns the would-be changes, diffs, risk level, whether confirmation/approval will be needed, and the rollback strategy. Use before change.apply for anything that writes.",
  ...common,
  riskClass: "read",
  inputSchema: TargetInput,
  outputSchema: z.object({ tool: z.string(), riskClass: z.string(), riskLevel: z.string(), needsApproval: z.string(), rollback: z.string(), changes: z.array(z.unknown()), warnings: z.array(z.string()), summary: z.string(), dryRunSupported: z.boolean() }),
  dataCategories: { reads: ["target tool dry run"], writes: [], stores: [], returnsToClient: ["plan"] },
  docs: {
    examples: [{ title: "Plan a memory save", input: { tool: "commerce.memory.save", input: { key: "theme-notes", value: "Dawn-based theme" } } }],
    failureModes: [{ code: "TOOL_NOT_FOUND", meaning: "Unknown target tool." }, { code: "NOT_SUPPORTED", meaning: "The target tool has no dry-run mode; use change.validate instead." }],
    limitations: ["Dry runs of orchestration tools plan sub-steps but do not screenshot."],
  },
  handler: async (ctx, input) => {
    const exec = requireExecutor(ctx);
    if (!exec) return noExecutor(ctx, changePlanTool);
    const info = exec.describe(input.tool);
    if (!info) return fail({ operationId: ctx.operationId }, changePlanTool, { code: "TOOL_NOT_FOUND", message: `Unknown tool "${input.tool}".`, retryable: false });
    if (info.riskClass === "read") {
      return ok({ operationId: ctx.operationId }, changePlanTool, { summary: `${info.name} is read-only; nothing to plan.`, data: { tool: info.name, riskClass: info.riskClass, riskLevel: info.riskLevel, needsApproval: "none", rollback: "none", changes: [], warnings: [], summary: "read-only", dryRunSupported: false } });
    }
    if (!info.supportsDryRun) {
      return fail({ operationId: ctx.operationId }, changePlanTool, { code: "NOT_SUPPORTED", message: `${info.name} has no dry-run mode. Use change.validate to check permissions, then change.apply.`, retryable: false });
    }
    const result = await exec.execute(info.name, { ...(input.input ?? {}), dryRun: true });
    if (!result.ok) return fail({ operationId: ctx.operationId }, changePlanTool, { code: result.code as never, message: result.message, retryable: result.retryable, details: result.details });
    return ok({ operationId: ctx.operationId }, changePlanTool, {
      summary: `Plan: ${result.summary}`,
      data: { tool: info.name, riskClass: info.riskClass, riskLevel: info.riskLevel, needsApproval: info.approval, rollback: info.rollback, changes: result.changes, warnings: result.warnings, summary: result.summary, dryRunSupported: true },
      changes: result.changes,
      evidence: result.evidence,
      warnings: result.warnings,
      nextActions: [{ tool: "commerce.change.apply", reason: "Apply this plan (same tool and input, without dryRun).", input: { tool: info.name, input: input.input ?? {} } }],
    });
  },
});

export const changeValidateTool: ToolDefinition = defineTool({
  name: "commerce.change.validate",
  description: "Validates a mutation without running it: schema check plus the full policy evaluation (tier, scopes, protected data, plan, capabilities, profile, approval). Returns exactly why it would be refused, or the effective risk and approval requirement if it would run.",
  ...common,
  riskClass: "read",
  inputSchema: TargetInput,
  outputSchema: z.object({ tool: z.string(), valid: z.boolean(), effectiveRisk: z.string().optional(), riskLevel: z.string().optional(), approval: z.string().optional(), code: z.string().optional(), message: z.string().optional(), planHash: z.string().optional() }),
  dataCategories: { reads: ["policy"], writes: [], stores: [], returnsToClient: ["validation"] },
  docs: { examples: [{ title: "Check whether a snapshot would be allowed", input: { tool: "commerce.snapshot.create", input: {} } }], failureModes: [], limitations: ["Does not call Shopify, so resource existence is not checked."] },
  handler: async (ctx, input) => {
    const exec = requireExecutor(ctx);
    if (!exec) return noExecutor(ctx, changeValidateTool);
    const v = await exec.validate(input.tool, input.input ?? {});
    if (v.ok) return ok({ operationId: ctx.operationId }, changeValidateTool, { summary: `${v.tool} would run (${v.riskLevel}${v.approval && v.approval !== "none" ? `, ${v.approval} required` : ""})`, data: { tool: v.tool, valid: true, effectiveRisk: v.effectiveRisk, riskLevel: v.riskLevel, approval: v.approval, planHash: v.planHash } });
    return ok({ operationId: ctx.operationId }, changeValidateTool, { summary: `${v.tool} would be refused: ${v.code}`, data: { tool: v.tool, valid: false, code: v.code, message: v.message }, warnings: [v.message] });
  },
});

export const changeApplyTool: ToolDefinition = defineTool({
  name: "commerce.change.apply",
  description: "Applies a mutation through the full pipeline (identical to calling the tool directly) and returns the ledger operation id, changes, evidence and rollback info. Pass approvalToken when change.validate said one is required.",
  ...common,
  riskClass: "write",
  inputSchema: TargetInput.extend({ approvalToken: z.string().optional() }),
  outputSchema: z.object({ tool: z.string(), operationId: z.string().optional(), summary: z.string(), rollback: z.unknown() }),
  dataCategories: { reads: [], writes: ["whatever the target tool writes"], stores: [], returnsToClient: ["result"] },
  docs: { examples: [{ title: "Apply a planned memory save", input: { tool: "commerce.memory.save", input: { key: "theme-notes", value: "Dawn-based theme" } } }], failureModes: [{ code: "APPROVAL_REQUIRED", meaning: "Get a token from commerce.operation.approve (admin profile) and retry." }], limitations: [] },
  handler: async (ctx, input) => {
    const exec = requireExecutor(ctx);
    if (!exec) return noExecutor(ctx, changeApplyTool);
    const result = await exec.execute(input.tool, { ...(input.input ?? {}), ...(input.approvalToken ? { approvalToken: input.approvalToken } : {}) });
    if (!result.ok) return fail({ operationId: ctx.operationId }, changeApplyTool, { code: result.code as never, message: result.message, retryable: result.retryable, details: result.details });
    return ok({ operationId: ctx.operationId }, changeApplyTool, {
      summary: result.summary,
      data: { tool: result.tool, operationId: result.operationId, summary: result.summary, rollback: result.rollback },
      changes: result.changes,
      evidence: result.evidence,
      warnings: result.warnings,
      rollback: result.rollback,
      nextActions: result.rollback?.available ? [{ tool: "commerce.change.rollback", reason: "Undo this change.", input: { operationId: result.operationId, confirm: true } }] : [],
    });
  },
});

export const changeDiffTool: ToolDefinition = defineTool({
  name: "commerce.change.diff",
  description: "Returns the recorded before/after diffs for a ledger operation (every change with its resource, kind, unified diff and fingerprints).",
  ...common,
  riskClass: "read",
  inputSchema: z.object({ operationId: z.string() }),
  outputSchema: z.object({ operationId: z.string(), tool: z.string(), status: z.string(), changes: z.array(z.unknown()) }),
  dataCategories: { reads: ["ledger"], writes: [], stores: [], returnsToClient: ["diffs"] },
  docs: { examples: [{ title: "Diff an operation", input: { operationId: "op_123" } }], failureModes: [{ code: "NOT_FOUND", meaning: "Unknown operation id." }], limitations: [] },
  handler: async (ctx, input) => {
    const op = await ctx.ledger.get(input.operationId);
    if (!op || op.shopId !== ctx.shop.shopId) return fail({ operationId: ctx.operationId }, changeDiffTool, { code: "NOT_FOUND", message: `Operation "${input.operationId}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, changeDiffTool, {
      summary: `${op.changes.length} change(s) recorded by ${op.tool}`,
      data: { operationId: op.operationId, tool: op.tool, status: op.status, changes: op.changes },
      evidence: op.changes.filter((c) => c.diff).map((c) => ({ type: "diff" as const, label: c.resource, value: c.diff })),
    });
  },
});

export function registerChangeTools(registry: ToolRegistry): void {
  registry.register(changePlanTool);
  registry.register(changeValidateTool);
  registry.register(changeApplyTool);
  registry.register(changeDiffTool);
  // preview/history/rollback are the existing tools under their façade names.
  registry.addAlias("commerce.change.preview", "commerce.change.plan");
  registry.addAlias("commerce.change.history", "commerce.operations.list");
  registry.addAlias("commerce.change.get", "commerce.operation.get");
  registry.addAlias("commerce.change.rollback_plan", "commerce.rollback.plan");
  registry.addAlias("commerce.change.approve", "commerce.operation.approve");
  registry.addAlias("commerce.change.snapshot", "commerce.snapshot.create");
}
