import type { ZodTypeAny } from "zod";
import type { ToolContext } from "./planes.js";
import type {
  ApprovalKind,
  Entitlement,
  ExecutionPlane,
  RiskClass,
  RollbackStrategy,
  StoreCapability,
  Tier,
  ToolResult,
  RiskLevel,
} from "./types.js";

export const TOOL_CATEGORIES = [
  "system",
  "auth",
  "store",
  "theme",
  "theme_file",
  "liquid",
  "section",
  "block",
  "template",
  "theme_check",
  "hydrogen",
  "product",
  "variant",
  "collection",
  "page",
  "blog",
  "navigation",
  "metafield",
  "metaobject",
  "media",
  "apps",
  "conflicts",
  "design",
  "page_type",
  "seo",
  "aeo",
  "cro",
  "accessibility",
  "performance",
  "visual",
  "debug",
  "snapshot",
  "orchestration",
  "content",
  "agency",
  "dev",
  "skills",
  "security",
  "memory",
  "inventory",
  "markets",
  "translations",
  "discounts",
  "orders",
  "customers",
  "webhooks",
  "analytics",
  "extensions",
  "checkout",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface ToolExample {
  title: string;
  input: Record<string, unknown>;
  output?: unknown;
}
export interface FailureMode {
  code: string;
  meaning: string;
}
export interface DataCategories {
  reads: string[];
  writes: string[];
  stores: string[];
  returnsToClient: string[];
}

/**
 * Declarative tool definition (docs/PRODUCT_ARCHITECTURE.md §3). A tool that is
 * not in the registry does not exist.
 */
export interface ToolDefinition<I = any, O = any> {
  name: string;
  version: string;
  description: string;
  tier: Tier;
  category: ToolCategory;
  riskClass: RiskClass;
  executionPlane: ExecutionPlane;
  requiredEntitlements: Entitlement[];
  requiredShopifyScopes: string[];
  requiredStoreCapabilities: StoreCapability[];
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  supportsDryRun: boolean;
  rollback: RollbackStrategy;
  supportsPagination: boolean;
  taskMode: "sync" | "task";
  idempotency: "natural" | "key_required" | "none";
  timeoutMs: number;
  rateLimitCategory: "admin_read" | "admin_write" | "theme" | "browser" | "job" | "none";
  audit: "always" | "mutations_only";
  approval: ApprovalKind;
  /** Fields whose presence escalates the risk class (review finding A3). */
  escalation?: Array<{ whenInputHas: string[]; toRisk: RiskClass; policyKey?: string }>;
  dataCategories: DataCategories;
  docs: { examples: ToolExample[]; failureModes: FailureMode[]; limitations: string[] };
  /** Agent-facing risk level; derived from riskClass/category when omitted. */
  riskLevel?: RiskLevel;
  /** Reads or writes Shopify protected customer data (customers, orders, draft orders). */
  protectedCustomerData?: boolean;
  /** Shopify plan the feature needs, when Shopify gates it. */
  planRequirement?: "plus" | "advanced";
  /** Scopes that unlock extra behaviour but are not required. */
  optionalShopifyScopes?: string[];
  /** Earliest Admin API version the tool's operations exist in. */
  minApiVersion?: string;
  /** Aliases listed once in discovery (review finding B5). */
  aliases?: string[];
  /** Tool families expand a `target` enum into names (review finding B9). */
  family?: { param: string; values: string[] };
  handler: (ctx: ToolContext, input: I) => Promise<ToolResult<O>>;
}

export interface ToolCard {
  name: string;
  description: string;
  tier: Tier;
  category: ToolCategory;
  risk: RiskClass;
  riskLevel?: RiskLevel;
  requiredScopes?: string[];
  protectedCustomerData?: boolean;
  planRequirement?: "plus" | "advanced";
  availability: "available" | "pro_required" | "agency_required" | "scope_missing" | "capability_missing" | "profile_denied" | "unverified" | "plan_required" | "protected_data_required" | "version_unsupported";
  reason?: string;
  aliases?: string[];
}
