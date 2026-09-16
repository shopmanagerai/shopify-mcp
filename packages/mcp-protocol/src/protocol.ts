/**
 * Protocol-era vocabulary and request classification.
 *
 * TypeScript port of the original plugin’s `includes/mcp/protocol.php`. This server is
 * dual-era: the legacy, session-based revisions (`2025-11-25` and earlier)
 * use `initialize` / `notifications/initialized` and the `Mcp-Session-Id`
 * header; the modern revision `2026-07-28` removes all of that. There is no
 * handshake and no session, and every request carries its own version and
 * client capabilities in `_meta`.
 *
 * Classification happens once, here. Everything downstream stays
 * protocol-independent, and only the serializer differs per era.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 */
import type { JsonRpcRequest } from "./jsonrpc.js";

/** The modern, stateless revision. */
export const VERSION_MODERN = "2026-07-28";

/** The newest legacy revision this server negotiates by default. */
export const VERSION_LEGACY = "2025-11-25";

/** Versions advertised to clients, newest first. */
export const SUPPORTED_VERSIONS = [VERSION_MODERN, VERSION_LEGACY] as const;
export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

/** Per-request `_meta` key carrying the protocol version. */
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";

/** Per-request `_meta` key carrying the client's capabilities. */
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

/** Optional per-request `_meta` key identifying the client. */
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";

/** Optional per-request `_meta` key opting in to log notifications. */
export const META_LOG_LEVEL = "io.modelcontextprotocol/logLevel";

/** Result `_meta` key identifying this server. */
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** Notification `_meta` key tagging a subscription stream. */
export const META_SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId";

/** OpenTelemetry trace-context keys propagated verbatim when a client sends them. */
export const META_TRACE_KEYS = ["traceparent", "tracestate", "baggage"] as const;

/** HTTP header mirroring the protocol version. */
export const HEADER_PROTOCOL_VERSION = "mcp-protocol-version";

/** HTTP header mirroring the JSON-RPC method. */
export const HEADER_METHOD = "mcp-method";

/** HTTP header mirroring `params.name` or `params.uri`. */
export const HEADER_NAME = "mcp-name";

/** Legacy session header, ignored under the modern revision. */
export const HEADER_SESSION_ID = "mcp-session-id";

/** Methods whose `Mcp-Name` header is required, mapped to the body field it mirrors. */
export const NAME_HEADER_METHODS: Record<string, string> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/**
 * Methods the modern revision removed. Each was either deleted outright
 * (`ping`, `logging/setLevel`) or replaced by per-request metadata. They
 * remain served under the legacy revision and must answer method-not-found
 * under modern rather than quietly working.
 */
export const REMOVED_IN_MODERN = [
  "ping",
  "logging/setLevel",
  "initialize",
  "notifications/initialized",
  "notifications/roots/list_changed",
  "resources/subscribe",
  "resources/unsubscribe",
] as const;

/** Whether a version string is one this server implements. */
export function isSupportedVersion(version: string): boolean {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(version);
}

function paramsOf(body: JsonRpcRequest): Record<string, unknown> {
  const params = (body as { params?: unknown }).params;
  return params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
}

/** Read the `_meta` map of a request body. */
export function requestMeta(body: JsonRpcRequest): Record<string, unknown> {
  const meta = paramsOf(body)["_meta"];
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

/**
 * Read the protocol version a request body declares.
 *
 * Returns an empty string when the body carries no version, which is the
 * signal that the request is not modern.
 */
export function bodyProtocolVersion(body: JsonRpcRequest): string {
  const version = requestMeta(body)[META_PROTOCOL_VERSION];
  return typeof version === "string" ? version : "";
}

/**
 * Classify a request as modern or legacy.
 *
 * The rule comes straight from the versioning spec: a request carrying
 * modern per-request `_meta` is served statelessly under the modern
 * revision; an `initialize` request selects legacy semantics.
 *
 * The HTTP header alone is deliberately not enough to select the modern
 * era, a legacy `2025-06-18`+ client also sends `MCP-Protocol-Version`, so
 * treating the header as the selector would route legacy traffic into the
 * stateless path and break every existing connection. Header/body
 * disagreement is a validation failure handled separately (see headers.ts),
 * not an era signal.
 */
export function isModernRequest(body: JsonRpcRequest): boolean {
  return bodyProtocolVersion(body) !== "";
}

/** Whether a method was removed by the modern revision. */
export function isRemovedInModern(method: string): boolean {
  return (REMOVED_IN_MODERN as readonly string[]).includes(method);
}

/** Shape of the optional client-identifying info a request may carry. */
export interface RequestClientInfo {
  name: string;
  version?: string;
}

/**
 * Read the client info a modern request declares in `_meta`
 * (`io.modelcontextprotocol/clientInfo`), if any.
 */
export function requestClientInfo(body: JsonRpcRequest): RequestClientInfo | undefined {
  const info = requestMeta(body)[META_CLIENT_INFO];
  if (!info || typeof info !== "object" || Array.isArray(info)) return undefined;
  const name = (info as Record<string, unknown>)["name"];
  if (typeof name !== "string" || name === "") return undefined;
  const version = (info as Record<string, unknown>)["version"];
  return { name, version: typeof version === "string" ? version : undefined };
}

/**
 * Read the `clientInfo` a legacy `initialize` request's params carry, if any.
 * Same shape as the modern `_meta` variant but sits directly on `params`.
 */
export function legacyInitializeClientInfo(body: JsonRpcRequest): RequestClientInfo | undefined {
  const info = paramsOf(body)["clientInfo"];
  if (!info || typeof info !== "object" || Array.isArray(info)) return undefined;
  const name = (info as Record<string, unknown>)["name"];
  if (typeof name !== "string" || name === "") return undefined;
  const version = (info as Record<string, unknown>)["version"];
  return { name, version: typeof version === "string" ? version : undefined };
}

/** Read the client capabilities a modern request declares. */
export function clientCapabilities(body: JsonRpcRequest): Record<string, unknown> {
  const capabilities = requestMeta(body)[META_CLIENT_CAPABILITIES];
  return capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) ? (capabilities as Record<string, unknown>) : {};
}

/**
 * Whether a modern request declared its client capabilities at all.
 *
 * An empty object is a valid declaration ("I support nothing optional"); a
 * missing key is not a declaration and is rejected, because the server
 * would otherwise have to guess whether the client can handle an extension.
 */
export function declaresClientCapabilities(body: JsonRpcRequest): boolean {
  const capabilities = requestMeta(body)[META_CLIENT_CAPABILITIES];
  return capabilities !== null && capabilities !== undefined && typeof capabilities === "object" && !Array.isArray(capabilities);
}

/**
 * Read the log level a modern request opted in to.
 *
 * The modern revision forbids emitting `notifications/message` for a
 * request that did not supply this field, so its absence is meaningful.
 */
export function requestedLogLevel(body: JsonRpcRequest): string {
  const level = requestMeta(body)[META_LOG_LEVEL];
  return typeof level === "string" ? level : "";
}

/**
 * Copy any OpenTelemetry trace context a client supplied.
 *
 * Propagated verbatim and never synthesized: an invented trace id would
 * corrupt the caller's trace rather than extend it.
 */
export function traceContext(body: JsonRpcRequest): Record<string, string> {
  const meta = requestMeta(body);
  const context: Record<string, string> = {};
  for (const key of META_TRACE_KEYS) {
    const value = meta[key];
    if (typeof value === "string" && value !== "") context[key] = value;
  }
  return context;
}
