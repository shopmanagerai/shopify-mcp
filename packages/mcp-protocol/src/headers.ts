/**
 * Modern Streamable HTTP header validation.
 *
 * Port of the original plugin’s `includes/mcp/headers.php`. The transport mirrors
 * selected body fields into HTTP headers so gateways can route without
 * parsing the body. That creates a split-brain risk: a proxy could
 * authorize on `Mcp-Name` while the server executes `params.name`. The spec
 * closes it by requiring the server to reject any disagreement, and the
 * body is authoritative, headers are only ever validated against it, never
 * read as input.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation
 */
import {
  errorResponse,
  JSONRPC_ERROR_CODES,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcRequest,
} from "./jsonrpc.js";
import { bodyProtocolVersion, HEADER_METHOD, HEADER_NAME, HEADER_PROTOCOL_VERSION, isSupportedVersion, NAME_HEADER_METHODS, SUPPORTED_VERSIONS } from "./protocol.js";

/** Marker prefix for a Base64-encoded header value. */
export const BASE64_SENTINEL_PREFIX = "=?base64?";

/** Marker suffix for a Base64-encoded header value. */
export const BASE64_SENTINEL_SUFFIX = "?=";

export type RawHeaders = Record<string, string | string[] | undefined>;

export interface HeaderErrorResponse {
  status: number;
  body: JsonRpcErrorResponse;
}

/**
 * Normalize a header map to lowercase, hyphenated keys.
 *
 * Two normalizations, both required:
 *
 * 1. Case. HTTP field names are case-insensitive, so `MCP-Protocol-Version`
 *    and `mcp-protocol-version` are the same header.
 * 2. Separator. Some runtimes (Node's `http` module included, for some
 *    proxies) fold hyphens to underscores before a handler sees the header
 *    map. Underscores are folded back to hyphens so the check matches what
 *    the client actually sent regardless of which convention the transport
 *    layer used.
 *
 * Values are left untouched: method and tool names are case-sensitive. A
 * repeated header arrives as an array; the first value is used, matching
 * what an intermediary would have routed on.
 */
export function normalizeHeaders(headers: RawHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(headers)) {
    const value = Array.isArray(rawValue) ? (rawValue[0] ?? "") : (rawValue ?? "");
    const key = name.trim().toLowerCase().replace(/_/g, "-");
    normalized[key] = typeof value === "string" ? value : String(value);
  }
  return normalized;
}

/**
 * Decode a header value that uses the Base64 sentinel format
 * (`=?base64?<payload>?=`).
 *
 * Values outside the sentinel format are returned unchanged. A sentinel
 * whose payload is not valid Base64, or does not round-trip, is rejected
 * rather than silently passed through, because a decode that quietly fails
 * would compare a mangled value against the body and produce a confusing
 * mismatch.
 */
export function decodeHeaderValue(value: string): string | false {
  if (!value.startsWith(BASE64_SENTINEL_PREFIX) || !value.endsWith(BASE64_SENTINEL_SUFFIX)) {
    return value;
  }

  const payload = value.slice(BASE64_SENTINEL_PREFIX.length, value.length - BASE64_SENTINEL_SUFFIX.length);

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 !== 0) {
    return false;
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(payload, "base64");
  } catch {
    return false;
  }

  // Strict round-trip: reject a payload that isn't canonical Base64 for the
  // bytes it decodes to (e.g. garbage padding), rather than silently
  // accepting a mangled value.
  if (decoded.toString("base64") !== payload) {
    return false;
  }

  return decoded.toString("utf8");
}

/**
 * Whether a header value is within the printable range HTTP permits
 * (visible ASCII, space, and horizontal tab). A control character here is
 * an injection attempt or a broken client, and either way must not be
 * compared against the body as if it were ordinary text.
 */
export function headerValueIsSafe(value: string): boolean {
  // Visible ASCII, space, and horizontal tab (the tab is intentional, RFC 9110 field-value).
  // eslint-disable-next-line no-control-regex
  return /^[\x20\x09\x21-\x7E]*$/.test(value);
}

