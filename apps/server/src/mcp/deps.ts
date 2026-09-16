/**
 * @shopmanagerai/mcp-protocol host deps: listTools/callTool/listResources/
 * readResource/listPrompts/getPrompt, wired to the tool registry, policy
 * pipeline, and (fallback or real) skills/resources from @shopmanagerai/tools.
 */
import { z } from "zod";
import { toMcpJsonSchema } from "@shopmanagerai/tool-registry";
import { ShopManagerAIError, ERROR_CODES, PRODUCT_VERSION, manifestSummaryForInstructions, type ToolResult } from "@shopmanagerai/shared";
import { defaultInstructions, type McpHandlerDeps, type RawHeaders, type RequestClientInfo, type ToolDescriptor } from "@shopmanagerai/mcp-protocol";
import { DiscoverToolsInput, GetSchemaInput, ExecuteToolInput, computeCards, listForMcp, type AvailabilityContext } from "@shopmanagerai/tool-registry";
import type { Container } from "../container.js";
import { loadToolsPackage } from "../tools-boundary.js";
import { buildToolContext, executeTool, type McpRequestCtx } from "./execute.js";
import { newId } from "@shopmanagerai/shared";

const CONNECTIONS_FLUSH_INTERVAL_MS = 10_000;
const SESSION_CLIENT_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MEMORY_INDEX_ENTRIES = 40;

function sessionClientKvKey(sessionId: string): string {
  return `mcp_session_client:${sessionId}`;
}

function headerValue(headers: RawHeaders, name: string): string {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
  }
  return "";
}

// A single process-wide `beforeExit` listener flushes every accumulator ever
// created (one per container, e.g. one per test suite), rather than each
// `createConnectionsRecorder` call registering its own listener and tripping
// Node's MaxListenersExceededWarning across a test run that builds many
// containers.
const pendingFlushers = new Set<() => Promise<void>>();
let exitFlusherRegistered = false;
function registerExitFlusher(flush: () => Promise<void>): void {
  pendingFlushers.add(flush);
  if (exitFlusherRegistered) return;
  exitFlusherRegistered = true;
  process.on("beforeExit", () => {
    for (const f of pendingFlushers) void f();
  });
}

interface PendingConnection {
  shopId: string;
  credentialId: string;
  credentialLabel: string;
  kind: "token" | "oauth" | "admin_ui";
  clientName: string;
  clientVersion: string;
  protocolVersion: string;
  count: number;
}

/**
 * Builds the in-memory, throttled accumulator that records connection
 * telemetry (the original WordPress plugin `includes/connections.php` port) into
 * `container.connections`, flushing at most every
 * `CONNECTIONS_FLUSH_INTERVAL_MS` (and once more on process exit) rather than
 * writing to sqlite on every single MCP request.
 */
