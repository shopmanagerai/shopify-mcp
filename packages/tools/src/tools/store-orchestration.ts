import type { ToolDefinition } from "@shopmanagerai/shared";
/**
 * Store-level orchestration (category "orchestration", tier "pro", entitlement
 * "pro.orchestration"): sequences the existing page-type/design/theme/app
 * tools into whole-store workflows (build a new store, redesign an existing
 * one, audit everything, or diagnose+repair a reported symptom) behind one
 * call each, with a persisted job record so progress survives the call.
 *
 * Every tool here is synchronous (0.x) and calls sibling tools exclusively
 * through `ctx.services.get("registry")` (never by importing another tool's
 * handler directly) so this file composes the same pipeline an MCP client
 * would, just in one round trip. Nothing here ever publishes a theme.
 */
import { z } from "zod";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import type { ToolContext } from "@shopmanagerai/shared";




import { KV_SERVICE_KEY, type KvService } from "../services.js";






// ---------------------------------------------------------------------------
// Shared job-record plumbing (persisted at kv:"job:<shopId>:<jobId>")
// ---------------------------------------------------------------------------
export interface StoreOrchestrationStage {
  name: string;
  status: "running" | "done" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  note?: string;
}
export interface StoreOrchestrationJobRecord {
  jobId: string;
  shopId: string;
  tool: string;
  createdAt: string;
  updatedAt: string;
  stages: StoreOrchestrationStage[];
  result?: unknown;
  ok?: boolean;
  /** Top-level status for list views: running until finish() is called. */
  status: "running" | "completed" | "failed";
}

function kvKey(shopId: string, jobId: string): string {
  return `job:${shopId}:${jobId}`;
}

function requireKv(ctx: { services: Map<string, unknown> }): KvService {
  const svc = ctx.services.get(KV_SERVICE_KEY) as KvService | undefined;
  if (!svc) throw new ShopManagerAIError("NOT_SUPPORTED", "No kv service is configured for this deployment.", { retryable: false });
  return svc;
}


async function getTool(ctx: ToolContext, name: string) {
  const registry = ctx.services.get("registry") as ToolRegistry | undefined;
  const def = registry?.get(name);
  if (!def) throw new ShopManagerAIError("TOOL_NOT_FOUND", `Unknown tool "${name}".`, { retryable: false });
  return def;
}