function headerMismatchError(message: string, id: JsonRpcId): HeaderErrorResponse {
  return { status: 400, body: errorResponse(id, JSONRPC_ERROR_CODES.HEADER_MISMATCH, `Header mismatch: ${message}`) };
}

/** The requested protocol version is not one this server implements. */
export function unsupportedProtocolVersionError(requested: string, id: JsonRpcId): HeaderErrorResponse {
  return {
    status: 400,
    body: errorResponse(id, JSONRPC_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
      supported: SUPPORTED_VERSIONS,
      requested,
    }),
  };
}

/**
 * Validate `Mcp-Name` for the methods that require it (`tools/call`,
 * `prompts/get`, `resources/read`).
 *
 * @param headers Already-normalized (lowercase, hyphenated) header map.
 */
export function validateNameHeader(headers: Record<string, string>, body: JsonRpcRequest, method: string, id: JsonRpcId): HeaderErrorResponse | null {
  const field = NAME_HEADER_METHODS[method];
  if (!field) return null;

  const raw = headers[HEADER_NAME] ?? "";
  if (raw === "") {
    return headerMismatchError(`the Mcp-Name header is required for ${method} requests.`, id);
  }
  if (!headerValueIsSafe(raw)) {
    return headerMismatchError("the Mcp-Name header contains characters HTTP does not permit.", id);
  }

  const decoded = decodeHeaderValue(raw);
  if (decoded === false) {
    return headerMismatchError("the Mcp-Name header is not valid Base64 for its sentinel format.", id);
  }

  const params = body.params && typeof body.params === "object" ? body.params : {};
  const expected = (params as Record<string, unknown>)[field];
  if (typeof expected !== "string") {
    return headerMismatchError(`params.${field} is required for ${method} and must be a string.`, id);
  }

  if (decoded !== expected) {
    return headerMismatchError(`Mcp-Name header value "${decoded}" does not match body value "${expected}".`, id);
  }

  return null;
}

/**
 * Validate the mirrored headers of a modern request against its body.
 *
 * Returns null when the request is acceptable, or the error response to
 * send. Order matters: the protocol version is checked before anything
 * else, so a client on an unsupported revision is told to change versions
 * rather than being handed a confusing complaint about a header it got
 * right.
 */
export function validateModernHeaders(headers: RawHeaders, body: JsonRpcRequest): HeaderErrorResponse | null {
  const normalized = normalizeHeaders(headers);
  const id = (body.id ?? null) as JsonRpcId;
  const method = typeof body.method === "string" ? body.method : "";

  const headerVersion = normalized[HEADER_PROTOCOL_VERSION] ?? "";
  if (headerVersion === "") {
    return headerMismatchError("the MCP-Protocol-Version header is required.", id);
  }

  const bodyVersion = bodyProtocolVersion(body);
  if (headerVersion !== bodyVersion) {
    return headerMismatchError(`MCP-Protocol-Version header value "${headerVersion}" does not match body value "${bodyVersion}".`, id);
  }

  if (!isSupportedVersion(headerVersion)) {
    return unsupportedProtocolVersionError(headerVersion, id);
  }

  const headerMethod = normalized[HEADER_METHOD] ?? "";
  if (headerMethod === "") {
    return headerMismatchError("the Mcp-Method header is required.", id);
  }
  if (headerMethod !== method) {
    return headerMismatchError(`Mcp-Method header value "${headerMethod}" does not match body value "${method}".`, id);
  }

  return validateNameHeader(normalized, body, method, id);
}

/**
 * Compare a mirrored `Mcp-Param-*` value with the body value it mirrors.
 *
 * Numbers are compared numerically, not as strings, so a client sending
 * `42.0` for an integer argument of `42` is not rejected over formatting.
 * Booleans mirror as lowercase `true`/`false`.
 */
export function paramHeaderMatches(headerValue: string, bodyValue: unknown): boolean {
  if (typeof bodyValue === "boolean") {
    return headerValue === (bodyValue ? "true" : "false");
  }
  if (typeof bodyValue === "number") {
    return headerValue !== "" && !Number.isNaN(Number(headerValue)) && Number(headerValue) === bodyValue;
  }
  return typeof bodyValue === "string" && headerValue === bodyValue;
}
