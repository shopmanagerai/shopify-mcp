/**
 * Discovery cards and MCP `tools/list` payloads (docs/PRODUCT_ARCHITECTURE.md
 * §4). Deterministic ordering: category, then name.
 */
import { z } from "zod";
import { toMcpJsonSchema } from "./json-schema.js";
import { isRiskAllowedByProfile } from "@shopmanagerai/policy-engine";
import type { Entitlement, Profile, StoreCapability, Tier, ToolCard, ToolDefinition } from "@shopmanagerai/shared";
import type { ToolRegistry } from "./registry.js";

export interface AvailabilityContext {
  tier: Tier;
  entitlements: Set<Entitlement>;
  profile: Profile;
  scopesGranted: Set<string>;
  capabilities: Set<StoreCapability>;
  policy: Record<string, boolean | number | string>;
  /** Tool names known to be `supported-unverified` on the current Shopify surface (ARCHITECTURE_REVIEW E). */
  unverified?: Set<string>;
  /** Store facts for plan / protected-data / version gates. */
  storeFacts?: { plan?: string; protectedCustomerDataApproved?: boolean; apiVersion?: string; distribution?: "custom" | "public" };
}

function sortedDefs(registry: ToolRegistry): ToolDefinition[] {
  return registry
    .list()
    .slice()
    .sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)));
}

function cardFor(def: ToolDefinition, ctx: AvailabilityContext): ToolCard {
  const base: ToolCard = {
    name: def.name,
    description: def.description,
    tier: def.tier,
    category: def.category,
    risk: def.riskClass,
    riskLevel: def.riskLevel,
    requiredScopes: def.requiredShopifyScopes,
    ...(def.protectedCustomerData ? { protectedCustomerData: true } : {}),
    ...(def.planRequirement ? { planRequirement: def.planRequirement } : {}),
    availability: "available",
    ...(def.aliases && def.aliases.length > 0 ? { aliases: def.aliases } : {}),
  };

  const missingEntitlement = def.requiredEntitlements.find((e) => !ctx.entitlements.has(e));
  if (missingEntitlement) {
    const isAgency = missingEntitlement.startsWith("agency.");
    return { ...base, availability: isAgency ? "agency_required" : "pro_required", reason: `Requires entitlement "${missingEntitlement}".` };
  }
  if (def.tier === "agency" && ctx.tier !== "agency") {
    return { ...base, availability: "agency_required", reason: "Requires the Agency plan." };
  }
  if (def.tier === "pro" && ctx.tier === "free") {
    return { ...base, availability: "pro_required", reason: "Requires the Pro plan." };
  }

  const missingScope = def.requiredShopifyScopes.find((s) => !ctx.scopesGranted.has(s));
  if (missingScope) {
    return { ...base, availability: "scope_missing", reason: `Missing Shopify scope "${missingScope}".` };
  }

  const facts = ctx.storeFacts;
  if (def.planRequirement === "plus" && facts?.plan !== undefined && !/plus/i.test(facts.plan)) {
    return { ...base, availability: "plan_required", reason: `Requires Shopify Plus; the connected store is on "${facts.plan}".` };
  }
  if (def.protectedCustomerData && facts?.distribution === "public" && facts.protectedCustomerDataApproved === false) {
    return { ...base, availability: "protected_data_required", reason: "Touches protected customer data; the app is not yet approved for it." };
  }
  if (def.minApiVersion && facts?.apiVersion && facts.apiVersion.localeCompare(def.minApiVersion) < 0) {
    return { ...base, availability: "version_unsupported", reason: `Requires Shopify API ${def.minApiVersion}+; server is on ${facts.apiVersion}.` };
  }

  const missingCapability = def.requiredStoreCapabilities.find((c) => !ctx.capabilities.has(c));
  if (missingCapability) {
    return { ...base, availability: "capability_missing", reason: `Store capability "${missingCapability}" not available.` };
  }

  if (ctx.policy[`tool.${def.name}`] === false || ctx.policy[`category.${def.category}`] === false) {
    return { ...base, availability: "profile_denied", reason: "Disabled by policy." };
  }

  if (!isRiskAllowedByProfile(ctx.profile, def.riskClass, def.name)) {
    return { ...base, availability: "profile_denied", reason: `Profile "${ctx.profile}" does not allow risk class "${def.riskClass}".` };
  }

  if (ctx.unverified?.has(def.name)) {
    return { ...base, availability: "unverified", reason: "Behaviour on this Shopify surface is not yet verified." };
  }

  return base;
}

/** All tool cards, deterministically ordered by (category, name). */
export function computeCards(registry: ToolRegistry, ctx: AvailabilityContext): ToolCard[] {
  return sortedDefs(registry).map((def) => cardFor(def, ctx));
}

// ---------- MCP meta-tool schemas ----------

export const DiscoverToolsInput = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  tier: z.enum(["free", "pro", "agency"]).optional(),
});

export const GetSchemaInput = z.object({
  name: z.string(),
});

export const ExecuteToolInput = z.object({
  name: z.string(),
  input: z.record(z.unknown()).default({}),
  context: z.record(z.unknown()).optional(),
});

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

/**
 * Derives MCP annotations from the metadata a tool already declares, so the
 * hints cannot drift from the policy the server enforces.
 */
export function annotationsFor(def: ToolDefinition): McpToolAnnotations {
  const writes = def.dataCategories?.writes ?? [];
  const readOnly = def.riskClass === "read" && writes.length === 0;
  return {
    readOnlyHint: readOnly,
    destructiveHint: def.riskClass === "destructive" || def.riskClass === "critical",
    idempotentHint: readOnly,
    openWorldHint: def.executionPlane === "shopify_admin" || def.executionPlane === "theme_engine",
  };
}

const META_TOOLS: McpToolDescriptor[] = [
  {
    name: "discover-tools",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "List available tool cards (name, one-line description, risk, tier, availability reason). Deterministic ordering.",
    inputSchema: toMcpJsonSchema(DiscoverToolsInput),
  },
  {
    name: "get-schema",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Get the full input/output schema, examples and failure modes for one tool.",
    inputSchema: toMcpJsonSchema(GetSchemaInput),
  },
  {
    name: "execute-tool",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: "Run a tool by name under the policy engine.",
    inputSchema: toMcpJsonSchema(ExecuteToolInput),
  },
];

function descriptorFor(def: ToolDefinition): McpToolDescriptor {
  return {
    name: def.name,
    description: def.description,
    inputSchema: toMcpJsonSchema(def.inputSchema),
    outputSchema: toMcpJsonSchema(def.outputSchema),
    annotations: annotationsFor(def),
  };
}

/**
 * MCP `tools/list` payload. `"meta"` returns only the three progressive-
 * disclosure meta-tools (ARCHITECTURE_REVIEW F1). `"flat"` returns every
 * currently-available tool directly (pro_required/etc. tools are excluded
 * from flat but still show up as cards from `discover-tools`).
 */
export function listForMcp(registry: ToolRegistry, ctx: AvailabilityContext, mode: "meta" | "flat"): McpToolDescriptor[] {
  if (mode === "meta") return META_TOOLS;

  const cards = computeCards(registry, ctx);
  const available = cards.filter((c) => c.availability === "available");
  return available
    .map((c) => registry.get(c.name))
    .filter((def): def is ToolDefinition => Boolean(def))
    .map(descriptorFor);
}
