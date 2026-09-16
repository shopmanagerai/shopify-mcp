/**
 * Safety profiles (docs/PRODUCT_ARCHITECTURE.md §5, ARCHITECTURE_REVIEW A1/A5/D4).
 *
 * - read_only: only `read` risk tools.
 * - production_safe: read, write, theme_write, bulk (subject to threshold).
 *   commerce_sensitive, destructive and publish are DENIED outright. `critical`
 *   is denied except for `commerce.rollback.execute` (rollback is a safety
 *   feature, not a destructive act) which still requires `confirm`.
 * - developer_full_access: everything allowed; destructive/publish/critical
 *   require `confirm`; publish/critical and bulk over threshold require an
 *   approval token.
 * - admin: same as developer, plus may call `commerce.operation.approve`.
 */
import { RISK_ORDER, type Profile, type RiskClass } from "@shopmanagerai/shared";

export const ROLLBACK_TOOL_NAME = "commerce.rollback.execute";
export const APPROVE_TOOL_NAME = "commerce.operation.approve";

/** Highest risk ordinal a profile may reach through the generic risk ladder. */
const PROFILE_MAX_RISK_ORDER: Record<Profile, number> = {
  read_only: RISK_ORDER.read,
  production_safe: RISK_ORDER.bulk,
  developer_full_access: RISK_ORDER.critical,
  admin: RISK_ORDER.critical,
};

/**
 * Whether `profile` is allowed to reach `risk` at all (before confirm/approval
 * checks, which are enforced separately by the policy engine). `toolName` is
 * needed for the `commerce.rollback.execute` exception under production_safe.
 */
export function isRiskAllowedByProfile(profile: Profile, risk: RiskClass, toolName?: string): boolean {
  const order = RISK_ORDER[risk];
  if (profile === "production_safe" && risk === "critical") {
    return toolName === ROLLBACK_TOOL_NAME;
  }
  return order <= PROFILE_MAX_RISK_ORDER[profile];
}

/** Whether `toolName` requires `confirm: true` in input under `profile`. */
export function requiresConfirm(profile: Profile, risk: RiskClass, toolName?: string): boolean {
  if (profile === "production_safe" && risk === "critical" && toolName === ROLLBACK_TOOL_NAME) return true;
  if (profile === "developer_full_access" || profile === "admin") {
    return risk === "destructive" || risk === "publish" || risk === "critical";
  }
  return false;
}

/** Whether `toolName` requires a consumed approval token under `profile`. */
export function requiresApprovalToken(profile: Profile, risk: RiskClass): boolean {
  if (profile === "developer_full_access" || profile === "admin") {
    return risk === "publish" || risk === "critical";
  }
  return false;
}

/** May this profile call `commerce.operation.approve` to mint approval tokens? */
export function canApprove(profile: Profile): boolean {
  return profile === "admin";
}

export const DEFAULT_BULK_MAX_RESOURCES: Record<Profile, number> = {
  read_only: 0,
  production_safe: 100,
  developer_full_access: 1000,
  admin: 1000,
};

export type PolicyOverrides = Record<string, boolean | number | string>;

/** Baseline policy overrides for a profile, before a credential's own overrides merge in. */
export function defaultPolicyFor(profile: Profile): PolicyOverrides {
  return {
    "bulk.maxResources": DEFAULT_BULK_MAX_RESOURCES[profile],
  };
}

/** Merge a credential's custom policy on top of the profile defaults. */
export function resolvePolicy(profile: Profile, overrides: PolicyOverrides | undefined): PolicyOverrides {
  return { ...defaultPolicyFor(profile), ...(overrides ?? {}) };
}
