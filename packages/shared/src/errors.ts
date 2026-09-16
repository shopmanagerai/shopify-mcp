import type { NextAction, RiskClass, ToolFailure } from "./types.js";

/** Stable error codes. Add here, never inline strings in handlers. */
export const ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_NOT_AVAILABLE: "TOOL_NOT_AVAILABLE",
  PRO_REQUIRED: "PRO_REQUIRED",
  AGENCY_REQUIRED: "AGENCY_REQUIRED",
  SCOPE_MISSING: "SCOPE_MISSING",
  PLAN_REQUIRED: "PLAN_REQUIRED",
  PROTECTED_DATA_REQUIRED: "PROTECTED_DATA_REQUIRED",
  API_VERSION_UNSUPPORTED: "API_VERSION_UNSUPPORTED",
  CAPABILITY_MISSING: "CAPABILITY_MISSING",
  POLICY_DENIED: "POLICY_DENIED",
  PROFILE_DENIED: "PROFILE_DENIED",
  CONFIRM_REQUIRED: "CONFIRM_REQUIRED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_INVALID: "APPROVAL_INVALID",
  APPROVAL_CONSUMED: "APPROVAL_CONSUMED",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  FINGERPRINT_MISMATCH: "FINGERPRINT_MISMATCH",
  USER_ERRORS: "USER_ERRORS",
  ACCESS_DENIED_EXEMPTION: "ACCESS_DENIED_EXEMPTION",
  THEME_ENGINE_UNAVAILABLE: "THEME_ENGINE_UNAVAILABLE",
  ADMIN_CLIENT_UNAVAILABLE: "ADMIN_CLIENT_UNAVAILABLE",
  APP_OWNED_METAFIELD: "APP_OWNED_METAFIELD",
  THEME_ACCESS_MISSING: "THEME_ACCESS_MISSING",
  WORKING_THEME_MISSING: "WORKING_THEME_MISSING",
  LIVE_THEME_WRITE_REFUSED: "LIVE_THEME_WRITE_REFUSED",
  INVALID_PATH: "INVALID_PATH",
  THEME_CHECK_ERRORS: "THEME_CHECK_ERRORS",
  PREVIEW_UNAVAILABLE: "PREVIEW_UNAVAILABLE",
  CAPTURE_TIMEOUT: "CAPTURE_TIMEOUT",
  STOREFRONT_PASSWORD_PROTECTED: "STOREFRONT_PASSWORD_PROTECTED",
  SNAPSHOT_NOT_FOUND: "SNAPSHOT_NOT_FOUND",
  BULK_OP_IN_PROGRESS: "BULK_OP_IN_PROGRESS",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  QUALITY_GATE_FAILED: "QUALITY_GATE_FAILED",
  PRESERVATION_GATE_FAILED: "PRESERVATION_GATE_FAILED",
  GRAPHQL_ROOT_DENIED: "GRAPHQL_ROOT_DENIED",
  GRAPHQL_COST_EXCEEDED: "GRAPHQL_COST_EXCEEDED",
  MUTATION_DENIED: "MUTATION_DENIED",
  NOT_SUPPORTED: "NOT_SUPPORTED",
  TIMEOUT: "TIMEOUT",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL: "INTERNAL",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class ShopManagerAIError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly technicalMessage?: string;
  readonly suggestedActions: NextAction[];
  readonly httpStatus: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts: {
      retryable?: boolean;
      details?: Record<string, unknown>;
      technicalMessage?: string;
      suggestedActions?: NextAction[];
      httpStatus?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "ShopManagerError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
    this.technicalMessage = opts.technicalMessage;
    this.suggestedActions = opts.suggestedActions ?? [];
    this.httpStatus = opts.httpStatus ?? defaultStatus(code);
  }

  toFailure(tool: string, risk: RiskClass, operationId?: string): ToolFailure {
    return {
      ok: false,
      operationId,
      tool,
      code: this.code,
      message: this.message,
      technicalMessage: this.technicalMessage,
      retryable: this.retryable,
      risk,
      suggestedActions: this.suggestedActions,
      details: this.details,
    };
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "INVALID_INPUT":
    case "INVALID_PATH":
      return 400;
    case "PRO_REQUIRED":
    case "AGENCY_REQUIRED":
    case "SCOPE_MISSING":
    case "PLAN_REQUIRED":
    case "PROTECTED_DATA_REQUIRED":
    case "API_VERSION_UNSUPPORTED":
    case "POLICY_DENIED":
    case "PROFILE_DENIED":
    case "CONFIRM_REQUIRED":
    case "APPROVAL_REQUIRED":
    case "APPROVAL_INVALID":
    case "APPROVAL_CONSUMED":
    case "GRAPHQL_ROOT_DENIED":
    case "MUTATION_DENIED":
    case "LIVE_THEME_WRITE_REFUSED":
      return 403;
    case "NOT_FOUND":
    case "TOOL_NOT_FOUND":
    case "SNAPSHOT_NOT_FOUND":
      return 404;
    case "VERSION_CONFLICT":
    case "FINGERPRINT_MISMATCH":
    case "BULK_OP_IN_PROGRESS":
    case "PRESERVATION_GATE_FAILED":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "TIMEOUT":
    case "CAPTURE_TIMEOUT":
      return 504;
    case "UPSTREAM_ERROR":
    case "THEME_ENGINE_UNAVAILABLE":
    case "ADMIN_CLIENT_UNAVAILABLE":
      return 502;
    case "APP_OWNED_METAFIELD":
      return 403;
    default:
      return 500;
  }
}

export function isShopManagerAIError(e: unknown): e is ShopManagerAIError {
  return e instanceof ShopManagerAIError;
}

/** Wrap any thrown value into a ShopManagerAIError without leaking internals. */
export function toShopManagerAIError(e: unknown): ShopManagerAIError {
  if (isShopManagerAIError(e)) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ShopManagerAIError("INTERNAL", "Internal error.", { technicalMessage: msg, cause: e });
}

/**
 * One-line, log-friendly description of a caught error. `String(err)` on a ShopManagerAIError
 * only gives "ShopManagerError: <message>" - the code, httpStatus and technicalMessage (which is
 * where the actual Shopify/API detail lives) are silently dropped. Use this in every catch that
 * logs, or the real cause never makes it into the logs.
 */
export function describeError(e: unknown): string {
  if (isShopManagerAIError(e)) {
    const parts = [`${e.code} (${e.httpStatus})`, e.message];
    if (e.technicalMessage && e.technicalMessage !== e.message) parts.push(` - ${e.technicalMessage}`);
    return parts.join(": ");
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
