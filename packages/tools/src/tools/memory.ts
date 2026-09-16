/**
 * Memory tools (category "memory"): persistent, database-backed memories an
 * agent builds up across conversations. Port of the original Pro plugin’s
 * `the original memory abilities` abilities, `commerce.memory.list` is
 * the index (equivalent to MEMORY.md), `commerce.memory.get` returns one
 * memory's full body, `commerce.memory.save` writes/updates, `.delete`
 * removes one, and `.versions`/`.restore` are the history/rollback pair
 * the original Pro plugin’s admin screen exposes as "revisions".
 *
 * Stored via `ctx.services.get("memory")` (MemoryService), storage-agnostic
 * so this package never depends on @shopmanagerai/storage concretely; the
 * server wires a real MemoryRepo-backed implementation, tests use the
 * in-memory fake in `testing/fakes.ts`.
 */
import { z } from "zod";
import type { ToolDefinition } from "@shopmanagerai/shared";
import { defineTool, ok, fail } from "@shopmanagerai/tool-registry";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import { MEMORY_SERVICE_KEY, MEMORY_TYPES, type MemoryService } from "../services.js";

const MAX_CONTENT_BYTES = 32 * 1024;

const MemoryTypeSchema = z.enum(MEMORY_TYPES);

function requireMemoryService(ctx: { services: Map<string, unknown> }): MemoryService {
  const svc = ctx.services.get(MEMORY_SERVICE_KEY) as MemoryService | undefined;
  if (!svc) {
    throw new Error("No memory service configured for this shop.");
  }
  return svc;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

const MemoryIndexItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: MemoryTypeSchema,
  version: z.number(),
  updatedAt: z.string(),
});

const MemoryFullSchema = MemoryIndexItemSchema.extend({ content: z.string(), enabled: z.boolean(), createdBy: z.string(), createdAt: z.string() });

/**
 * The long-form guidance ported from the original Pro plugin’s `the original save-memory ability`
 * `annotations.instructions`, adapted from WordPress abilities to
 * ShopManager AI tools and from post-type storage to this shop's own
 * MemoryRepo. Surfaced as both the tool description and `docs.limitations`
 * so it reaches an agent whether it reads the schema or the discovery index.
 */
const MEMORY_INSTRUCTIONS = `You have a persistent, database-backed memory system scoped to this store. Build it up over time so future conversations can start with a complete picture of who the user is, how they collaborate with you, what to avoid or repeat, and the context behind the work.

If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, call commerce.memory.delete.

## Types of memory
- user, Role, goals, responsibilities, knowledge, preferences. Save when you learn details about who the user is. Avoid negative judgments.
- feedback, Guidance the user has given about how to approach work. Save from BOTH correction ("no, not that") AND confirmation ("yes exactly", accepting an unusual choice without pushback). Structure: rule, then **Why:** and **How to apply:** lines.
- project, Ongoing work, goals, bugs, decisions that aren't derivable from the store or its history. Convert relative dates to absolute dates before saving.
- reference, Pointers to where information lives in external systems (a Linear project, a dashboard).
- design, A block/section subtree in this store's own design vocabulary: what a pricing tier, hero, or testimonial set on this store is actually made of. Kept per store rather than shipped as a generic template.

## What NOT to save
- Theme code, product data, or credentials, read those live from the store; a memory is not a cache and can go stale in a way that misleads instead of helps.
- Anything derivable from the live store (current inventory, current theme files, current settings).
- Debugging solutions or fix recipes, the fix is in the code; there is no commit history to point to here, so restate the reasoning inline instead of citing one.
- Ephemeral task state: in-progress work, current conversation context.

## How to save
1. Check the memory index (either from discover-tools or by calling commerce.memory.list) first, prefer UPDATING (pass id) over creating duplicates.
2. Call commerce.memory.save with name, description (a specific one-line hook. This is how future-you decides relevance), type, and content.
3. Organize memories semantically by topic, not chronologically.
4. If a memory turns out to be wrong or outdated, update or delete it, don't accumulate stale entries.`;

export const memoryListTool: ToolDefinition = defineTool({
  name: "commerce.memory.list",
  description: "Returns the concise memory index (id, name, description, type, version, updatedAt) for every stored memory, optionally filtered by type.",
  tier: "free",
  category: "memory",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ type: MemoryTypeSchema.optional() }),
  outputSchema: z.object({ memories: z.array(MemoryIndexItemSchema), total: z.number() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["memory index"], writes: [], stores: [], returnsToClient: ["memory index"] },
  docs: {
    examples: [{ title: "List all memories", input: {} }, { title: "List only feedback memories", input: { type: "feedback" } }],
    failureModes: [],
    limitations: ["The memory index is also automatically prepended to discover-tools instructions; you typically do not need to call this if you can read it from there."],
  },
  handler: async (ctx, input) => {
    const svc = requireMemoryService(ctx);
    const memories = await svc.list(ctx.shop.shopId, input.type);
    return ok({ operationId: ctx.operationId }, memoryListTool, {
      summary: `${memories.length} memor${memories.length === 1 ? "y" : "ies"}`,
      data: {
        memories: memories.map((m) => ({ id: m.id, name: m.name, description: m.description, type: m.type, version: m.version, updatedAt: m.updatedAt })),
        total: memories.length,
      },
    });
  },
});

