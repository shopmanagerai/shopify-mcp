import { describe, expect, it } from "vitest";
import { decodeHeaderValue, headerValueIsSafe, normalizeHeaders, paramHeaderMatches, validateModernHeaders } from "./headers.js";
import { JSONRPC_ERROR_CODES } from "./jsonrpc.js";
import { HEADER_METHOD, HEADER_NAME, HEADER_PROTOCOL_VERSION, META_PROTOCOL_VERSION, VERSION_MODERN } from "./protocol.js";
import type { JsonRpcRequest } from "./jsonrpc.js";

function callRequest(name = "product_read"): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: "req-1",
    method: "tools/call",
    params: {
      name,
      arguments: {},
      _meta: { [META_PROTOCOL_VERSION]: VERSION_MODERN, "io.modelcontextprotocol/clientCapabilities": {} },
    },
  };
}

function validHeaders(name = "product_read"): Record<string, string> {
  return {
    [HEADER_PROTOCOL_VERSION]: VERSION_MODERN,
    [HEADER_METHOD]: "tools/call",
    [HEADER_NAME]: name,
  };
}

describe("normalizeHeaders", () => {
  it("lowercases and hyphenates keys, folding underscores", () => {
    const out = normalizeHeaders({ MCP_Protocol_Version: VERSION_MODERN, "Mcp-Method": "tools/call" });
    expect(out).toEqual({ "mcp-protocol-version": VERSION_MODERN, "mcp-method": "tools/call" });
  });

  it("takes the first value of a repeated header", () => {
    const out = normalizeHeaders({ "x-thing": ["a", "b"] });
    expect(out["x-thing"]).toBe("a");
  });
});

describe("decodeHeaderValue", () => {
  it("returns non-sentinel values unchanged", () => {
    expect(decodeHeaderValue("plain-value")).toBe("plain-value");
  });

  it("decodes a valid Base64 sentinel", () => {
    const payload = Buffer.from("gid://shopify/Product/123", "utf8").toString("base64");
    expect(decodeHeaderValue(`=?base64?${payload}?=`)).toBe("gid://shopify/Product/123");
  });

  it("rejects a sentinel with invalid Base64 characters", () => {
    expect(decodeHeaderValue("=?base64?not!!valid==?=")).toBe(false);
  });

  it("rejects a sentinel that does not round-trip", () => {
    // Well-formed alphabet, wrong padding: 3 chars can't be valid Base64.
    expect(decodeHeaderValue("=?base64?abc?=")).toBe(false);
  });
});

describe("headerValueIsSafe", () => {
  it("accepts printable ASCII, space and tab", () => {
    expect(headerValueIsSafe("hello world\t!")).toBe(true);
  });

  it("rejects control characters", () => {
    expect(headerValueIsSafe("helloworld")).toBe(false);
    expect(headerValueIsSafe("line1\nline2")).toBe(false);
  });
});

describe("paramHeaderMatches", () => {
  it("compares numbers numerically", () => {
    expect(paramHeaderMatches("42.0", 42)).toBe(true);
    expect(paramHeaderMatches("42", 42.0)).toBe(true);
    expect(paramHeaderMatches("43", 42)).toBe(false);
  });

  it("compares booleans as lowercase strings", () => {
    expect(paramHeaderMatches("true", true)).toBe(true);
    expect(paramHeaderMatches("false", false)).toBe(true);
    expect(paramHeaderMatches("true", false)).toBe(false);
  });

  it("compares strings exactly", () => {
    expect(paramHeaderMatches("abc", "abc")).toBe(true);
    expect(paramHeaderMatches("abc", "abd")).toBe(false);
  });
});