async function call<T = unknown>(ctx: ToolContext, name: string, input: unknown): Promise<{ ok: true; data: T; operationId?: string } | { ok: false; code: string; message: string }> {
  const def = await getTool(ctx, name);
  try {
    const result = await def.handler(ctx, input as any);
    if (result.ok) return { ok: true, data: result.data as T, operationId: (result as { operationId?: string }).operationId };
    return { ok: false, code: result.code, message: result.message };
  } catch (e) {
    // Some handlers throw (e.g. STOREFRONT_PASSWORD_PROTECTED from capture); an orchestrator
    // treats that like any other failed sub-call so one optional stage cannot abort the run.
    if (e instanceof ShopManagerAIError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
  }
}
























interface MergedFinding {
  severity: string;
  category: string;
  title: string;
  detail: string;
  evidence: unknown;
  source: string;
}








interface RepairCandidate {
  id: string;
  title: string;
  detail: string;
  file?: string;
  score: number;
  source: string;
  fixStrategy?: string;
  caseId?: string;
}





// ---------------------------------------------------------------------------
// shopify.store.job_status
// ---------------------------------------------------------------------------
export const storeJobStatusTool: ToolDefinition = defineTool({
  name: "shopify.store.job_status",
  description: "Reads back a shopify.store.* job record (stages + result) by jobId.",
  tier: "free",
  category: "orchestration",
  riskClass: "read",
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
  dataCategories: { reads: ["job record"], writes: [], stores: [], returnsToClient: ["job record"] },
  docs: { examples: [{ title: "Read back a job", input: { jobId: "job_abc123" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No job with that id for this shop." }], limitations: [] },
  handler: async (ctx, input) => {
    const kv = requireKv(ctx);
    const record = await kv.get<StoreOrchestrationJobRecord>(kvKey(ctx.shop.shopId, input.jobId));
    if (!record) return fail({ operationId: ctx.operationId }, storeJobStatusTool, { code: "NOT_FOUND", message: `No job "${input.jobId}" found.`, retryable: false });
    return ok({ operationId: ctx.operationId }, storeJobStatusTool, { summary: `Job ${input.jobId}: ${record.stages.length} stage(s)`, data: { job: record } });
  },
});

// ---------------------------------------------------------------------------
// commerce.export
// ---------------------------------------------------------------------------
const ExportInput = z.object({
  kind: z.enum(["ledger", "audit", "design_manifest", "apps_manifest", "report"]),
  id: z.string().optional(),
  format: z.enum(["json", "markdown"]).optional(),
  since: z.string().optional(),
  limit: z.number().optional(),
});

function renderMarkdown(kind: string, document: Record<string, unknown>): string {
  const lines: string[] = [`# ShopManager AI export: ${kind}`, ""];
  if (kind === "report" && document.gates) {
    const gates = document.gates as { passed: string[]; failed: Array<{ gate: string; reason: string }> };
    lines.push("## Gates", "", "| Gate | Result | Reason |", "| --- | --- | --- |");
    for (const g of gates.passed ?? []) lines.push(`| ${g} | passed | |`);
    for (const g of gates.failed ?? []) lines.push(`| ${g.gate} | failed | ${g.reason} |`);
    lines.push("");
  }
  if (Array.isArray(document.stages)) {
    lines.push("## Stages", "", "| Stage | Status | Note |", "| --- | --- | --- |");
    for (const s of document.stages as Array<{ name: string; status: string; note?: string }>) lines.push(`| ${s.name} | ${s.status} | ${s.note ?? ""} |`);
    lines.push("");
  }
  if (Array.isArray(document.findings)) {
    lines.push("## Findings", "", "| Severity | Category | Title |", "| --- | --- | --- |");
    for (const f of document.findings as Array<{ severity: string; category: string; title: string }>) lines.push(`| ${f.severity} | ${f.category} | ${f.title} |`);
    lines.push("");
  }
  if (Array.isArray(document.items)) {
    lines.push("## Items", "", "| Tool | Status | Started |", "| --- | --- | --- |");
    for (const it of document.items as Array<{ tool: string; status: string; startedAt: string }>) lines.push(`| ${it.tool} | ${it.status} | ${it.startedAt} |`);
    lines.push("");
  }
  if (lines.length === 2) lines.push("```json", JSON.stringify(document, null, 2), "```");
  return lines.join("\n");
}

async function runExport(ctx: ToolContext, rawInput: z.infer<typeof ExportInput>) {
  const input = { ...rawInput, format: rawInput.format ?? ("json" as const) };
  const kv = requireKv(ctx);
  let document: Record<string, unknown>;

  switch (input.kind) {
    case "ledger": {
      const page = await ctx.ledger.list(ctx.shop.shopId, { limit: input.limit ?? 50 });
      document = { items: page.items };
      break;
    }
    case "audit": {
      const audit = await kv.get<Record<string, unknown>>(`audit:last:${ctx.shop.shopId}`);
      if (!audit) return fail({ operationId: ctx.operationId }, commerceExportTool, { code: "NOT_FOUND", message: "No stored audit found. Run shopify.store.audit first.", retryable: false });
      document = audit;
      break;
    }
    case "design_manifest": {
      const svc = ctx.services.get("designManifests") as { get: (id: string) => Promise<unknown>; getActive: (shopId: string) => Promise<unknown> } | undefined;
      const record = input.id ? await svc?.get(input.id) : await svc?.getActive(ctx.shop.shopId);
      if (!record) return fail({ operationId: ctx.operationId }, commerceExportTool, { code: "NOT_FOUND", message: "No design manifest found.", retryable: false });
      document = record as Record<string, unknown>;
      break;
    }
    case "apps_manifest": {
      const res = await call<Record<string, unknown>>(ctx, "shopify.apps.preservation_manifest_basic", {});
      if (!res.ok) return fail({ operationId: ctx.operationId }, commerceExportTool, { code: "INTERNAL", message: res.message, retryable: false });
      document = res.data;
      break;
    }
    case "report": {
      if (!input.id) return fail({ operationId: ctx.operationId }, commerceExportTool, { code: "INVALID_INPUT", message: "commerce.export kind:'report' requires an id (jobId).", retryable: false });
      const record = await kv.get<StoreOrchestrationJobRecord>(kvKey(ctx.shop.shopId, input.id));
      if (!record) return fail({ operationId: ctx.operationId }, commerceExportTool, { code: "NOT_FOUND", message: `No job "${input.id}" found.`, retryable: false });
      document = { ...record, ...(typeof record.result === "object" && record.result ? (record.result as Record<string, unknown>) : {}) };
      break;
    }
  }

  if (input.format === "markdown") {
    const text = renderMarkdown(input.kind, document);
    return ok({ operationId: ctx.operationId }, commerceExportTool, {
      summary: `Exported ${input.kind} as markdown`,
      data: { document: text, format: "markdown" as const },
      content: [{ type: "text", text }],
    });
  }
  return ok({ operationId: ctx.operationId }, commerceExportTool, {
    summary: `Exported ${input.kind} as json`,
    data: { document, format: "json" as const },
  });
}

export const commerceExportTool: ToolDefinition = defineTool({
  name: "commerce.export",
  description: "Exports the ledger, the last stored store audit, a design manifest, the app preservation manifest, or a job report as JSON or Markdown.",
  tier: "free",
  category: "orchestration",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: ExportInput,
  outputSchema: z.object({ document: z.unknown(), format: z.enum(["json", "markdown"]) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["ledger", "job records", "design manifests"], writes: [], stores: [], returnsToClient: ["exported document"] },
  docs: {
    examples: [{ title: "Export the ledger as markdown", input: { kind: "ledger", format: "markdown" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "The requested resource (audit/report/manifest) does not exist yet." }],
    limitations: ["kind:'audit' returns the most recently stored shopify.store.audit result, not a fresh audit."],
  },
  handler: (ctx, input) => runExport(ctx, input),
});

export function registerStoreOrchestrationTools(registry: ToolRegistry): void {
  registry.register(storeJobStatusTool);
  registry.register(commerceExportTool);
}
