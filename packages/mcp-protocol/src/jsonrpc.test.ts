import { describe, expect, it } from "vitest";
import { errorResponse, isJsonRpcRequest, JSONRPC_ERROR_CODES, parseRequestBody, successResponse } from "./jsonrpc.js";

describe("errorResponse / successResponse", () => {
  it("builds a JSON-RPC error envelope, omitting data when absent", () => {
    const res = errorResponse(1, JSONRPC_ERROR_CODES.INVALID_PARAMS, "bad input");
    expect(res).toEqual({ jsonrpc: "2.0", id: 1, error: { code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: "bad input" } });
  });

  it("includes data when provided", () => {
    const res = errorResponse(null, JSONRPC_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION, "nope", { supported: ["a"] });
    expect(res.error.data).toEqual({ supported: ["a"] });
  });

  it("defaults a missing id to null", () => {
    expect(errorResponse(undefined, JSONRPC_ERROR_CODES.INTERNAL_ERROR, "x").id).toBeNull();
  });

  it("builds a JSON-RPC success envelope", () => {
    expect(successResponse(2, { ok: true })).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
  });
});

describe("isJsonRpcRequest", () => {
  it("accepts an object with a string method", () => {
    expect(isJsonRpcRequest({ method: "ping" })).toBe(true);
  });

  it("rejects arrays, primitives, and objects without a method", () => {
    expect(isJsonRpcRequest([])).toBe(false);
    expect(isJsonRpcRequest("ping")).toBe(false);
    expect(isJsonRpcRequest(null)).toBe(false);
    expect(isJsonRpcRequest({})).toBe(false);
    expect(isJsonRpcRequest({ method: 5 })).toBe(false);
  });
});

describe("parseRequestBody", () => {
  it("parses a single request", () => {
    const parsed = parseRequestBody({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(parsed.kind).toBe("single");
  });

  it("parses a non-empty batch", () => {
    const parsed = parseRequestBody([{ method: "ping" }, { method: "tools/list" }]);
    expect(parsed.kind).toBe("batch");
    if (parsed.kind === "batch") expect(parsed.requests).toHaveLength(2);
  });

  it("rejects an empty batch", () => {
    const parsed = parseRequestBody([]);
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind === "invalid") expect(parsed.error.error.code).toBe(JSONRPC_ERROR_CODES.INVALID_REQUEST);
  });

  it("rejects a body with no method", () => {
    const parsed = parseRequestBody({ id: 1 });
    expect(parsed.kind).toBe("invalid");
  });

  it("rejects a non-object body", () => {
    const parsed = parseRequestBody("not json-rpc");
    expect(parsed.kind).toBe("invalid");
  });
});
