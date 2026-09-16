/**
 * Transport-agnostic dual-era MCP request handler.
 *
 * Port of the original plugin’s `includes/mcp/transport.php`, generalized: the original WordPress plugin
 * splits legacy handling off to a vendored WordPress adapter and only
 * intercepts modern requests here; this package owns both eras itself (per
 * `docs/CURRENT_MCP_RESEARCH.md` §7. No dependency on an SDK whose
 * Streamable-HTTP server may not implement the stateless modern path yet).
 *
 * `createMcpHandler` takes host-supplied callbacks (list/call tools,
 * resources, prompts) and returns a single `handle()` function that never
 * throws, every failure mode, including an unexpected exception from a
 * callback, is turned into a JSON-RPC error response. No dependency on
 * Hono, Express, or any other transport library: the caller adapts
 * `handle()`'s plain-object input/output to whatever HTTP framework it
 * uses.
 */
import { newId, redactString, type Logger, type ToolResult } from "@shopmanagerai/shared";
import { META_LIST_IDENTITY, listIdentity } from "./cache.js";
import { buildDiscoverResult, type ServerDescriptor } from "./discover.js";
import type { RawHeaders } from "./headers.js";
import { normalizeHeaders, validateModernHeaders } from "./headers.js";
import {
  errorResponse,
  isJsonRpcRequest,
  JSONRPC_ERROR_CODES,
  parseRequestBody,
  successResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./jsonrpc.js";
import {
  bodyProtocolVersion,
  declaresClientCapabilities,
  HEADER_SESSION_ID,
  isModernRequest,
  isRemovedInModern,
  legacyInitializeClientInfo,
  META_CLIENT_CAPABILITIES,
  requestClientInfo,
  SUPPORTED_VERSIONS,
  VERSION_LEGACY,
  VERSION_MODERN,
  type RequestClientInfo,
} from "./protocol.js";
import { buildToolCallResult, type McpServerInfo } from "./results.js";
import { BRAND } from "@shopmanagerai/shared";

export type McpEra = "modern" | "legacy";

export interface ToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

export interface PromptArgumentDescriptor {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptDescriptor {
  name: string;
  title?: string;
  description: string;
  arguments: PromptArgumentDescriptor[];
}

export interface PromptMessage {
  role: string;
  content: unknown;
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/**
 * Host-supplied dependencies. Every method callback receives the
 * caller-supplied `TCtx` (credential, shop, execution planes, see
 * `@shopmanagerai/shared`'s `ToolContext`, or a test fake) so this package
 * never depends on a concrete context shape.
 */
export interface McpHandlerDeps<TCtx> {
  descriptor: ServerDescriptor;
  listTools(ctx: TCtx): Promise<ToolDescriptor[]> | ToolDescriptor[];
  callTool(ctx: TCtx, name: string, args: Record<string, unknown>): Promise<ToolResult>;
  listResources?(ctx: TCtx): Promise<ResourceDescriptor[]> | ResourceDescriptor[];
  readResource?(ctx: TCtx, uri: string): Promise<ResourceContent[]> | ResourceContent[];
  listPrompts?(ctx: TCtx): Promise<PromptDescriptor[]> | PromptDescriptor[];
  getPrompt?(ctx: TCtx, name: string, args: Record<string, unknown>): Promise<PromptResult>;
  log?: Logger;
  /**
   * Extra fingerprint folded into the `tools/list` identity hash alongside
   * the tool names. Needed because "meta" surfaces always return the same
   * three tool names regardless of entitlement, without this, an
   * entitlement change (e.g. FREE -> PRO_ACTIVE) would not flip the list
   * identity even though a client's understanding of what is callable has
   * changed underneath it.
   */
  listIdentitySeed?(ctx: TCtx): string;
  /**
   * Per-request override for `server/discover`'s `instructions` field (e.g.
   * appending a memory index). Falls back to `descriptor.instructions` (and
   * ultimately the package default) when absent or when it returns undefined.
   */
  instructionsFor?(ctx: TCtx): Promise<string | undefined> | string | undefined;
  /**
   * Fired once per JSON-RPC request (each item of a batch counts separately),
   * before routing, so the host can record connection telemetry (the original WordPress plugin
   * `includes/connections.php` port) without this package knowing anything
   * about credentials or storage. Never throws into the caller, a rejected
   * promise or synchronous exception is caught and logged, not surfaced as a
   * request failure.
   */
  onRequest?(
    ctx: TCtx,
    info: { method: string; protocolVersion: string; clientInfo?: RequestClientInfo; sessionId?: string; headers: RawHeaders },
  ): Promise<void> | void;
}

export interface HandlerInput<TCtx> {
  method: "POST" | "GET" | "DELETE";
  headers: RawHeaders;
  body: unknown;
  ctx: TCtx;
}

export interface HandlerOutput {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const CONTENT_TYPE_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Legacy `initialize` also negotiates these revisions by name, though they are not advertised. */
const EXTRA_NEGOTIABLE_LEGACY_VERSIONS = ["2025-06-18", "2024-11-05"];

function serverInfoOf(descriptor: ServerDescriptor): McpServerInfo {
  return { name: descriptor.name ?? BRAND.name, version: descriptor.version };
}

function negotiateLegacyVersion(requested: string): string {
  if (requested !== "" && ((SUPPORTED_VERSIONS as readonly string[]).includes(requested) || EXTRA_NEGOTIABLE_LEGACY_VERSIONS.includes(requested))) {
    return requested;
  }
  return VERSION_LEGACY;
}

function paramsOf(request: JsonRpcRequest): Record<string, unknown> {
  return request.params && typeof request.params === "object" && !Array.isArray(request.params) ? request.params : {};
}

/** Best-effort fire of `deps.onRequest`: never lets a host callback failure affect the response. */
async function fireOnRequest<TCtx>(
  deps: McpHandlerDeps<TCtx>,
  ctx: TCtx,
  info: { method: string; protocolVersion: string; clientInfo?: RequestClientInfo; sessionId?: string; headers: RawHeaders },
): Promise<void> {
  if (!deps.onRequest) return;
  try {
    await deps.onRequest(ctx, info);
  } catch (e) {
    deps.log?.error("mcp-protocol: onRequest hook threw", { message: e instanceof Error ? e.message : String(e) });
  }
}

/** Route the methods shared by both eras: tools, resources, prompts, discovery. */
async function routeSharedMethod<TCtx>(
  deps: McpHandlerDeps<TCtx>,
  ctx: TCtx,
  method: string,
  request: JsonRpcRequest,
  era: McpEra,
): Promise<{ status: number; response: JsonRpcResponse }> {
  const id = (request.id ?? null) as JsonRpcId;
  const params = paramsOf(request);

  switch (method) {
    case "server/discover": {
      const override = await deps.instructionsFor?.(ctx);
      const result = buildDiscoverResult(override !== undefined ? { ...deps.descriptor, instructions: override } : deps.descriptor);
      return { status: 200, response: successResponse(id, result) };
    }

    case "tools/list": {
      const tools = await deps.listTools(ctx);
      const result: Record<string, unknown> = { tools };
      if (era === "modern") {
        const seed = deps.listIdentitySeed?.(ctx);
        const parts = tools.map((t) => t.name);
        if (seed) parts.push(seed);
        result["_meta"] = { [META_LIST_IDENTITY]: listIdentity(parts) };
      }
      return { status: 200, response: successResponse(id, result) };
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (name === "") {
        return { status: 200, response: errorResponse(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, "params.name is required.") };
      }
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      const toolResult = await deps.callTool(ctx, name, args);
      const built = buildToolCallResult(toolResult, {
        era,
        serverInfo: serverInfoOf(deps.descriptor),
        request: era === "modern" ? request : undefined,
      });
      return { status: 200, response: successResponse(id, built) };
    }

    case "resources/list": {
      const resources = deps.listResources ? await deps.listResources(ctx) : [];
      const result: Record<string, unknown> = { resources };
      if (era === "modern") {
        result["_meta"] = { [META_LIST_IDENTITY]: listIdentity(resources.map((r) => r.uri)) };
      }
      return { status: 200, response: successResponse(id, result) };
    }

    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      if (uri === "" || !deps.readResource) {
        // The modern revision moved not-found onto -32602; legacy kept -32002.
        return { status: 200, response: errorResponse(id, era === "modern" ? JSONRPC_ERROR_CODES.INVALID_PARAMS : -32002, `Unknown resource: ${uri}`) };
      }
      const contents = await deps.readResource(ctx, uri);
      return { status: 200, response: successResponse(id, { contents }) };
    }

    case "prompts/list": {
      const prompts = deps.listPrompts ? await deps.listPrompts(ctx) : [];
      const result: Record<string, unknown> = { prompts };
      if (era === "modern") {
        result["_meta"] = { [META_LIST_IDENTITY]: listIdentity(prompts.map((p) => p.name)) };
      }
      return { status: 200, response: successResponse(id, result) };
    }

    case "prompts/get": {
      const name = typeof params.name === "string" ? params.name : "";
      if (name === "" || !deps.getPrompt) {
        return { status: 200, response: errorResponse(id, era === "modern" ? JSONRPC_ERROR_CODES.INVALID_PARAMS : -32002, `Unknown prompt: ${name}`) };
      }
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      const prompt = await deps.getPrompt(ctx, name, args);
      return { status: 200, response: successResponse(id, prompt) };
    }

    default:
      return { status: 404, response: errorResponse(id, JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`) };
  }
}

interface DispatchOutcome {
  status: number;
  headers: Record<string, string>;
  response: JsonRpcResponse | undefined;
}

/** Classify, validate, and route exactly one JSON-RPC request. */
async function dispatchOne<TCtx>(
  deps: McpHandlerDeps<TCtx>,
  ctx: TCtx,
  request: JsonRpcRequest,
  rawHeaders: RawHeaders,
  enforceHeaders: boolean,
): Promise<DispatchOutcome> {
  const id = (request.id ?? null) as JsonRpcId;
  const method = request.method;
  const modern = isModernRequest(request);

  if (modern) {
    if (enforceHeaders) {
      const headerError = validateModernHeaders(rawHeaders, request);
      if (headerError) return { status: headerError.status, headers: {}, response: headerError.body };
    }

    // A method the modern revision removed must not quietly work, or a
    // client would believe it had set a log level or kept a session alive
    // when it had not.
    if (isRemovedInModern(method)) {
      return {
        status: 404,
        headers: {},
        response: errorResponse(id, JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}. It was removed in ${VERSION_MODERN}.`),
      };
    }

    // The revision requires both _meta fields on every request. An empty
    // capabilities object is a valid declaration; an absent key is not.
    if (!declaresClientCapabilities(request)) {
      return {
        status: 400,
        headers: {},
        response: errorResponse(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, `params._meta.${META_CLIENT_CAPABILITIES} is required on every request.`),
      };
    }

    await fireOnRequest(deps, ctx, { method, protocolVersion: bodyProtocolVersion(request), clientInfo: requestClientInfo(request), headers: rawHeaders });

    const routed = await routeSharedMethod(deps, ctx, method, request, "modern");
    return { status: routed.status, headers: {}, response: routed.response };
  }

  // --- Legacy era ---

  if (method === "initialize") {
    const requestedVersion = typeof paramsOf(request).protocolVersion === "string" ? (paramsOf(request).protocolVersion as string) : "";
    const negotiated = negotiateLegacyVersion(requestedVersion);
    const sessionId = newId("mcpsess");
    await fireOnRequest(deps, ctx, { method, protocolVersion: negotiated, clientInfo: legacyInitializeClientInfo(request), sessionId, headers: rawHeaders });
    const instructionsOverride = await deps.instructionsFor?.(ctx);
    const instructions = instructionsOverride ?? deps.descriptor.instructions;
    const result = {
      protocolVersion: negotiated,
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      serverInfo: serverInfoOf(deps.descriptor),
      ...(instructions ? { instructions } : {}),
    };
    return { status: 200, headers: { "Mcp-Session-Id": sessionId }, response: successResponse(id, result) };
  }

  if (method === "notifications/initialized") {
    // A notification: no JSON-RPC id, no body in the response.
    return { status: 202, headers: {}, response: undefined };
  }

  if (method === "ping") {
    return { status: 200, headers: {}, response: successResponse(id, {}) };
  }

  if (method === "logging/setLevel") {
    // Accepted, no-op: this server emits no notifications/message today.
    return { status: 200, headers: {}, response: successResponse(id, {}) };
  }

  // The session header is not required (this server is stateless) but is
  // echoed back when a client sends one, so a half-migrated client sees its
  // session id survive round trips.
  const echoHeaders: Record<string, string> = {};
  const incomingSession = normalizeHeaders(rawHeaders)[HEADER_SESSION_ID];
  if (incomingSession) echoHeaders["Mcp-Session-Id"] = incomingSession;

  await fireOnRequest(deps, ctx, { method, protocolVersion: "", sessionId: incomingSession || undefined, headers: rawHeaders });

  const routed = await routeSharedMethod(deps, ctx, method, request, "legacy");
  return { status: routed.status, headers: echoHeaders, response: routed.response };
}

/**
 * Create a transport-agnostic MCP request handler.
 *
 * `handle()` never throws: any exception from a host callback (or from
 * malformed input this package failed to anticipate) is caught and turned
 * into a `-32603 Internal error` response whose message is redacted via
 * `@shopmanagerai/shared`'s `redactString`, so a leaked secret in an error
 * message never reaches the client.
 */
export function createMcpHandler<TCtx>(deps: McpHandlerDeps<TCtx>) {
  async function handle(input: HandlerInput<TCtx>): Promise<HandlerOutput> {
    try {
      if (input.method !== "POST") {
        // No SSE, no session lifecycle in this transport: GET and DELETE are
        // both unsupported. 405 names the one method this server accepts.
        return {
          status: 405,
          headers: { ...CONTENT_TYPE_HEADERS, Allow: "POST" },
          body: errorResponse(null, JSONRPC_ERROR_CODES.INVALID_REQUEST, "Method not allowed. This server only accepts POST."),
        };
      }

      const parsed = parseRequestBody(input.body);

      if (parsed.kind === "invalid") {
        return { status: 400, headers: CONTENT_TYPE_HEADERS, body: parsed.error };
      }

      if (parsed.kind === "batch") {
        const responses: JsonRpcResponse[] = [];
        for (const item of parsed.requests) {
          if (!isJsonRpcRequest(item)) {
            responses.push(errorResponse(null, JSONRPC_ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC request in batch."));
            continue;
          }
          const itemId = (item.id ?? null) as JsonRpcId;
          const isNotification = (item.id === undefined || item.id === null) && item.method.startsWith("notifications/");
          // Per-item header mirroring does not apply inside a batch (the
          // Mcp-Method/Mcp-Name headers describe the single outer HTTP
          // request); each item's era and routing is still evaluated on its
          // own body.
          const outcome = await dispatchOne(deps, input.ctx, item, input.headers, false);
          if (!isNotification) {
            responses.push(outcome.response ?? errorResponse(itemId, JSONRPC_ERROR_CODES.INTERNAL_ERROR, "No response produced."));
          }
        }
        return { status: 200, headers: CONTENT_TYPE_HEADERS, body: responses };
      }

      const outcome = await dispatchOne(deps, input.ctx, parsed.request, input.headers, true);
      return {
        status: outcome.status,
        headers: { ...CONTENT_TYPE_HEADERS, ...outcome.headers },
        body: outcome.response,
      };
    } catch (e) {
      const message = redactString(e instanceof Error ? e.message : String(e));
      deps.log?.error("mcp-protocol: unhandled exception", { message });
      return {
        status: 500,
        headers: CONTENT_TYPE_HEADERS,
        body: errorResponse(null, JSONRPC_ERROR_CODES.INTERNAL_ERROR, `Internal error: ${message}`),
      };
    }
  }

  return { handle };
}
