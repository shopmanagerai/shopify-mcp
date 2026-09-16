import { describe, expect, it } from "vitest";
import type { ToolFailure, ToolSuccess } from "@shopmanagerai/shared";
import { buildToolCallResult } from "./results.js";
import { META_PROTOCOL_VERSION, META_SERVER_INFO } from "./protocol.js";
import { VERSION_MODERN } from "./protocol.js";
import type { JsonRpcRequest } from "./jsonrpc.js";

const serverInfo = { name: "ShopManager AI", version: "0.1.0" };

function success(overrides: Partial<ToolSuccess> = {}): ToolSuccess {
  return {
    ok: true,
    operationId: "op_1",
    tool: "product_read",
    summary: "Read one product.",
    risk: "read",
    data: { id: "gid://shopify/Product/1" },
    changes: [],
    evidence: [],
    warnings: [],
    errors: [],
    nextActions: [],
    rollback: { available: false, strategy: "none" },
    ...overrides,
  };
}

function failure(overrides: Partial<ToolFailure> = {}): ToolFailure {
  return {
    ok: false,
    tool: "product_write",
    code: "POLICY_DENIED",
    message: "This operation is not permitted under the current profile.",
    retryable: false,
    risk: "write",
    suggestedActions: [],
    ...overrides,
  };
}

describe("buildToolCallResult", () => {
  it("shapes a success result: text block, structuredContent, isError false", () => {
    const result = success();
    const built = buildToolCallResult(result, { era: "legacy", serverInfo });

    expect(built.isError).toBe(false);
    expect(built.structuredContent).toBe(result);
    expect(built.content[0]).toEqual({ type: "text", text: JSON.stringify(result) });
    expect(built._meta).toBeUndefined();
  });

  it("shapes a failure result with isError true", () => {
    const result = failure();
    const built = buildToolCallResult(result, { era: "legacy", serverInfo });

    expect(built.isError).toBe(true);
    expect(built.structuredContent).toBe(result);
  });

  it("passes through inline image content after the text block", () => {
    const result = success({
      content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
    });
    const built = buildToolCallResult(result, { era: "legacy", serverInfo });

    expect(built.content).toHaveLength(2);
    expect(built.content[0]?.type).toBe("text");
    expect(built.content[1]).toEqual({ type: "image", data: "base64data", mimeType: "image/png" });
  });

  it("adds _meta.serverInfo only in the modern era", () => {
    const built = buildToolCallResult(success(), { era: "modern", serverInfo });
    expect(built._meta?.[META_SERVER_INFO]).toEqual(serverInfo);
  });

  it("echoes trace context verbatim in the modern era", () => {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "product_read",
        _meta: {
          [META_PROTOCOL_VERSION]: VERSION_MODERN,
          "io.modelcontextprotocol/clientCapabilities": {},
          traceparent: "00-trace-span-01",
        },
      },
    };
    const built = buildToolCallResult(success(), { era: "modern", serverInfo, request });
    expect(built._meta?.traceparent).toBe("00-trace-span-01");
  });

  it("does not invent trace context when the request supplied none", () => {
    const built = buildToolCallResult(success(), { era: "modern", serverInfo });
    expect(built._meta?.traceparent).toBeUndefined();
  });
});
