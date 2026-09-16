/**
 * Policy evaluation (docs/PRODUCT_ARCHITECTURE.md §5).
 *
 * Rule order (first failure wins, and is reported with the rule name):
 *   entitlement -> shopify scopes -> store capabilities -> tool/category
 *   disabled -> profile risk gate (after escalation) -> custom policy keys ->
 *   confirm requirement -> approval token -> bulk threshold.
 */
import {
  BRAND,
  ERROR_CODES,
  type ApprovalService,
  type Credential,
  type Entitlement,
  type ErrorCode,
  type NextAction,
  type RiskClass,
  type StoreCapability,
  type Tier,
  type ToolDefinition,
} from "@shopmanagerai/shared";
import { applyEscalation } from "./escalation.js";
import {
  APPROVE_TOOL_NAME,
  isRiskAllowedByProfile,
  requiresApprovalToken,
  requiresConfirm,
  resolvePolicy,
} from "./profiles.js";

export interface PolicyEvaluationInput {
  def: ToolDefinition;
  /** The resolved (post-alias/family) tool name being invoked. */
  effectiveName: string;
  credential: Credential;
  tier: Tier;
  entitlements: Set<Entitlement>;
  capabilities: Set<StoreCapability>;
  input: unknown;
  bulkCount?: number;
  planHash: string;
  approvals: ApprovalService;
  shopId: string;
  /** Store facts for plan / protected-data / API-version gates (optional; absent = not checked). */
  storeFacts?: { plan?: string; protectedCustomerDataApproved?: boolean; apiVersion?: string; distribution?: "custom" | "public" };
}

/** Human/agent-readable explanation of a missing scope, naming what IS granted. */
export function describeScopeGap(tool: string, scope: string, granted: Set<string>): string {
  const family = scope.replace(/^(read|write)_/, "");
  const related = [...granted].filter((g) => g.endsWith("_" + family) || g === family);
  const have = related.length ? ` Granted for this resource: ${related.join(", ")}.` : " No scope for this resource is granted.";
  return `Cannot run ${tool}: Shopify access scope "${scope}" is not granted to this app.${have} Ask the merchant to reconnect the app with "${scope}" (shopify.auth.connect lists the scope set), then retry.`;
}

export interface PolicyApproval {
  kind: "confirm" | "approval_token";
  approvedBy?: string;
}

export type PolicyDecision =
  | { allowed: true; effectiveRisk: RiskClass; approval?: PolicyApproval; trace: string[] }
  | {
      allowed: false;
      code: ErrorCode;
      message: string;
      rule: string;
      trace: string[];
      suggestedActions: NextAction[];
      details?: Record<string, unknown>;
    };

export type DenyDecision = Extract<PolicyDecision, { allowed: false }>;

function deny(
  trace: string[],
  rule: string,
  code: ErrorCode,
  message: string,
  suggestedActions: NextAction[] = [],
  details?: Record<string, unknown>,
): DenyDecision {
  trace.push(`deny:${rule}`);
  return { allowed: false, code, message, rule, trace, suggestedActions, details };
}

