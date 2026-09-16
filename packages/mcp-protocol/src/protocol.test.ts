import { describe, expect, it } from "vitest";
import {
  bodyProtocolVersion,
  clientCapabilities,
  declaresClientCapabilities,
  isModernRequest,
  isRemovedInModern,
  META_PROTOCOL_VERSION,
  requestedLogLevel,
  requestMeta,
  traceContext,
  VERSION_LEGACY,
  VERSION_MODERN,
} from "./protocol.js";
import type { JsonRpcRequest } from "./jsonrpc.js";

function modernRequest(overrides: Partial<JsonRpcRequest> = {}): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: { _meta: { [META_PROTOCOL_VERSION]: VERSION_MODERN, "io.modelcontextprotocol/clientCapabilities": {} } },
    ...overrides,
  };
}

describe("era classification", () => {
  it("classifies a request carrying modern _meta as modern", () => {
    expect(isModernRequest(modernRequest())).toBe(true);
  });

  it("classifies a bare request with no _meta as not modern", () => {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect(isModernRequest(req)).toBe(false);
  });

  it("classifies initialize as legacy even if it somehow carried a header", () => {
    // The header alone must never be enough; body _meta is the only signal.
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: VERSION_LEGACY } };
    expect(isModernRequest(req)).toBe(false);
  });

  it("does not treat the HTTP header alone as an era signal (body has no _meta)", () => {
    // Simulates a legacy 2025-06-18+ client that also sends MCP-Protocol-Version
    // over HTTP, but whose JSON-RPC body carries no modern _meta.
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect(bodyProtocolVersion(req)).toBe("");
    expect(isModernRequest(req)).toBe(false);
  });
});

describe("request meta helpers", () => {
  it("reads the protocol version from _meta", () => {
    expect(bodyProtocolVersion(modernRequest())).toBe(VERSION_MODERN);
  });

  it("returns empty _meta for a request without params", () => {
    expect(requestMeta({ jsonrpc: "2.0", method: "ping" })).toEqual({});
  });

  it("reads declared client capabilities, empty object included", () => {
    const req = modernRequest();
    expect(declaresClientCapabilities(req)).toBe(true);
    expect(clientCapabilities(req)).toEqual({});
  });

  it("treats a missing clientCapabilities key as not declared", () => {
    const req = modernRequest({ params: { _meta: { [META_PROTOCOL_VERSION]: VERSION_MODERN } } });
    expect(declaresClientCapabilities(req)).toBe(false);
  });

  it("reads the requested log level when present", () => {
    const req = modernRequest({ params: { _meta: { [META_PROTOCOL_VERSION]: VERSION_MODERN, "io.modelcontextprotocol/logLevel": "debug" } } });
    expect(requestedLogLevel(req)).toBe("debug");
  });

  it("returns empty string when no log level was requested", () => {
    expect(requestedLogLevel(modernRequest())).toBe("");
  });

  it("propagates trace context verbatim and omits absent keys", () => {
    const req = modernRequest({
      params: {
        _meta: {
          [META_PROTOCOL_VERSION]: VERSION_MODERN,
          "io.modelcontextprotocol/clientCapabilities": {},
          traceparent: "00-abc-def-01",
          baggage: "k=v",
        },
      },
    });
    expect(traceContext(req)).toEqual({ traceparent: "00-abc-def-01", baggage: "k=v" });
  });
});

describe("removed-in-modern methods", () => {
  it.each(["ping", "logging/setLevel", "initialize", "notifications/initialized", "notifications/roots/list_changed", "resources/subscribe", "resources/unsubscribe"])(
    "flags %s as removed",
    (method) => {
      expect(isRemovedInModern(method)).toBe(true);
    },
  );

  it("does not flag an ordinary method", () => {
    expect(isRemovedInModern("tools/call")).toBe(false);
  });
});
