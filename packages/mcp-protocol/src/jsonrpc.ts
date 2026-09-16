/**
 * JSON-RPC 2.0 envelope types, error codes, and request parsing.
 *
 * The modern MCP revision (`2026-07-28`) partitions the JSON-RPC server-error
 * range: `-32000`..`-32019` stays implementation-defined, `-32020`..`-32099`
 * is reserved for the specification. Three codes below (header mismatch,
 * missing client capability, unsupported protocol version) were placed in
 * that reserved block by the revision, matching the original plugin’s PHP reference
 * (`includes/mcp/errors.php`).
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Stable JSON-RPC / MCP error codes. Add here, never inline literals at call sites. */
export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** A mirrored Streamable HTTP header disagrees with the body, or is missing. */
  HEADER_MISMATCH: -32020,
  /** The request needs a client capability the client did not declare. */
  MISSING_CLIENT_CAPABILITY: -32021,
  /** The requested protocol version is not implemented by this server. */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;
export type JsonRpcErrorCode = (typeof JSONRPC_ERROR_CODES)[keyof typeof JSONRPC_ERROR_CODES];

export function errorResponse(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

export function successResponse(id: JsonRpcId | undefined, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { method?: unknown }).method === "string";
}

export type ParsedBody =
  | { kind: "single"; request: JsonRpcRequest }
  | { kind: "batch"; requests: unknown[] }
  | { kind: "invalid"; error: JsonRpcErrorResponse };

/** Parse a decoded JSON body into a single request, a batch, or an error. */
export function parseRequestBody(body: unknown): ParsedBody {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { kind: "invalid", error: errorResponse(null, JSONRPC_ERROR_CODES.INVALID_REQUEST, "Batch request must not be empty.") };
    }
    return { kind: "batch", requests: body };
  }
  if (isJsonRpcRequest(body)) {
    return { kind: "single", request: body };
  }
  const id = body && typeof body === "object" && !Array.isArray(body) ? (((body as Record<string, unknown>).id as JsonRpcId) ?? null) : null;
  return { kind: "invalid", error: errorResponse(id, JSONRPC_ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC request.") };
}