export const memoryGetTool: ToolDefinition = defineTool({
  name: "commerce.memory.get",
  description: "Returns the full content of a single memory by id or name.",
  tier: "free",
  category: "memory",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ id: z.string().optional(), name: z.string().optional() }).refine((v) => !!v.id || !!v.name, { message: "id or name is required" }),
  outputSchema: z.object({ memory: MemoryFullSchema.nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["memory content"], writes: [], stores: [], returnsToClient: ["memory content"] },
  docs: {
    examples: [{ title: "Get a memory by id", input: { id: "mem_123" } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "No memory with that id/name." }],
    limitations: ["Call after reading the memory index; feedback/project memories typically include **Why:** and **How to apply:** lines you should respect."],
  },
  handler: async (ctx, input) => {
    const svc = requireMemoryService(ctx);
    const memory = await svc.get(ctx.shop.shopId, input.id ?? input.name!);
    if (!memory) {
      return fail({ operationId: ctx.operationId }, memoryGetTool, { code: "NOT_FOUND", message: `No memory "${input.id ?? input.name}".`, retryable: false });
    }
    return ok({ operationId: ctx.operationId }, memoryGetTool, {
      summary: `Memory "${memory.name}"`,
      data: { memory: { id: memory.id, name: memory.name, description: memory.description, type: memory.type, content: memory.content, version: memory.version, enabled: memory.enabled, createdBy: memory.createdBy, createdAt: memory.createdAt, updatedAt: memory.updatedAt } },
    });
  },
});

export const memorySaveTool: ToolDefinition = defineTool({
  name: "commerce.memory.save",
  description: `Creates a new memory or updates an existing one. ${MEMORY_INSTRUCTIONS}`,
  tier: "free",
  category: "memory",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().min(1),
    type: MemoryTypeSchema,
    content: z.string().min(1).max(MAX_CONTENT_BYTES),
  }),
  outputSchema: z.object({ memory: MemoryFullSchema }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: ["memory"], stores: ["memory content"], returnsToClient: ["saved memory"] },
  docs: {
    examples: [{ title: "Save a feedback memory", input: { name: "Prefer terse commits", description: "How the user wants commit messages written", type: "feedback", content: "Keep commit subjects under 50 chars.\n\n**Why:** the user asked twice.\n**How to apply:** every commit this repo." } }],
    failureModes: [{ code: "INVALID_INPUT", meaning: "content exceeds 32KB." }],
    limitations: ["content is stored as plain text; any HTML markup is stripped.", "Never store theme code, product data, or credentials in memory."],
  },
  handler: async (ctx, input) => {
    if (Buffer.byteLength(input.content, "utf8") > MAX_CONTENT_BYTES) {
      return fail({ operationId: ctx.operationId }, memorySaveTool, { code: "INVALID_INPUT", message: `Memory content exceeds ${MAX_CONTENT_BYTES} bytes.`, retryable: false });
    }
    const svc = requireMemoryService(ctx);
    const created = !input.id;
    const memory = await svc.save(ctx.shop.shopId, {
      id: input.id,
      name: input.name,
      description: input.description,
      type: input.type,
      content: stripHtml(input.content),
      createdBy: ctx.credential.label,
    });
    return ok({ operationId: ctx.operationId }, memorySaveTool, {
      summary: `${created ? "Created" : "Updated"} memory "${memory.name}" (v${memory.version})`,
      data: { memory: { id: memory.id, name: memory.name, description: memory.description, type: memory.type, content: memory.content, version: memory.version, enabled: memory.enabled, createdBy: memory.createdBy, createdAt: memory.createdAt, updatedAt: memory.updatedAt } },
      changes: [{ resource: `memory:${memory.id}`, kind: created ? "create" : "update", after: { name: memory.name, type: memory.type, version: memory.version } }],
    });
  },
});