function createConnectionsRecorder(container: Container) {
  const pending = new Map<string, PendingConnection>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  async function flush(): Promise<void> {
    const items = Array.from(pending.values());
    pending.clear();
    for (const item of items) {
      try {
        for (let i = 0; i < item.count; i++) {
          await container.connections.record({
            shopId: item.shopId,
            credentialId: item.credentialId,
            credentialLabel: item.credentialLabel,
            kind: item.kind,
            clientName: item.clientName,
            clientVersion: item.clientVersion,
            protocolVersion: item.protocolVersion,
          });
        }
      } catch (e) {
        container.log.warn("connections: failed to flush recorded request(s)", { message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush();
    }, CONNECTIONS_FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }

  registerExitFlusher(flush);

  function record(input: { shopId: string; credentialId: string; credentialLabel: string; kind: "token" | "oauth" | "admin_ui"; clientName: string; clientVersion: string; protocolVersion: string }): void {
    const key = `${input.credentialId}|${input.clientName.toLowerCase()}`;
    const existing = pending.get(key);
    if (existing) {
      existing.count += 1;
      existing.credentialLabel = input.credentialLabel;
      if (input.clientName) existing.clientName = input.clientName;
      if (input.clientVersion) existing.clientVersion = input.clientVersion;
      if (input.protocolVersion) existing.protocolVersion = input.protocolVersion;
    } else {
      pending.set(key, { ...input, count: 1 });
    }
    scheduleFlush();
  }

  return { record };
}

/** Maps a credential's kind onto the narrower set `ConnectionRepo.record` accepts. */
function connectionKindOf(kind: string): "token" | "oauth" | "admin_ui" {
  return kind === "oauth" || kind === "admin_ui" ? kind : "token";
}

/**
 * Builds this shop's memory index lines ("[type] name, description"), or
 * `null` when memory is disabled (per shop settings_json `memory.enabled`,
 * default true) or empty. Shared between `discover-tools` and `server/discover`.
 */
async function buildMemoryIndexLines(container: Container, shopId: string): Promise<string[] | null> {
  const shop = await container.shops.getById(shopId);
  const settings = shop?.settings as { memory?: { enabled?: boolean } } | null | undefined;
  if (settings?.memory?.enabled === false) return null;
  const rows = await container.memory.list(shopId);
  if (rows.length === 0) return null;
  const lines = rows.slice(0, MAX_MEMORY_INDEX_ENTRIES).map((r) => `[${r.type}] ${r.name}, ${r.description}`);
  lines.push("Call commerce.memory.get for full content.");
  return lines;
}

function availabilityContextFor(ctx: McpRequestCtx, apiVersion: string): AvailabilityContext {
  const policy: Record<string, boolean | number | string> = { ...ctx.credential.policy };
  return {
    tier: ctx.tier,
    entitlements: ctx.entitlements,
    profile: ctx.credential.profile,
    scopesGranted: new Set(ctx.credential.scopesGranted),
    capabilities: ctx.planes.capabilities,
    storeFacts: { plan: ctx.shop.plan ?? undefined, apiVersion, distribution: "custom" },
    policy,
  };
}

function modeOf(surfaceQuery: string | undefined): "meta" | "flat" {
  return surfaceQuery === "flat" ? "flat" : "meta";
}

export function makeMcpDeps(container: Container, surfaceOf: (ctx: McpRequestCtx) => "meta" | "flat"): McpHandlerDeps<McpRequestCtx> {
  const connectionsRecorder = createConnectionsRecorder(container);

  return {
    descriptor: { version: PRODUCT_VERSION },

    listTools(ctx: McpRequestCtx): ToolDescriptor[] {
      const mode = surfaceOf(ctx);
      const availCtx = availabilityContextFor(ctx, container.apiVersion.current());
      return listForMcp(container.registry, availCtx, mode) as unknown as ToolDescriptor[];
    },

    // "meta" mode always returns the same three tool names, so the tier and
    // entitlement set must be folded into the list identity separately , 
    // otherwise a FREE -> PRO_ACTIVE transition would not flip the hash even
    // though the tools a client can actually call has changed.
    listIdentitySeed(ctx: McpRequestCtx): string {
      return `${ctx.tier}:${[...ctx.entitlements].sort().join(",")}`;
    },

    async callTool(ctx: McpRequestCtx, name: string, args: Record<string, unknown>): Promise<ToolResult> {
      if (name === "discover-tools") {
        const parsed = DiscoverToolsInput.safeParse(args);
        if (!parsed.success) return invalidInput(name, parsed.error);
        const availCtx = availabilityContextFor(ctx, container.apiVersion.current());
        let cards = computeCards(container.registry, availCtx);
        if (parsed.data.category) cards = cards.filter((c) => c.category === parsed.data.category);
        if (parsed.data.tier) cards = cards.filter((c) => c.tier === parsed.data.tier);
        if (parsed.data.query) {
          const q = parsed.data.query.toLowerCase();
          cards = cards.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
        }
        const memoryIndex = await buildMemoryIndexLines(container, ctx.shop.shopId);
        return ok(name, { cards, ...(memoryIndex ? { memoryIndex } : {}) });
      }

      if (name === "get-schema") {
        const parsed = GetSchemaInput.safeParse(args);
        if (!parsed.success) return invalidInput(name, parsed.error);
        const def = container.registry.get(parsed.data.name);
        if (!def) return notFound(name, `Unknown tool "${parsed.data.name}".`);
        return ok(name, {
          name: def.name,
          description: def.description,
          inputSchema: toMcpJsonSchema(def.inputSchema),
          outputSchema: toMcpJsonSchema(def.outputSchema),
          examples: def.docs.examples,
          failureModes: def.docs.failureModes,
          limitations: def.docs.limitations,
          riskClass: def.riskClass,
          riskLevel: def.riskLevel,
          tier: def.tier,
          requiredShopifyScopes: def.requiredShopifyScopes,
          optionalShopifyScopes: def.optionalShopifyScopes ?? [],
          protectedCustomerData: def.protectedCustomerData ?? false,
          planRequirement: def.planRequirement ?? null,
          supportsDryRun: def.supportsDryRun,
          rollback: def.rollback,
          approval: def.approval,
          aliases: def.aliases ?? [],
        });
      }

      if (name === "execute-tool") {
        const parsed = ExecuteToolInput.safeParse(args);
        if (!parsed.success) return invalidInput(name, parsed.error);
        return executeTool(container, ctx, parsed.data.name, parsed.data.input);
      }

      // Flat mode: the name itself is a tool name.
      return executeTool(container, ctx, name, args);
    },

    async listResources(ctx: McpRequestCtx) {
      const api = await loadToolsPackage();
      const toolCtx = buildToolContext(container, ctx, newId("op"));
      return api.listResources(toolCtx);
    },

    async readResource(ctx: McpRequestCtx, uri: string) {
      const api = await loadToolsPackage();
      const toolCtx = buildToolContext(container, ctx, newId("op"));
      const res = await api.readResource(toolCtx, uri);
      return Array.isArray(res) ? res : [res];
    },

    async listPrompts(ctx: McpRequestCtx) {
      const merged = await mergedSkillsFor(container, ctx.shop.shopId);
      return merged.filter((s) => s.enabled).map((s) => ({ name: s.name, title: s.title, description: s.description, arguments: [] }));
    },

    async getPrompt(ctx: McpRequestCtx, name: string) {
      const merged = await mergedSkillsFor(container, ctx.shop.shopId);
      const skill = merged.find((s) => s.name === name && s.enabled);
      if (!skill) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, `Unknown prompt "${name}".`);
      return { description: skill.description, messages: [{ role: "user", content: { type: "text", text: skill.body } }] };
    },

    async instructionsFor(ctx: McpRequestCtx): Promise<string | undefined> {
      const [memoryIndex, activeDesign] = await Promise.all([
        buildMemoryIndexLines(container, ctx.shop.shopId),
        container.designManifestService.getActive(ctx.shop.shopId).catch(() => null),
      ]);
      if (!memoryIndex && !activeDesign) return undefined;
      const parts = [defaultInstructions()];
      // The active design goes in so a model reaches for the real palette and type
      // instead of the statistical average. Fenced and labelled as untrusted data.
      if (activeDesign) parts.push(manifestSummaryForInstructions(activeDesign.name, activeDesign.manifest));
      if (memoryIndex) parts.push(`Memory index:\n${memoryIndex.join("\n")}`);
      return parts.join("\n\n");
    },

    /**
     * Records connection telemetry (the original WordPress plugin `includes/connections.php` port):
     * client info sources, in priority order, are the modern per-request
     * `_meta` clientInfo, a legacy `initialize` clientInfo remembered in kv
     * for the session (24h TTL) and applied to later calls on that session,
     * and finally a User-Agent sniff. Writes are throttled in-memory (see
     * `createConnectionsRecorder`), never inline on the request path.
     */
    async onRequest(
      ctx: McpRequestCtx,
      info: { method: string; protocolVersion: string; clientInfo?: RequestClientInfo; sessionId?: string; headers: RawHeaders },
    ): Promise<void> {
      let clientInfo = info.clientInfo;

      if (info.clientInfo && info.sessionId) {
        await container.kv.set(sessionClientKvKey(info.sessionId), { name: info.clientInfo.name, version: info.clientInfo.version ?? "", savedAt: new Date().toISOString() });
      } else if (!clientInfo && info.sessionId) {
        const remembered = await container.kv.get<{ name: string; version: string; savedAt: string }>(sessionClientKvKey(info.sessionId));
        if (remembered && Date.now() - Date.parse(remembered.savedAt) < SESSION_CLIENT_INFO_TTL_MS) {
          clientInfo = { name: remembered.name, version: remembered.version || undefined };
        }
      }

      let clientName = clientInfo?.name ?? "";
      const clientVersion = clientInfo?.version ?? "";
      if (!clientName) clientName = headerValue(info.headers, "user-agent");

      connectionsRecorder.record({
        shopId: ctx.shop.shopId,
        credentialId: ctx.credential.credentialId,
        credentialLabel: ctx.credential.label,
        kind: connectionKindOf(ctx.credential.kind),
        clientName,
        clientVersion,
        protocolVersion: info.protocolVersion,
      });
    },

    log: container.log,
  };
}

export { modeOf };

interface MergedSkill {
  name: string;
  title: string;
  description: string;
  tier: string;
  body: string;
  source: "builtin" | "custom";
  enabled: boolean;
}

/**
 * Merges the server's built-in file skills (container.skills, loaded at
 * startup from <repo>/skills) with this shop's DB-stored skills
 * (container.skillRepo): a DB entry with the same name overrides the
 * built-in one (title/description/body/enabled all come from the DB row);
 * disabled skills are excluded entirely from both listPrompts and getPrompt.
 */
async function mergedSkillsFor(container: Container, shopId: string): Promise<MergedSkill[]> {
  const builtins: MergedSkill[] = container.skills.map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    tier: s.tier,
    body: (s as { body?: string }).body ?? s.description,
    source: "builtin",
    enabled: true,
  }));
  const custom = await container.skillRepo.list(shopId);
  const byName = new Map(builtins.map((s) => [s.name, s]));
  for (const row of custom) {
    byName.set(row.name, { name: row.name, title: row.title, description: row.description, tier: row.tier, body: row.body, source: row.source, enabled: row.enabled });
  }
  return Array.from(byName.values());
}

function ok(tool: string, data: unknown): ToolResult {
  return {
    ok: true,
    operationId: `meta_${Date.now()}`,
    tool,
    summary: `${tool} ok`,
    risk: "read",
    data,
    changes: [],
    evidence: [],
    warnings: [],
    errors: [],
    nextActions: [],
    rollback: { available: false, strategy: "none" },
  };
}

function invalidInput(tool: string, error: z.ZodError): ToolResult {
  return {
    ok: false,
    tool,
    code: ERROR_CODES.INVALID_INPUT,
    message: "Input failed schema validation.",
    retryable: false,
    risk: "read",
    suggestedActions: [],
    details: { issues: error.issues },
  };
}

function notFound(tool: string, message: string): ToolResult {
  return {
    ok: false,
    tool,
    code: ERROR_CODES.TOOL_NOT_FOUND,
    message,
    retryable: false,
    risk: "read",
    suggestedActions: [],
  };
}
