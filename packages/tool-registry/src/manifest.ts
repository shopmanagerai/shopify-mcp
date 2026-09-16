/**
 * `tools-manifest.json` and `docs/tools.md` generation
 * (docs/PRODUCT_ARCHITECTURE.md §3: "Generated from the registry, in CI").
 */
import { toMcpJsonSchema } from "./json-schema.js";
import type { ToolDefinition } from "@shopmanagerai/shared";
import type { ToolRegistry } from "./registry.js";

export interface ManifestToolEntry {
  name: string;
  version: string;
  description: string;
  tier: string;
  category: string;
  riskClass: string;
  executionPlane: string;
  requiredEntitlements: string[];
  requiredShopifyScopes: string[];
  requiredStoreCapabilities: string[];
  supportsDryRun: boolean;
  rollback: string;
  supportsPagination: boolean;
  taskMode: string;
  idempotency: string;
  timeoutMs: number;
  rateLimitCategory: string;
  audit: string;
  approval: string;
  aliases: string[];
  dataCategories: ToolDefinition["dataCategories"];
  docs: ToolDefinition["docs"];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface Manifest {
  generatedAt: string;
  tools: ManifestToolEntry[];
}

function toEntry(def: ToolDefinition): ManifestToolEntry {
  return {
    name: def.name,
    version: def.version,
    description: def.description,
    tier: def.tier,
    category: def.category,
    riskClass: def.riskClass,
    executionPlane: def.executionPlane,
    requiredEntitlements: def.requiredEntitlements,
    requiredShopifyScopes: def.requiredShopifyScopes,
    requiredStoreCapabilities: def.requiredStoreCapabilities,
    supportsDryRun: def.supportsDryRun,
    rollback: def.rollback,
    supportsPagination: def.supportsPagination,
    taskMode: def.taskMode,
    idempotency: def.idempotency,
    timeoutMs: def.timeoutMs,
    rateLimitCategory: def.rateLimitCategory,
    audit: def.audit,
    approval: def.approval,
    aliases: def.aliases ?? [],
    dataCategories: def.dataCategories,
    docs: def.docs,
    inputSchema: toMcpJsonSchema(def.inputSchema),
    outputSchema: toMcpJsonSchema(def.outputSchema),
  };
}

/** Generate the machine-readable manifest, sorted deterministically. */
export function generateManifest(registry: ToolRegistry): Manifest {
  const tools = registry
    .list()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toEntry);
  return { generatedAt: "deterministic", tools }; // no timestamp: CI diffs the file
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** Generate `docs/tools.md`-style markdown: one section per tool. */
export function generateToolsMarkdown(registry: ToolRegistry): string {
  const defs = registry
    .list()
    .slice()
    .sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)));

  const lines: string[] = ["# Tool Manifest", "", `Generated from the tool registry. ${defs.length} tools.`, ""];

  let currentCategory: string | undefined;
  for (const def of defs) {
    if (def.category !== currentCategory) {
      currentCategory = def.category;
      lines.push(`## ${currentCategory}`, "");
    }

    lines.push(`### \`${def.name}\``, "");
    lines.push(def.description, "");
    lines.push(`- **Tier:** ${def.tier}`);
    lines.push(`- **Risk:** ${def.riskClass}`);
    lines.push(`- **Plane:** ${def.executionPlane}`);
    lines.push(`- **Scopes:** ${def.requiredShopifyScopes.length ? def.requiredShopifyScopes.join(", ") : "none"}`);
    lines.push(`- **Entitlements:** ${def.requiredEntitlements.length ? def.requiredEntitlements.join(", ") : "none"}`);
    lines.push(`- **Dry run:** ${def.supportsDryRun ? "supported" : "not supported"}`);
    lines.push(`- **Rollback:** ${def.rollback}`);
    lines.push(`- **Approval:** ${def.approval}`);
    if (def.aliases && def.aliases.length > 0) lines.push(`- **Aliases:** ${def.aliases.join(", ")}`);
    lines.push("");

    lines.push("**Input schema**", "", "```json", JSON.stringify(toMcpJsonSchema(def.inputSchema), null, 2), "```", "");

    if (def.docs.examples.length > 0) {
      lines.push("**Examples**", "");
      for (const ex of def.docs.examples) {
        lines.push(`- ${mdEscape(ex.title)}`);
        lines.push("", "```json", JSON.stringify(ex.input, null, 2), "```", "");
      }
    }

    if (def.docs.failureModes.length > 0) {
      lines.push("**Failure modes**", "");
      for (const fm of def.docs.failureModes) lines.push(`- \`${fm.code}\`: ${fm.meaning}`);
      lines.push("");
    }

    if (def.docs.limitations.length > 0) {
      lines.push("**Limitations**", "");
      for (const l of def.docs.limitations) lines.push(`- ${l}`);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}
