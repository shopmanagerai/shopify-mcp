/**
 * Envelope builders (master prompt §10 / docs/PRODUCT_ARCHITECTURE.md §7): every
 * handler returns a `ToolResult`. These helpers fill the boilerplate
 * (operationId, tool, risk, rollback default) so handlers only supply what is
 * specific to the call.
 */
import {
  ShopManagerAIError,
  isShopManagerAIError,
  toShopManagerAIError,
  type ErrorCode,
  type NextAction,
  type ToolDefinition,
  type ToolFailure,
  type ToolSuccess,
} from "@shopmanagerai/shared";

export interface EnvelopeContext {
  operationId: string;
}

export type OkInput<O> = Partial<Omit<ToolSuccess<O>, "ok" | "operationId" | "tool" | "risk">> & {
  data: O;
  summary: string;
};

export function ok<O>(ctx: EnvelopeContext, def: ToolDefinition, partial: OkInput<O>): ToolSuccess<O> {
  return {
    ok: true,
    operationId: ctx.operationId,
    tool: def.name,
    summary: partial.summary,
    risk: def.riskClass,
    data: partial.data,
    changes: partial.changes ?? [],
    evidence: partial.evidence ?? [],
    warnings: partial.warnings ?? [],
    errors: partial.errors ?? [],
    nextActions: partial.nextActions ?? [],
    rollback: partial.rollback ?? { available: false, strategy: def.rollback },
    ...(partial.jobId !== undefined ? { jobId: partial.jobId } : {}),
    ...(partial.content !== undefined ? { content: partial.content } : {}),
  };
}

interface ErrorLike {
  code: ErrorCode;
  message: string;
  technicalMessage?: string;
  retryable?: boolean;
  suggestedActions?: NextAction[];
  details?: Record<string, unknown>;
}

function isErrorLike(e: unknown): e is ErrorLike {
  return !!e && typeof e === "object" && !(e instanceof Error) && "code" in e && "message" in e;
}

/** Accepts a thrown value, a `ShopManagerAIError`, or a minimal `{code, message}` shape. */
export type FailInput = ShopManagerAIError | ErrorLike | unknown;

export function fail(ctx: EnvelopeContext, def: ToolDefinition, error: FailInput): ToolFailure {
  let cpError: ShopManagerAIError;
  if (isShopManagerAIError(error)) {
    cpError = error;
  } else if (isErrorLike(error)) {
    cpError = new ShopManagerAIError(error.code, error.message, {
      technicalMessage: error.technicalMessage,
      retryable: error.retryable,
      suggestedActions: error.suggestedActions,
      details: error.details,
    });
  } else {
    cpError = toShopManagerAIError(error);
  }
  return cpError.toFailure(def.name, def.riskClass, ctx.operationId);
}