export async function evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
  const { def, effectiveName, credential, tier, entitlements, capabilities, approvals, shopId, planHash } = input;
  const trace: string[] = [];

  // 1. entitlement
  trace.push("check:entitlement");
  for (const required of def.requiredEntitlements) {
    if (entitlements.has(required)) continue;
    const isAgency = required.startsWith("agency.");
    return deny(
      trace,
      "entitlement",
      isAgency ? ERROR_CODES.AGENCY_REQUIRED : ERROR_CODES.PRO_REQUIRED,
      isAgency ? "This tool requires the Agency plan." : "This tool requires the Pro plan.",
      [{ tool: "commerce.entitlements", reason: isAgency ? "Agency required" : "Pro required" }],
      {
        feature: def.name,
        benefit: def.description,
        upgradeUrl: `https://${BRAND.domain}/upgrade`,
        missingEntitlement: required,
        tier,
      },
    );
  }

  // 2. shopify scopes
  trace.push("check:scopes");
  // Shopify collapses `read_x` into `write_x` in the granted set, so a write scope
  // satisfies its read counterpart.
  const granted = new Set(credential.scopesGranted);
  for (const scope of def.requiredShopifyScopes) {
    if (granted.has(scope)) continue;
    if (scope.startsWith("read_") && granted.has(`write_${scope.slice(5)}`)) continue;
    return deny(
      trace,
      "scope",
      ERROR_CODES.SCOPE_MISSING,
      describeScopeGap(effectiveName, scope, granted),
      [{ tool: "shopify.auth.status", reason: "reconnect to grant the missing scope", input: { scope } }],
      { missingScope: scope, grantedScopes: [...granted] },
    );
  }

  // 2b. plan / protected customer data / API version (only when the facts are known)
  trace.push("check:platform");
  const facts = input.storeFacts;
  if (def.planRequirement === "plus" && facts?.plan !== undefined && !/plus/i.test(facts.plan)) {
    return deny(
      trace,
      "plan",
      ERROR_CODES.PLAN_REQUIRED,
      `${effectiveName} needs Shopify Plus (this Shopify feature is Plus-only); the connected store is on the "${facts.plan}" plan. Use a theme/cart-level alternative or run against a Plus development store.`,
      [{ tool: "commerce.api.capabilities", reason: "see which plan-gated capabilities apply", input: { onlyUnavailable: true } }],
      { planRequirement: def.planRequirement, plan: facts.plan },
    );
  }
  if (def.protectedCustomerData && facts?.distribution === "public" && facts.protectedCustomerDataApproved === false) {
    return deny(
      trace,
      "protected_data",
      ERROR_CODES.PROTECTED_DATA_REQUIRED,
      `${effectiveName} reads or writes protected customer data. This app is not yet approved for protected customer data in the Partner Dashboard; request access (with a data-protection justification) before using customer or order tools.`,
      [],
      { protectedCustomerData: true },
    );
  }
  if (def.minApiVersion && facts?.apiVersion && facts.apiVersion.localeCompare(def.minApiVersion) < 0) {
    return deny(
      trace,
      "api_version",
      ERROR_CODES.API_VERSION_UNSUPPORTED,
      `${effectiveName} needs Shopify Admin API ${def.minApiVersion} or later; the server is configured for ${facts.apiVersion}. Set SHOPIFY_API_VERSION and restart.`,
      [{ tool: "commerce.api.capabilities", reason: "inspect version support" }],
      { minApiVersion: def.minApiVersion, apiVersion: facts.apiVersion },
    );
  }

  // 3. store capabilities
  trace.push("check:capabilities");
  for (const cap of def.requiredStoreCapabilities) {
    if (capabilities.has(cap)) continue;
    return deny(
      trace,
      "capability",
      ERROR_CODES.CAPABILITY_MISSING,
      `Store capability not available: ${cap}.`,
      [{ tool: "commerce.diagnostics", reason: "check store capability probes" }],
      { missingCapability: cap },
    );
  }

  // 4. tool / category disabled
  trace.push("check:disabled");
  const policy = resolvePolicy(credential.profile, credential.policy);
  if (policy[`tool.${def.name}`] === false) {
    return deny(trace, "tool_disabled", ERROR_CODES.POLICY_DENIED, `Tool "${def.name}" is disabled by policy.`);
  }
  if (policy[`category.${def.category}`] === false) {
    return deny(
      trace,
      "category_disabled",
      ERROR_CODES.POLICY_DENIED,
      `Category "${def.category}" is disabled by policy.`,
    );
  }

  // Escalation: compute the effective risk before the profile gate.
  const escalation = applyEscalation(def, input.input);
  const effectiveRisk = escalation.effectiveRisk;
  if (escalation.matchedRules.length > 0) {
    trace.push(`escalation:${escalation.matchedRules.join(",")} -> ${effectiveRisk}`);
  }

  // 5. profile risk gate (after escalation)
  trace.push("check:profile_risk_gate");
  if (!isRiskAllowedByProfile(credential.profile, effectiveRisk, effectiveName)) {
    return deny(
      trace,
      "profile_risk_gate",
      ERROR_CODES.PROFILE_DENIED,
      `Profile "${credential.profile}" does not allow risk class "${effectiveRisk}".`,
      [{ tool: "commerce.diagnostics", reason: "an admin profile credential can raise the safety profile" }],
      { profile: credential.profile, effectiveRisk },
    );
  }

  // 6. custom policy keys
  trace.push("check:custom_policy");
  if (escalation.policyKey && policy[escalation.policyKey] === false) {
    return deny(
      trace,
      `custom_policy:${escalation.policyKey}`,
      ERROR_CODES.POLICY_DENIED,
      `Policy key "${escalation.policyKey}" denies this operation.`,
      [],
      { policyKey: escalation.policyKey },
    );
  }
  if (effectiveRisk === "publish" && policy["theme.publish"] === false) {
    return deny(trace, "custom_policy:theme.publish", ERROR_CODES.POLICY_DENIED, `Policy key "theme.publish" denies this operation.`);
  }
  if (effectiveRisk === "destructive" && policy["delete"] === false) {
    return deny(trace, "custom_policy:delete", ERROR_CODES.POLICY_DENIED, `Policy key "delete" denies this operation.`);
  }

  // 7. confirm requirement
  trace.push("check:confirm");
  if (requiresConfirm(credential.profile, effectiveRisk, effectiveName)) {
    const confirmed = isRecord(input.input) && input.input["confirm"] === true;
    if (!confirmed) {
      return deny(
        trace,
        "confirm_required",
        ERROR_CODES.CONFIRM_REQUIRED,
        "This operation requires confirm: true.",
        [{ tool: effectiveName, reason: "retry with confirm: true", input: { ...toRecord(input.input), confirm: true } }],
      );
    }
  }

  let approval: PolicyApproval | undefined;

  // 8. approval token
  trace.push("check:approval_token");
  if (requiresApprovalToken(credential.profile, effectiveRisk)) {
    const result = await consumeApproval({ input, effectiveRisk, planHash, approvals, shopId, effectiveName, trace });
    if (!result.ok) return result.decision;
    approval = result.approval;
  }

  // 9. bulk threshold
  trace.push("check:bulk_threshold");
  if (typeof input.bulkCount === "number") {
    const maxResources = Number(policy["bulk.maxResources"] ?? 0);
    if (input.bulkCount > maxResources) {
      if (!approval) {
        const result = await consumeApproval({ input, effectiveRisk, planHash, approvals, shopId, effectiveName, trace });
        if (!result.ok) {
          if (result.decision.code === ERROR_CODES.APPROVAL_REQUIRED) {
            result.decision.details = { ...(result.decision.details ?? {}), bulkCount: input.bulkCount, maxResources };
          }
          return result.decision;
        }
        approval = result.approval;
      }
    }
  }

  trace.push("allowed");
  return approval
    ? { allowed: true, effectiveRisk, approval, trace }
    : { allowed: true, effectiveRisk, trace };
}

