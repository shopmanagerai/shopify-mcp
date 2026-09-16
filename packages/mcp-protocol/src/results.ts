/**
 * `tools/call` result shaping for both protocol eras.
 *
 * Every tool handler returns the shared `ToolResult` envelope
 * (`@shopmanagerai/shared`). This module wraps that envelope into the MCP
 * `content` / `structuredContent` / `isError` shape clients expect,
 * mirroring the original plugin’s `includes/mcp/results.php` and `transport.php::call_tool`.
 *
 * Legacy results are returned exactly as built. Modern results additionally
 * carry `_meta["io.modelcontextprotocol/serverInfo"]` and echo any trace
 * context (`traceparent`, `tracestate`, `baggage`) the caller supplied , 
 * propagated verbatim, never synthesized.
 */
import type { McpContent, ToolResult } from "@shopmanagerai/shared";
import type { JsonRpcRequest } from "./jsonrpc.js";
import { META_SERVER_INFO, traceContext } from "./protocol.js";

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface ToolCallResult {
  content: McpContent[];
  structuredContent: ToolResult;
  isError: boolean;
  _meta?: Record<string, unknown>;
}

export interface BuildToolCallResultOptions {
  era: "modern" | "legacy" | "internal";
  serverInfo: McpServerInfo;
  /** The originating request; only consulted (for trace context) in the modern era. */
  request?: JsonRpcRequest;
}

/**
 * Build a `tools/call` result from a `ToolResult` envelope.
 *
 * `content` always carries the envelope serialized as a single text block
 * (so a client that only renders text still sees the full outcome), plus
 * any inline MCP content the tool attached (images, resource links).
 * `structuredContent` carries the envelope itself for clients that read it
 * directly. `isError` mirrors `!result.ok`, per the spec: a tool that
 * refuses is a normal, model-readable outcome, not a JSON-RPC error.
 */
export function buildToolCallResult(result: ToolResult, options: BuildToolCallResultOptions): ToolCallResult {
  const content: McpContent[] = [{ type: "text", text: JSON.stringify(result) }];
  if (result.ok && Array.isArray(result.content)) {
    for (const item of result.content) content.push(item);
  }

  const built: ToolCallResult = {
    content,
    structuredContent: result,
    isError: !result.ok,
  };

  if (options.era === "modern") {
    const meta: Record<string, unknown> = { [META_SERVER_INFO]: options.serverInfo };
    if (options.request) {
      const trace = traceContext(options.request);
      for (const [key, value] of Object.entries(trace)) meta[key] = value;
    }
    built._meta = meta;
  }

  return built;
}
