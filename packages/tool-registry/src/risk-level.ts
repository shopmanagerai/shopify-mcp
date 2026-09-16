/**
 * Risk levels (spec vocabulary) derived from the finer-grained `riskClass` +
 * category every tool already declares. `riskClass` stays the enforcement key for
 * profiles/approvals; `riskLevel` is the human/agent-facing classification that
 * cards, schemas and the change façade report. Tools may override it explicitly.
 */
import type { RiskLevel, ToolCategory, ToolDefinition } from "@shopmanagerai/shared";

const CONTENT_CATEGORIES = new Set<ToolCategory>(["page", "blog", "navigation", "metafield", "metaobject", "media", "seo", "aeo"] as ToolCategory[]);
const COMMERCE_CATEGORIES = new Set<ToolCategory>(["product", "variant", "collection", "store", "inventory", "markets", "translations"] as ToolCategory[]);
const FINANCIAL_CATEGORIES = new Set<ToolCategory>(["discounts", "orders"] as ToolCategory[]);
const CHECKOUT_CATEGORIES = new Set<ToolCategory>(["checkout"] as ToolCategory[]);
const CUSTOMER_CATEGORIES = new Set<ToolCategory>(["customers"] as ToolCategory[]);
const DESIGN_CATEGORIES = new Set<ToolCategory>(["theme", "theme_file", "liquid", "section", "block", "template", "design", "page_type", "visual", "theme_check", "conflicts", "performance", "accessibility", "cro"] as ToolCategory[]);

export function deriveRiskLevel(def: Pick<ToolDefinition, "riskClass" | "category" | "name"> & { protectedCustomerData?: boolean }): RiskLevel {
  if (def.protectedCustomerData && def.riskClass !== "read") return "CUSTOMER_DATA";
  switch (def.riskClass) {
    case "read":
      return def.protectedCustomerData ? "CUSTOMER_DATA" : "READ_ONLY";
    case "publish":
      return "PRODUCTION_DEPLOY";
    case "critical":
      return /rollback|restore/.test(def.name) ? "DESTRUCTIVE" : "PRODUCTION_DEPLOY";
    case "destructive":
      return "DESTRUCTIVE";
    case "commerce_sensitive":
      if (CHECKOUT_CATEGORIES.has(def.category)) return "CHECKOUT_CRITICAL";
      if (FINANCIAL_CATEGORIES.has(def.category)) return "FINANCIAL_IMPACT";
      return "COMMERCE_WRITE";
    case "theme_write":
      return "DESIGN_WRITE";
    case "bulk":
    case "write":
      if (FINANCIAL_CATEGORIES.has(def.category)) return "FINANCIAL_IMPACT";
      if (CUSTOMER_CATEGORIES.has(def.category)) return "CUSTOMER_DATA";
      if (COMMERCE_CATEGORIES.has(def.category)) return "COMMERCE_WRITE";
      if (CONTENT_CATEGORIES.has(def.category)) return "CONTENT_WRITE";
      if (DESIGN_CATEGORIES.has(def.category)) return "DESIGN_WRITE";
      return "SAFE_WRITE";
    default:
      return "SAFE_WRITE";
  }
}
