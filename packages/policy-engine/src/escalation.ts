/**
 * Risk escalation (ARCHITECTURE_REVIEW A3): a tool's declared `riskClass` is a
 * floor, not a ceiling. `def.escalation` rules bump the *effective* risk when
 * the input touches sensitive fields (e.g. price/inventory on an otherwise
 * plain "write" product-update tool), and name the custom policy key that
 * must additionally be true.
 */
import { RISK_ORDER, type RiskClass, type ToolDefinition } from "@shopmanagerai/shared";

export interface EscalationResult {
  effectiveRisk: RiskClass;
  /** Custom policy key that must be truthy for the highest-risk match, if any. */
  policyKey?: string;
  /** Human-readable descriptions of every rule that matched, for the trace. */
  matchedRules: string[];
}

/**
 * Dot-path presence check. Arrays are checked element-wise: if a path segment
 * resolves to an array, presence is true if *any* element has the remaining
 * path. A value counts as "present" when it is neither `undefined` nor `null`.
 */
export function pathPresent(value: unknown, path: string): boolean {
  return segmentsPresent(value, path.split(".").filter(Boolean));
}

function segmentsPresent(value: unknown, segments: string[]): boolean {
  if (segments.length === 0) return value !== undefined && value !== null;
  if (Array.isArray(value)) {
    return value.some((item) => segmentsPresent(item, segments));
  }
  if (value && typeof value === "object") {
    const [head, ...rest] = segments;
    const next = (value as Record<string, unknown>)[head as string];
    if (next === undefined) return false;
    return segmentsPresent(next, rest);
  }
  return false;
}

export function applyEscalation(def: Pick<ToolDefinition, "riskClass" | "escalation">, input: unknown): EscalationResult {
  let effectiveRisk = def.riskClass;
  let policyKey: string | undefined;
  const matchedRules: string[] = [];

  for (const rule of def.escalation ?? []) {
    const matchedPaths = rule.whenInputHas.filter((p) => pathPresent(input, p));
    if (matchedPaths.length === 0) continue;
    matchedRules.push(`${matchedPaths.join("|")} -> ${rule.toRisk}`);
    if (RISK_ORDER[rule.toRisk] > RISK_ORDER[effectiveRisk]) {
      effectiveRisk = rule.toRisk;
      policyKey = rule.policyKey;
    } else if (RISK_ORDER[rule.toRisk] === RISK_ORDER[effectiveRisk] && policyKey === undefined) {
      policyKey = rule.policyKey;
    }
  }

  return { effectiveRisk, policyKey, matchedRules };
}
