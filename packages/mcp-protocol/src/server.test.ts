import { describe, expect, it } from "vitest";
import type { ToolResult } from "@shopmanagerai/shared";
import { createMcpHandler, type McpHandlerDeps, type ToolDescriptor } from "./server.js";
import { HEADER_METHOD, HEADER_NAME, HEADER_PROTOCOL_VERSION, META_PROTOCOL_VERSION, VERSION_LEGACY, VERSION_MODERN } from "./protocol.js";
import { JSONRPC_ERROR_CODES } from "./jsonrpc.js";

interface FakeCtx {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

const TOOLS: ToolDescriptor[] = [{ name: "product_read", description: "Read a product.", inputSchema: { type: "object" } }];

function makeDeps(overrides: Partial<McpHandlerDeps<FakeCtx>> = {}): McpHandlerDeps<FakeCtx> {
  return {
    descriptor: { name: "TestServer", version: "9.9.9" },
    listTools: () => TOOLS,
    callTool: async (ctx, name, args) => {
      ctx.calls.push({ name, args });
      const result: ToolResult = {
        ok: true,
        operationId: "op_1",
        tool: name,
        summary: "done",
        risk: "read",
        data: { name },
        changes: [],
        evidence: [],
        warnings: [],
        errors: [],
        nextActions: [],
        rollback: { available: false, strategy: "none" },
      };
      return result;
    },
    ...overrides,
  };
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  const h: Record<string, string> = {
    [HEADER_PROTOCOL_VERSION]: VERSION_MODERN,
    [HEADER_METHOD]: method,
  };
  if (name) h[HEADER_NAME] = name;
  return h;
}

function modernBody(method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: { ...params, _meta: { [META_PROTOCOL_VERSION]: VERSION_MODERN, "io.modelcontextprotocol/clientCapabilities": {} } },
  };
}

describe("createMcpHandler: transport basics", () => {
  it("rejects non-POST with 405 and Allow: POST", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({ method: "GET", headers: {}, body: {}, ctx: { calls: [] } });
    expect(out.status).toBe(405);
    expect(out.headers.Allow).toBe("POST");
  });

  it("never throws: an exception from a tool handler becomes a redacted -32603", async () => {
    const deps = makeDeps({
      callTool: async () => {
        throw new Error("leaked shpat_abcdefghijklmnopqrstuvwx123456 in message");
      },
    });
    const { handle } = createMcpHandler(deps);
    const out = await handle({
      method: "POST",
      headers: modernHeaders("tools/call", "product_read"),
      body: modernBody("tools/call", { name: "product_read", arguments: {} }),
      ctx: { calls: [] },
    });
    expect(out.status).toBe(500);
    const body = out.body as { error: { code: number; message: string } };
    expect(body.error.code).toBe(JSONRPC_ERROR_CODES.INTERNAL_ERROR);
    expect(body.error.message).not.toContain("shpat_");
    expect(body.error.message).toContain("[REDACTED]");
  });

  it("rejects an unknown method with -32601", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: {},
      body: { jsonrpc: "2.0", id: 1, method: "totally/unknown" },
      ctx: { calls: [] },
    });
    const body = out.body as { error: { code: number } };
    expect(body.error.code).toBe(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND);
  });
});

describe("createMcpHandler: modern era", () => {
  it("rejects a removed method with -32601", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: modernHeaders("ping"),
      body: modernBody("ping"),
      ctx: { calls: [] },
    });
    const body = out.body as { error: { code: number; message: string } };
    expect(body.error.code).toBe(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND);
    expect(body.error.message).toContain("removed");
  });

  it("shapes a tools/call result with text + structuredContent + serverInfo meta", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: modernHeaders("tools/call", "product_read"),
      body: modernBody("tools/call", { name: "product_read", arguments: { id: "1" } }),
      ctx: { calls: [] },
    });
    expect(out.status).toBe(200);
    const body = out.body as { result: { content: Array<{ type: string; text?: string }>; structuredContent: unknown; isError: boolean; _meta: Record<string, unknown> } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]?.type).toBe("text");
    expect(body.result.structuredContent).toMatchObject({ ok: true, tool: "product_read" });
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({ name: "TestServer", version: "9.9.9" });
  });

  it("rejects a header/body mismatch before routing", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: { ...modernHeaders("tools/call", "product_read"), [HEADER_PROTOCOL_VERSION]: VERSION_LEGACY },
      body: modernBody("tools/call", { name: "product_read", arguments: {} }),
      ctx: { calls: [] },
    });
    expect(out.status).toBe(400);
    const body = out.body as { error: { code: number } };
    expect(body.error.code).toBe(JSONRPC_ERROR_CODES.HEADER_MISMATCH);
  });
});

describe("createMcpHandler: legacy era", () => {
  it("negotiates initialize: unknown requested version falls back to VERSION_LEGACY", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: {},
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1970-01-01" } },
      ctx: { calls: [] },
    });
    const body = out.body as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe(VERSION_LEGACY);
    expect(out.headers["Mcp-Session-Id"]).toBeTruthy();
  });

  it("negotiates initialize: an explicitly named older revision is echoed back", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: {},
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      ctx: { calls: [] },
    });
    const body = out.body as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2024-11-05");
  });

  it("answers notifications/initialized with 202 and no body", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: {},
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
      ctx: { calls: [] },
    });
    expect(out.status).toBe(202);
    expect(out.body).toBeUndefined();
  });

  it("answers ping with an empty object", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({ method: "POST", headers: {}, body: { jsonrpc: "2.0", id: 5, method: "ping" }, ctx: { calls: [] } });
    const body = out.body as { result: unknown };
    expect(body.result).toEqual({});
  });

  it("accepts logging/setLevel as a no-op", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: {},
      body: { jsonrpc: "2.0", id: 6, method: "logging/setLevel", params: { level: "debug" } },
      ctx: { calls: [] },
    });
    const body = out.body as { result: unknown };
    expect(body.result).toEqual({});
  });
});

describe("createMcpHandler: batch", () => {
  it("answers each request in a batch and skips notifications", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({
      method: "POST",
      headers: {},
      body: [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ],
      ctx: { calls: [] },
    });
    expect(out.status).toBe(200);
    const body = out.body as Array<{ id: unknown; result?: unknown }>;
    expect(body).toHaveLength(2);
    expect(body[0]?.id).toBe(1);
    expect(body[1]?.id).toBe(2);
  });

  it("rejects an empty batch as invalid", async () => {
    const { handle } = createMcpHandler(makeDeps());
    const out = await handle({ method: "POST", headers: {}, body: [], ctx: { calls: [] } });
    expect(out.status).toBe(400);
  });
});
