import { describe, expect, it } from "vitest";
import { RISK_CLASSES, type Profile, type RiskClass } from "@shopmanagerai/shared";
import {
  canApprove,
  defaultPolicyFor,
  isRiskAllowedByProfile,
  requiresApprovalToken,
  requiresConfirm,
  resolvePolicy,
  ROLLBACK_TOOL_NAME,
} from "./profiles.js";

const PROFILES: Profile[] = ["read_only", "production_safe", "developer_full_access", "admin"];

describe("isRiskAllowedByProfile matrix", () => {
  const expected: Record<Profile, Partial<Record<RiskClass, boolean>>> = {
    read_only: {
      read: true,
      write: false,
      theme_write: false,
      bulk: false,
      commerce_sensitive: false,
      destructive: false,
      publish: false,
      critical: false,
    },
    production_safe: {
      read: true,
      write: true,
      theme_write: true,
      bulk: true,
      commerce_sensitive: false,
      destructive: false,
      publish: false,
      critical: false,
    },
    developer_full_access: {
      read: true,
      write: true,
      theme_write: true,
      bulk: true,
      commerce_sensitive: true,
      destructive: true,
      publish: true,
      critical: true,
    },
    admin: {
      read: true,
      write: true,
      theme_write: true,
      bulk: true,
      commerce_sensitive: true,
      destructive: true,
      publish: true,
      critical: true,
    },
  };

  for (const profile of PROFILES) {
    for (const risk of RISK_CLASSES) {
      it(`${profile} x ${risk}`, () => {
        expect(isRiskAllowedByProfile(profile, risk)).toBe(expected[profile][risk]);
      });
    }
  }

  it("production_safe allows critical only for commerce.rollback.execute", () => {
    expect(isRiskAllowedByProfile("production_safe", "critical", ROLLBACK_TOOL_NAME)).toBe(true);
    expect(isRiskAllowedByProfile("production_safe", "critical", "shopify.theme.publish")).toBe(false);
  });
});

describe("requiresConfirm", () => {
  it("production_safe requires confirm only for the rollback exception", () => {
    expect(requiresConfirm("production_safe", "critical", ROLLBACK_TOOL_NAME)).toBe(true);
    expect(requiresConfirm("production_safe", "write")).toBe(false);
  });

  it("developer_full_access requires confirm for destructive/publish/critical", () => {
    expect(requiresConfirm("developer_full_access", "destructive")).toBe(true);
    expect(requiresConfirm("developer_full_access", "publish")).toBe(true);
    expect(requiresConfirm("developer_full_access", "critical")).toBe(true);
    expect(requiresConfirm("developer_full_access", "bulk")).toBe(false);
  });
});

describe("requiresApprovalToken", () => {
  it("requires a token for publish/critical under developer and admin", () => {
    expect(requiresApprovalToken("developer_full_access", "publish")).toBe(true);
    expect(requiresApprovalToken("admin", "critical")).toBe(true);
    expect(requiresApprovalToken("developer_full_access", "bulk")).toBe(false);
    expect(requiresApprovalToken("production_safe", "publish")).toBe(false);
  });
});

describe("canApprove", () => {
  it("only admin may approve", () => {
    expect(canApprove("admin")).toBe(true);
    expect(canApprove("developer_full_access")).toBe(false);
  });
});

describe("defaultPolicyFor / resolvePolicy", () => {
  it("sets bulk.maxResources per profile (ARCHITECTURE_REVIEW D4)", () => {
    expect(defaultPolicyFor("production_safe")["bulk.maxResources"]).toBe(100);
    expect(defaultPolicyFor("developer_full_access")["bulk.maxResources"]).toBe(1000);
  });

  it("credential overrides win over profile defaults", () => {
    const resolved = resolvePolicy("production_safe", { "bulk.maxResources": 25, "product.price.write": false });
    expect(resolved["bulk.maxResources"]).toBe(25);
    expect(resolved["product.price.write"]).toBe(false);
  });
});