describe("validateModernHeaders", () => {
  it("accepts a fully consistent request", () => {
    expect(validateModernHeaders(validHeaders(), callRequest())).toBeNull();
  });

  it("rejects a missing MCP-Protocol-Version header", () => {
    const headers = validHeaders();
    delete (headers as Record<string, string>)[HEADER_PROTOCOL_VERSION];
    const result = validateModernHeaders(headers, callRequest());
    expect(result).not.toBeNull();
    expect(result?.status).toBe(400);
    expect(result?.body.error.code).toBe(JSONRPC_ERROR_CODES.HEADER_MISMATCH);
    expect(result?.body.error.message).toContain("MCP-Protocol-Version header is required");
  });

  it("rejects a protocol version header that disagrees with the body", () => {
    const headers = { ...validHeaders(), [HEADER_PROTOCOL_VERSION]: "2025-11-25" };
    const result = validateModernHeaders(headers, callRequest());
    expect(result?.body.error.code).toBe(JSONRPC_ERROR_CODES.HEADER_MISMATCH);
    expect(result?.body.error.message).toContain("does not match body value");
  });

  it("rejects an unsupported protocol version even when header and body agree", () => {
    const req = callRequest();
    (req.params as Record<string, unknown>)["_meta"] = { [META_PROTOCOL_VERSION]: "1999-01-01", "io.modelcontextprotocol/clientCapabilities": {} };
    const headers = { ...validHeaders(), [HEADER_PROTOCOL_VERSION]: "1999-01-01" };
    const result = validateModernHeaders(headers, req);
    expect(result?.status).toBe(400);
    expect(result?.body.error.code).toBe(JSONRPC_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
    expect(result?.body.error.data).toMatchObject({ requested: "1999-01-01" });
  });

  it("rejects a missing Mcp-Method header", () => {
    const headers = validHeaders();
    delete (headers as Record<string, string>)[HEADER_METHOD];
    const result = validateModernHeaders(headers, callRequest());
    expect(result?.body.error.message).toContain("Mcp-Method header is required");
  });

  it("rejects a Mcp-Method header that disagrees with the body method", () => {
    const headers = { ...validHeaders(), [HEADER_METHOD]: "tools/list" };
    const result = validateModernHeaders(headers, callRequest());
    expect(result?.body.error.message).toContain("does not match body value");
  });

  it("rejects a missing Mcp-Name header on tools/call", () => {
    const headers = validHeaders();
    delete (headers as Record<string, string>)[HEADER_NAME];
    const result = validateModernHeaders(headers, callRequest());
    expect(result?.body.error.message).toContain("Mcp-Name header is required for tools/call");
  });

  it("rejects a Mcp-Name header that disagrees with params.name", () => {
    const headers = { ...validHeaders(), [HEADER_NAME]: "other_tool" };
    const result = validateModernHeaders(headers, callRequest("product_read"));
    expect(result?.body.error.message).toContain("does not match body value");
  });

  it("rejects a Mcp-Name header with unsafe control characters", () => {
    const headers = { ...validHeaders(), [HEADER_NAME]: "product\nread" };
    const result = validateModernHeaders(headers, callRequest());
    expect(result?.body.error.message).toContain("characters HTTP does not permit");
  });

  it("accepts a Base64-sentinel-encoded Mcp-Name that decodes to the body value", () => {
    const name = "gid://shopify/Product/123";
    const payload = Buffer.from(name, "utf8").toString("base64");
    const headers = { ...validHeaders(name), [HEADER_NAME]: `=?base64?${payload}?=` };
    expect(validateModernHeaders(headers, callRequest(name))).toBeNull();
  });

  it("rejects a Mcp-Name sentinel that is not valid Base64", () => {
    const headers = { ...validHeaders(), [HEADER_NAME]: "=?base64?***?=" };
    const result = validateModernHeaders(headers, callRequest());
    expect(result?.body.error.message).toContain("not valid Base64");
  });

  it("does not require Mcp-Name for methods that don't carry a name", () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [META_PROTOCOL_VERSION]: VERSION_MODERN, "io.modelcontextprotocol/clientCapabilities": {} } },
    };
    const headers = { [HEADER_PROTOCOL_VERSION]: VERSION_MODERN, [HEADER_METHOD]: "tools/list" };
    expect(validateModernHeaders(headers, req)).toBeNull();
  });
});