type ConsumeResult = { ok: true; approval: PolicyApproval } | { ok: false; decision: DenyDecision };

async function consumeApproval(args: {
  input: PolicyEvaluationInput;
  effectiveRisk: RiskClass;
  planHash: string;
  approvals: ApprovalService;
  shopId: string;
  effectiveName: string;
  trace: string[];
}): Promise<ConsumeResult> {
  const { input, planHash, approvals, shopId, effectiveName, trace } = args;
  const token = isRecord(input.input) ? (input.input["approvalToken"] as string | undefined) : undefined;

  if (!token) {
    return {
      ok: false,
      decision: deny(
        trace,
        "approval_required",
        ERROR_CODES.APPROVAL_REQUIRED,
        "An approval token is required for this operation.",
        [
          {
            tool: APPROVE_TOOL_NAME,
            reason: "approval token required",
            input: { tool: effectiveName, shopId, planHash },
          },
        ],
        { tool: effectiveName, shopId, planHash },
      ),
    };
  }

  const result = await approvals.consume({ token, shopId, tool: effectiveName, planHash });
  if (result.ok) {
    return { ok: true, approval: { kind: "approval_token", approvedBy: result.approvedBy } };
  }

  const codeByReason: Record<typeof result.reason, ErrorCode> = {
    invalid: ERROR_CODES.APPROVAL_INVALID,
    expired: ERROR_CODES.APPROVAL_INVALID,
    consumed: ERROR_CODES.APPROVAL_CONSUMED,
    mismatch: ERROR_CODES.APPROVAL_INVALID,
  };

  return {
    ok: false,
    decision: deny(
      trace,
      `approval_${result.reason}`,
      codeByReason[result.reason],
      `Approval token ${result.reason}.`,
      [
        {
          tool: APPROVE_TOOL_NAME,
          reason: `approval token ${result.reason}, request a new one`,
          input: { tool: effectiveName, shopId, planHash },
        },
      ],
      { reason: result.reason },
    ),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}
