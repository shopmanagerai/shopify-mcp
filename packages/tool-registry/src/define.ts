/**
 * `defineTool` is an identity helper: it infers `I`/`O` from the zod schemas
 * and fills sensible defaults for the fields most tool authors don't want to
 * repeat on every entry.
 */
import type { z, ZodTypeAny } from "zod";
import type { ExecutionPlane, RiskClass, ToolDefinition } from "@shopmanagerai/shared";

type Defaultable = "version" | "timeoutMs" | "audit" | "rateLimitCategory" | "supportsPagination" | "idempotency";

export type DefineToolInput<I extends ZodTypeAny, O extends ZodTypeAny> = Omit<
  ToolDefinition<z.infer<I>, z.infer<O>>,
  Defaultable | "inputSchema" | "outputSchema"
> &
  Partial<Pick<ToolDefinition<z.infer<I>, z.infer<O>>, Defaultable>> & {
    inputSchema: I;
    outputSchema: O;
  };

function defaultRateLimitCategory(plane: ExecutionPlane, risk: RiskClass): ToolDefinition["rateLimitCategory"] {
  switch (plane) {
    case "shopify_admin":
      return risk === "read" ? "admin_read" : "admin_write";
    case "theme_engine":
      return "theme";
    case "browser":
      return "browser";
    case "job":
      return "job";
    case "server":
    default:
      return "none";
  }
}

/** True when the input schema is an object schema declaring a `themeId` field. */
function declaresThemeId(schema: ZodTypeAny): boolean {
  const anySchema = schema as any;
  const shape = anySchema?._def?.shape ? (typeof anySchema._def.shape === "function" ? anySchema._def.shape() : anySchema._def.shape) : anySchema?.shape;
  return !!shape && Object.prototype.hasOwnProperty.call(shape, "themeId");
}

/**
 * Default `themeId` resolution (review finding: agents should not have to look
 * up a theme id before every call). Reads default to the working theme when one
 * exists, else the live theme; writes default to the working theme, creating it.
 */
function withThemeDefault<I, O>(def: Pick<ToolDefinition<I, O>, "handler" | "riskClass">): ToolDefinition<I, O>["handler"] {
  return async (ctx, input) => {
    const obj = input as Record<string, unknown> | undefined;
    if (obj && typeof obj === "object" && obj.themeId == null) {
      let themeId: string | undefined;
      if (ctx.workingTheme) {
        if (def.riskClass === "read") {
          themeId = (await ctx.workingTheme.current())?.id ?? (await ctx.workingTheme.live()).id;
        } else {
          themeId = (await ctx.workingTheme.ensure()).id;
        }
      } else if (ctx.theme) {
        const themes = await ctx.theme.listThemes();
        themeId = themes.find((t) => t.role === "main")?.id ?? themes[0]?.id;
      }
      if (themeId) return def.handler(ctx, { ...obj, themeId } as I);
    }
    return def.handler(ctx, input);
  };
}

import { deriveRiskLevel } from "./risk-level.js";

export function defineTool<I extends ZodTypeAny, O extends ZodTypeAny>(
  def: DefineToolInput<I, O>,
): ToolDefinition<z.infer<I>, z.infer<O>> {
  const handler = declaresThemeId(def.inputSchema) ? withThemeDefault({ handler: def.handler, riskClass: def.riskClass }) : def.handler;
  return {
    ...def,
    handler,
    version: def.version ?? "1.0.0",
    // Real themes take several seconds per read; orchestrations (task mode) run many stages.
    timeoutMs: def.timeoutMs ?? (def.taskMode === "task" ? 900000 : 120000),
    riskLevel: def.riskLevel ?? deriveRiskLevel({ riskClass: def.riskClass, category: def.category, name: def.name, protectedCustomerData: def.protectedCustomerData }),
    audit: def.audit ?? (def.riskClass === "read" ? "mutations_only" : "always"),
    rateLimitCategory: def.rateLimitCategory ?? defaultRateLimitCategory(def.executionPlane, def.riskClass),
    supportsPagination: def.supportsPagination ?? false,
    idempotency: def.idempotency ?? (def.riskClass === "read" ? "natural" : "none"),
  };
}