export const memoryDeleteTool: ToolDefinition = defineTool({
  name: "commerce.memory.delete",
  description: "Permanently deletes a memory (and its version history). Use when a memory is wrong, outdated, or the user asks you to forget it. Requires confirm:true.",
  tier: "free",
  category: "memory",
  riskClass: "destructive",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ id: z.string(), confirm: z.boolean().optional() }),
  outputSchema: z.object({ deleted: z.boolean() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: [], writes: [], stores: [], returnsToClient: ["delete result"] },
  docs: {
    examples: [{ title: "Delete a memory", input: { id: "mem_123", confirm: true } }],
    failureModes: [{ code: "CONFIRM_REQUIRED", meaning: "confirm:true was not supplied." }, { code: "NOT_FOUND", meaning: "No memory with that id." }],
    limitations: ["Permanent; no rollback. Prefer updating (commerce.memory.save with id) over delete+recreate when the topic still applies but details changed."],
  },
  handler: async (ctx, input) => {
    if (input.confirm !== true) {
      return fail({ operationId: ctx.operationId }, memoryDeleteTool, { code: "CONFIRM_REQUIRED", message: "commerce.memory.delete requires confirm: true.", retryable: false });
    }
    const svc = requireMemoryService(ctx);
    const deleted = await svc.delete(ctx.shop.shopId, input.id);
    if (!deleted) {
      return fail({ operationId: ctx.operationId }, memoryDeleteTool, { code: "NOT_FOUND", message: `No memory "${input.id}".`, retryable: false });
    }
    return ok({ operationId: ctx.operationId }, memoryDeleteTool, {
      summary: `Deleted memory "${input.id}"`,
      data: { deleted: true },
      changes: [{ resource: `memory:${input.id}`, kind: "delete" }],
    });
  },
});

const MemoryVersionItemSchema = z.object({ version: z.number(), name: z.string(), description: z.string(), type: z.string(), content: z.string(), savedBy: z.string(), savedAt: z.string() });

export const memoryVersionsTool: ToolDefinition = defineTool({
  name: "commerce.memory.versions",
  description: "Lists the version history of a memory, newest first (up to the last 50 saves).",
  tier: "free",
  category: "memory",
  riskClass: "read",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ versions: z.array(MemoryVersionItemSchema) }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["memory version history"], writes: [], stores: [], returnsToClient: ["version history"] },
  docs: { examples: [{ title: "List versions", input: { id: "mem_123" } }], failureModes: [], limitations: ["Only the most recent 50 versions are retained."] },
  handler: async (ctx, input) => {
    const svc = requireMemoryService(ctx);
    const versions = await svc.versions(ctx.shop.shopId, input.id);
    return ok({ operationId: ctx.operationId }, memoryVersionsTool, {
      summary: `${versions.length} version(s)`,
      data: { versions },
    });
  },
});

export const memoryRestoreTool: ToolDefinition = defineTool({
  name: "commerce.memory.restore",
  description: "Restores a memory to a past version (recorded as a new version, a \"reroll\" rather than a rewind).",
  tier: "free",
  category: "memory",
  riskClass: "write",
  executionPlane: "server",
  requiredEntitlements: [],
  requiredShopifyScopes: [],
  requiredStoreCapabilities: [],
  inputSchema: z.object({ id: z.string(), version: z.number().int().positive() }),
  outputSchema: z.object({ memory: MemoryFullSchema.nullable() }),
  supportsDryRun: false,
  rollback: "none",
  taskMode: "sync",
  approval: "none",
  dataCategories: { reads: ["memory version history"], writes: ["memory"], stores: ["memory content"], returnsToClient: ["restored memory"] },
  docs: {
    examples: [{ title: "Restore version 2", input: { id: "mem_123", version: 2 } }],
    failureModes: [{ code: "NOT_FOUND", meaning: "No memory, or no such version, exists." }],
    limitations: [],
  },
  handler: async (ctx, input) => {
    const svc = requireMemoryService(ctx);
    const memory = await svc.restore(ctx.shop.shopId, input.id, input.version, ctx.credential.label);
    if (!memory) {
      return fail({ operationId: ctx.operationId }, memoryRestoreTool, { code: "NOT_FOUND", message: `No memory "${input.id}" version ${input.version}.`, retryable: false });
    }
    return ok({ operationId: ctx.operationId }, memoryRestoreTool, {
      summary: `Restored memory "${memory.name}" to version ${input.version} (now v${memory.version})`,
      data: { memory: { id: memory.id, name: memory.name, description: memory.description, type: memory.type, content: memory.content, version: memory.version, enabled: memory.enabled, createdBy: memory.createdBy, createdAt: memory.createdAt, updatedAt: memory.updatedAt } },
      changes: [{ resource: `memory:${memory.id}`, kind: "update", after: { version: memory.version, restoredFrom: input.version } }],
    });
  },
});

export function registerMemoryTools(registry: ToolRegistry): void {
  registry.register(memoryListTool);
  registry.register(memoryGetTool);
  registry.register(memorySaveTool);
  registry.register(memoryDeleteTool);
  registry.register(memoryVersionsTool);
  registry.register(memoryRestoreTool);
}

export { MEMORY_INSTRUCTIONS };
