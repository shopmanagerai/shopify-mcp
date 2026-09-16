/**
 * Skills editor tools (category "skills"): per-shop custom/override MCP
 * prompts, stored via `ctx.services.get("skills")` (SkillsService). The
 * server merges these with the built-in file-based skills when serving
 * MCP `prompts/list` and `prompts/get` (same-name DB entries override a
 * built-in; disabled skills are hidden).
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { SKILLS_SERVICE_KEY, type SkillsService } from "../services.js";

const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const MAX_BODY_BYTES = 32 * 1024;

function requireSkillsService(ctx: { services: Map<string, unknown> }): SkillsService {
  const svc = ctx.services.get(SKILLS_SERVICE_KEY) as SkillsService | undefined;
  if (!svc) {
    throw new Error("No skills service configured for this shop.");
  }
  return svc;
}

const SkillItemSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  tier: z.string(),
  source: z.enum(["builtin", "custom"]),
  enabled: z.boolean(),
  updatedAt: z.string(),
});

export const skillsListTool: ToolDefinition = defineTool({
  name: "commerce.skills.list",
  description: "Lists this shop's skills (built-in file skills plus custom/overridden DB skills), including enabled state.",
  tier: "free",
  category: "skills",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({}),
  outputSchema: z.object({ skills: z.array(SkillItemSchema) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["skill definitions"], writes: [], stores: [], returnsToClient: ["skill list"] },
  docs: { examples: [{ title: "List skills", input: {} }], failureModes: [], limitations: ["Only reflects DB-stored skills; built-in file skills known to the server are merged in at the MCP layer, not here."] },
  handler: async (ctx, _input) => {
    const svc = ctx.services.get(SKILLS_SERVICE_KEY) as SkillsService | undefined;
    if (!svc) {
      return ok({ operationId: ctx.operationId }, skillsListTool, {
        summary: "No skills service configured",
        data: { skills: [] },
        warnings: ["No skills service wired up in ctx.services; returning an empty list."],
      });
    }
    const skills = await svc.list(ctx.shop.shopId);
    return ok({ operationId: ctx.operationId }, skillsListTool, {
      summary: `${skills.length} skill(s)`,
      data: { skills: skills.map((s) => ({ name: s.name, title: s.title, description: s.description, tier: s.tier, source: s.source, enabled: s.enabled, updatedAt: s.updatedAt })) },
    });
  },
});

export const skillsGetTool: ToolDefinition = defineTool({
  name: "commerce.skills.get",
  description: "Returns one skill's full body by name.",
  tier: "free",
  category: "skills",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({ skill: SkillItemSchema.extend({ body: z.string() }).nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["skill definition"], writes: [], stores: [], returnsToClient: ["skill body"] },
  docs: { examples: [{ title: "Get a skill", input: { name: "product-photo-audit" } }], failureModes: [{ code: "NOT_FOUND", meaning: "No skill with that name." }], limitations: [] },
  handler: async (ctx, input) => {
    const svc = requireSkillsService(ctx);
    const skill = await svc.get(ctx.shop.shopId, input.name);
    if (!skill) {
      return fail({ operationId: ctx.operationId }, skillsGetTool, { code: "NOT_FOUND", message: `No skill named "${input.name}".`, retryable: false });
    }
    return ok({ operationId: ctx.operationId }, skillsGetTool, {
      summary: `Skill "${skill.name}"`,
      data: { skill: { name: skill.name, title: skill.title, description: skill.description, tier: skill.tier, source: skill.source, enabled: skill.enabled, updatedAt: skill.updatedAt, body: skill.body } },
    });
  },
});

export const skillsWriteTool: ToolDefinition = defineTool({
  name: "commerce.skills.write",
  description: "Creates or updates a custom skill for this shop (becomes a custom copy if it overrides a built-in name).",
  tier: "free",
  category: "skills",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({
    name: z.string().regex(SKILL_NAME_RE, "name must match ^[a-z0-9-]+$"),
    title: z.string().min(1),
    description: z.string().min(1),
    tier: z.string().optional(),
    body: z.string().min(1).max(MAX_BODY_BYTES),
  }),
  outputSchema: z.object({ skill: SkillItemSchema }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: ["skill definition"], stores: ["skill body"], returnsToClient: ["saved skill"] },
  docs: {
    examples: [{ title: "Write a skill", input: { name: "product-photo-audit", title: "Product Photo Audit", description: "Finds products missing photos.", body: "Check every product for a primary image..." } }],
    failureModes: [{ code: "INVALID_INPUT", meaning: "Body exceeds 32KB, or name/fields fail validation." }],
    limitations: ["Body must be plain text/Markdown without YAML frontmatter; frontmatter fields (title/description/tier) are supplied as separate inputs."],
  },
  handler: async (ctx, input) => {
    if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) {
      return fail({ operationId: ctx.operationId }, skillsWriteTool, { code: "INVALID_INPUT", message: `Skill body exceeds ${MAX_BODY_BYTES} bytes.`, retryable: false });
    }
    if (/^---\r?\n/.test(input.body)) {
      return fail({ operationId: ctx.operationId }, skillsWriteTool, { code: "INVALID_INPUT", message: "Skill body must not include YAML frontmatter (---); use the title/description/tier inputs instead.", retryable: false });
    }
    const svc = requireSkillsService(ctx);
    const skill = await svc.upsert(ctx.shop.shopId, { name: input.name, title: input.title, description: input.description, tier: input.tier, body: input.body });
    return ok({ operationId: ctx.operationId }, skillsWriteTool, {
      summary: `Saved skill "${skill.name}"`,
      data: { skill: { name: skill.name, title: skill.title, description: skill.description, tier: skill.tier, source: skill.source, enabled: skill.enabled, updatedAt: skill.updatedAt } },
      changes: [{ resource: `skill:${skill.name}`, kind: "update", after: { title: skill.title, description: skill.description, body: skill.body } }],
    });
  },
});

export const skillsDeleteTool: ToolDefinition = defineTool({
  name: "commerce.skills.delete",
  description: "Permanently deletes a custom skill. Requires confirm:true.",
  tier: "free",
  category: "skills",
  riskClass: "destructive",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ name: z.string(), confirm: z.boolean().optional() }),
  outputSchema: z.object({ deleted: z.boolean() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: [], returnsToClient: ["delete result"] },
  docs: {
    examples: [{ title: "Delete a skill", input: { name: "product-photo-audit", confirm: true } }],
    failureModes: [{ code: "CONFIRM_REQUIRED", meaning: "confirm:true was not supplied." }, { code: "NOT_FOUND", meaning: "No skill with that name." }],
    limitations: ["Permanent; no rollback."],
  },
  handler: async (ctx, input) => {
    if (input.confirm !== true) {
      return fail({ operationId: ctx.operationId }, skillsDeleteTool, { code: "CONFIRM_REQUIRED", message: "commerce.skills.delete requires confirm: true.", retryable: false });
    }
    const svc = requireSkillsService(ctx);
    const deleted = await svc.delete(ctx.shop.shopId, input.name);
    if (!deleted) {
      return fail({ operationId: ctx.operationId }, skillsDeleteTool, { code: "NOT_FOUND", message: `No skill named "${input.name}".`, retryable: false });
    }
    return ok({ operationId: ctx.operationId }, skillsDeleteTool, {
      summary: `Deleted skill "${input.name}"`,
      data: { deleted: true },
      changes: [{ resource: `skill:${input.name}`, kind: "delete" }],
    });
  },
});

export const skillsEnableTool: ToolDefinition = defineTool({
  name: "commerce.skills.enable",
  description: "Enables or disables a skill (hides disabled skills from MCP prompts/list).",
  tier: "free",
  category: "skills",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ name: z.string(), enabled: z.boolean() }),
  outputSchema: z.object({ skill: SkillItemSchema.nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: ["skill enabled flag"], stores: [], returnsToClient: ["updated skill"] },
  docs: { examples: [{ title: "Disable a skill", input: { name: "product-photo-audit", enabled: false } }], failureModes: [{ code: "NOT_FOUND", meaning: "No skill with that name." }], limitations: [] },
  handler: async (ctx, input) => {
    const svc = requireSkillsService(ctx);
    const skill = await svc.setEnabled(ctx.shop.shopId, input.name, input.enabled);
    if (!skill) {
      return fail({ operationId: ctx.operationId }, skillsEnableTool, { code: "NOT_FOUND", message: `No skill named "${input.name}".`, retryable: false });
    }
    return ok({ operationId: ctx.operationId }, skillsEnableTool, {
      summary: `${input.enabled ? "Enabled" : "Disabled"} skill "${skill.name}"`,
      data: { skill: { name: skill.name, title: skill.title, description: skill.description, tier: skill.tier, source: skill.source, enabled: skill.enabled, updatedAt: skill.updatedAt } },
      changes: [{ resource: `skill:${skill.name}`, kind: "update", after: { enabled: skill.enabled } }],
    });
  },
});

export function registerSkillsTools(registry: ToolRegistry): void {
  registry.register(skillsListTool);
  registry.register(skillsGetTool);
  registry.register(skillsWriteTool);
  registry.register(skillsDeleteTool);
  registry.register(skillsEnableTool);
}
