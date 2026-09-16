import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Snapshot + rollback tools (category "snapshot"): commerce.snapshot.* wrap
 * ctx.snapshots directly; commerce.rollback.* delegate to a RollbackService
 * pulled from ctx.services (see ../services.ts) so this package stays
 * independent of any concrete ledger/storage implementation.
 */
import { z } from "zod";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { summarizeFileSetDiff } from "@shopmanagerai/shopify-theme";
import { requireTheme } from "../theme-loader.js";
import { ROLLBACK_SERVICE_KEY, type RollbackService } from "../services.js";

function requireRollback(ctx: { services: Map<string, unknown> }): RollbackService {
  const svc = ctx.services.get(ROLLBACK_SERVICE_KEY) as RollbackService | undefined;
  if (!svc) {
    throw new ShopManagerAIError("NOT_SUPPORTED", "No rollback service is configured for this deployment.", { retryable: false });
  }
  return svc;
}

export const snapshotCreateTool: ToolDefinition = defineTool({
  name: "commerce.snapshot.create",
  description: "Creates a point-in-time snapshot of a theme's files (kind:'theme'), for use as a rollback target.",
  tier: "free",
  category: "snapshot",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: ["theme.read"],
  inputSchema: z.object({ themeId: z.string().optional(), label: z.string().optional() }),
  outputSchema: z.object({ snapshotId: z.string(), fileCount: z.number().optional() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["theme files"], writes: [], stores: ["theme snapshot"], returnsToClient: ["snapshot id"] },
  docs: {
    examples: [{ title: "Snapshot the working theme", input: { themeId: "124", label: "before redesign" } }],
    failureModes: [],
    limitations: ["The docs/V0_1_IMPLEMENTATION_PLAN.md theme.pull path maps to this tool with kind 'theme'."],
  },
  handler: async (ctx, input) => {
    const engine = requireTheme(ctx.theme);
    const metas = await engine.listFiles(input.themeId!);
    const files = await engine.readFiles(input.themeId!, metas.map((f) => f.key));
    const snapshot = await ctx.snapshots.createThemeSnapshot(ctx.shop.shopId, input.themeId!, files, {
      label: input.label ?? `Snapshot of theme ${input.themeId!}`,
      createdBy: ctx.credential.credentialId,
      operationId: ctx.operationId,
    });
    return ok({ operationId: ctx.operationId }, snapshotCreateTool, {
      summary: `Created snapshot ${snapshot.snapshotId} (${files.length} file(s))`,
      data: { snapshotId: snapshot.snapshotId, fileCount: files.length },
    });
  },
});

export const snapshotListTool: ToolDefinition = defineTool({
  name: "commerce.snapshot.list",
  description: "Lists snapshots for this shop, optionally filtered by kind.",
  tier: "free",
  category: "snapshot",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ kind: z.enum(["theme", "resource", "seo_baseline", "visual_baseline"]).optional(), limit: z.number().optional() }),
  outputSchema: z.object({ snapshots: z.array(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["snapshot metadata"], writes: [], stores: [], returnsToClient: ["snapshot list"] },
  docs: { examples: [{ title: "List theme snapshots", input: { kind: "theme" } }], failureModes: [], limitations: [] },
  handler: async (ctx, input) => {
    const snapshots = await ctx.snapshots.list(ctx.shop.shopId, { kind: input.kind, limit: input.limit });
    return ok({ operationId: ctx.operationId }, snapshotListTool, { summary: `${snapshots.length} snapshot(s)`, data: { snapshots } });
  },
});

export const snapshotGetTool: ToolDefinition = defineTool({
  name: "commerce.snapshot.get",
  aliases: ["commerce.snapshot.inspect"],
  description: "Fetches metadata for one snapshot by id.",
  tier: "free",
  category: "snapshot",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ snapshotId: z.string() }),
  outputSchema: z.object({ snapshot: z.unknown() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["snapshot metadata"], writes: [], stores: [], returnsToClient: ["snapshot metadata"] },
  docs: { examples: [{ title: "Get a snapshot", input: { snapshotId: "snap_123" } }], failureModes: [{ code: "SNAPSHOT_NOT_FOUND", meaning: "No snapshot with that id." }], limitations: [] },
  handler: async (ctx, input) => {
    const snapshot = await ctx.snapshots.get(input.snapshotId);
    if (!snapshot) return fail({ operationId: ctx.operationId }, snapshotGetTool, { code: "SNAPSHOT_NOT_FOUND", message: `Snapshot "${input.snapshotId}" not found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, snapshotGetTool, { summary: `Snapshot ${snapshot.snapshotId}`, data: { snapshot } });
  },
});

// ---------------------------------------------------------------------------
// commerce.snapshot.diff
// ---------------------------------------------------------------------------
async function resolveFileSet(ctx: Parameters<typeof snapshotCreateTool.handler>[0], idOrThemeId: string) {
  const snap = await ctx.snapshots.get(idOrThemeId);
  if (snap) {
    return ctx.snapshots.readThemeFiles(idOrThemeId);
  }
  const engine = requireTheme(ctx.theme);
  if (!(await engine.getTheme(idOrThemeId))) {
    throw new ShopManagerAIError("NOT_FOUND", "\"" + idOrThemeId + "\" is neither a snapshot id nor a theme id.", { retryable: false });
  }
  const metas = await engine.listFiles(idOrThemeId);
  return engine.readFiles(idOrThemeId, metas.map((f) => f.key));
}

export const snapshotDiffTool: ToolDefinition = defineTool({
  name: "commerce.snapshot.diff",
  description: "Diffs two theme file sets, where each side is either a snapshot id or a live theme id.",
  tier: "free",
  category: "snapshot",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ a: z.string(), b: z.string() }),
  outputSchema: z.object({ a: z.string(), b: z.string(), summary: z.record(z.unknown()) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["snapshot data", "theme files"], writes: [], stores: [], returnsToClient: ["file diff summary"] },
  docs: {
    examples: [{ title: "Diff two snapshots", input: { a: "snap_1", b: "snap_2" } }, { title: "Diff a snapshot against a live theme", input: { a: "snap_1", b: "124" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "Neither id resolves to a snapshot or theme." }],
    limitations: ["Binary files are summarized by size, not diffed byte-for-byte."],
  },
  handler: async (ctx, input) => {
    const [filesA, filesB] = await Promise.all([resolveFileSet(ctx, input.a), resolveFileSet(ctx, input.b)]);
    const summary = summarizeFileSetDiff(filesA, filesB);
    return ok({ operationId: ctx.operationId }, snapshotDiffTool, {
      summary: `${summary.added.length} added, ${summary.removed.length} removed, ${summary.changed.length} changed`,
      data: { a: input.a, b: input.b, summary: summary as unknown as Record<string, unknown> },
    });
  },
});

export const rollbackPlanTool: ToolDefinition = defineTool({
  name: "commerce.rollback.plan",
  description: "Plans how a given operation would be rolled back, without executing it.",
  tier: "free",
  category: "snapshot",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ operationId: z.string() }),
  outputSchema: z.object({ plan: z.unknown() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["operation ledger", "snapshot metadata"], writes: [], stores: [], returnsToClient: ["rollback plan"] },
  docs: {
    examples: [{ title: "Plan a rollback", input: { operationId: "op_123" } }],
    failureModes: [{ code: "NOT_SUPPORTED", meaning: "No rollback service configured." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    try {
      const svc = requireRollback(ctx);
      const plan = await svc.plan(input.operationId);
      return ok({ operationId: ctx.operationId }, rollbackPlanTool, { summary: `${plan.steps.length} rollback step(s)`, data: { plan } });
    } catch (e) {
      if (e instanceof ShopManagerAIError) return fail({ operationId: ctx.operationId }, rollbackPlanTool, e);
      throw e;
    }
  },
});

export const rollbackVerifyTool: ToolDefinition = defineTool({
  name: "commerce.rollback.verify",
  description: "Verifies whether a rollback for an operation was fully applied (all planned steps restored, no residual diff).",
  tier: "free",
  category: "snapshot",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ operationId: z.string() }),
  outputSchema: z.object({ verified: z.boolean(), plan: z.unknown() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["operation ledger", "theme files"], writes: [], stores: [], returnsToClient: ["verification result"] },
  docs: { examples: [{ title: "Verify a rollback", input: { operationId: "op_123" } }], failureModes: [{ code: "NOT_SUPPORTED", meaning: "No rollback service configured." }], limitations: [] },
  handler: async (ctx, input) => {
    try {
      const svc = requireRollback(ctx);
      const plan = await svc.plan(input.operationId);
      return ok({ operationId: ctx.operationId }, rollbackVerifyTool, { summary: plan.available ? "Rollback available" : "No rollback available", data: { verified: plan.available, plan } });
    } catch (e) {
      if (e instanceof ShopManagerAIError) return fail({ operationId: ctx.operationId }, rollbackVerifyTool, e);
      throw e;
    }
  },
});

export function registerSnapshotTools(registry: ToolRegistry): void {
  registry.register(snapshotCreateTool);
  registry.register(snapshotListTool);
  registry.register(snapshotGetTool);
  registry.register(snapshotDiffTool);
  registry.register(rollbackPlanTool);
  registry.register(rollbackVerifyTool);
}
