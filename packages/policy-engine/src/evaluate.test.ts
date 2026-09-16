import { describe, expect, it } from "vitest";
import type { ApprovalService, Credential, ToolDefinition } from "@shopmanagerai/shared";
import { evaluate } from "./evaluate.js";
import { planHash } from "./planHash.js";

class FakeApprovalService implements ApprovalService {
  tokens = new Map<
    string,
    { shopId: string; tool: string; planHash: string; used: boolean; expiresAt: number; approvedBy: string }
  >();
  seq = 0;

  async issue(input: { shopId: string; tool: string; planHash: string; ttlMs?: number; issuedBy: string }) {
    const token = `tok_${++this.seq}`;
    this.tokens.set(token, {
      shopId: input.shopId,
      tool: input.tool,
      planHash: input.planHash,
      used: false,
      expiresAt: Date.now() + (input.ttlMs ?? 10 * 60 * 1000),
      approvedBy: input.issuedBy,
    });
    return { token, expiresAt: new Date(Date.now() + (input.ttlMs ?? 600000)).toISOString() };
  }

  async consume(input: { token: string; shopId: string; tool: string; planHash: string }) {
    const rec = this.tokens.get(input.token);
    if (!rec) return { ok: false as const, reason: "invalid" as const };
    if (rec.used) return { ok: false as const, reason: "consumed" as const };
    if (rec.expiresAt < Date.now()) return { ok: false as const, reason: "expired" as const };
    if (rec.shopId !== input.shopId || rec.tool !== input.tool || rec.planHash !== input.planHash) {
      return { ok: false as const, reason: "mismatch" as const };
    }
    rec.used = true;
    return { ok: true as const, approvedBy: rec.approvedBy };
  }

  /** Directly insert a token bypassing issue(), for expired/mismatch fixtures. */
  seed(token: string, rec: Partial<{ shopId: string; tool: string; planHash: string; used: boolean; expiresAt: number; approvedBy: string }>) {
    this.tokens.set(token, {
      shopId: "shop_1",
      tool: "t",
      planHash: "h",
      used: false,
      expiresAt: Date.now() + 600000,
      approvedBy: "admin@example.com",
      ...rec,
    });
  }
}

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    credentialId: "cred_1",
    shopId: "shop_1",
    shopDomain: "shop1.myshopify.com",
    kind: "oauth",
    label: "test",
    profile: "production_safe",
    policy: {},
    scopesGranted: ["read_products", "write_products"],
    ...overrides,
  };
}

function def(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "shopify.product.update_basic",
    version: "1.0.0",
    description: "Update basic product fields.",
    tier: "free",
    category: "product",
    riskClass: "write",
    executionPlane: "shopify_admin",
    requiredEntitlements: [],
    requiredShopifyScopes: ["write_products"],
    requiredStoreCapabilities: ["admin.write"],
    inputSchema: {} as any,
    outputSchema: {} as any,
    supportsDryRun: true,
    rollback: "ledger_before_image",
    supportsPagination: false,
    taskMode: "sync",
    idempotency: "none",
    timeoutMs: 30000,
    rateLimitCategory: "admin_write",
    audit: "always",
    approval: "none",
    dataCategories: { reads: [], writes: ["product"], stores: [], returnsToClient: [] },
    docs: { examples: [{ title: "Update title", input: { id: "1", title: "New" } }], failureModes: [], limitations: [] },
    handler: async () => {
      throw new Error("not used in policy tests");
    },
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof evaluate>[0]> = {}) {
  const approvals = overrides.approvals ?? new FakeApprovalService();
  const toolDef = overrides.def ?? def();
  const cred = overrides.credential ?? credential();
  const toolInput = overrides.input ?? { id: "1", title: "New" };
  return {
    def: toolDef,
    effectiveName: overrides.effectiveName ?? toolDef.name,
    credential: cred,
    tier: overrides.tier ?? "free",
    entitlements: overrides.entitlements ?? new Set<any>(),
    capabilities: overrides.capabilities ?? new Set<any>(["admin.write", "admin.read"]),
    input: toolInput,
    bulkCount: overrides.bulkCount,
    planHash: overrides.planHash ?? planHash(toolDef.name, cred.shopId, toolInput),
    approvals,
    shopId: overrides.shopId ?? cred.shopId,
    storeFacts: overrides.storeFacts,
  } as Parameters<typeof evaluate>[0];
}

describe("evaluate: entitlement", () => {
  it("denies with PRO_REQUIRED and upgrade details", async () => {
    const decision = await evaluate(
      baseInput({ def: def({ requiredEntitlements: ["pro.bulk"], description: "Bulk update products." }) }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.code).toBe("PRO_REQUIRED");
    expect(decision.rule).toBe("entitlement");
    expect(decision.details).toMatchObject({ feature: "shopify.product.update_basic", benefit: "Bulk update products." });
    expect(decision.details?.upgradeUrl).toContain("http");
    expect(decision.suggestedActions[0]?.tool).toBe("commerce.entitlements");
  });

  it("denies with AGENCY_REQUIRED for agency.* entitlements", async () => {
    const decision = await evaluate(baseInput({ def: def({ requiredEntitlements: ["agency.multi_store"] }) }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.code).toBe("AGENCY_REQUIRED");
  });

  it("passes when the entitlement is present", async () => {
    const decision = await evaluate(
      baseInput({ def: def({ requiredEntitlements: ["pro.bulk"] }), entitlements: new Set(["pro.bulk"]) }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("evaluate: scopes", () => {
  it("denies SCOPE_MISSING", async () => {
    const decision = await evaluate(
      baseInput({ credential: credential({ scopesGranted: ["read_products"] }) }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.code).toBe("SCOPE_MISSING");
    expect(decision.rule).toBe("scope");
  });
});

describe("evaluate: capabilities", () => {
  it("denies CAPABILITY_MISSING", async () => {
    const decision = await evaluate(baseInput({ capabilities: new Set(["admin.read"]) }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.code).toBe("CAPABILITY_MISSING");
    expect(decision.rule).toBe("capability");
  });
});

describe("evaluate: tool/category disabled", () => {
  it("denies when tool.<name> policy is false", async () => {
    const decision = await evaluate(
      baseInput({ credential: credential({ policy: { "tool.shopify.product.update_basic": false } }) }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.rule).toBe("tool_disabled");
  });

  it("denies when category.<category> policy is false", async () => {
    const decision = await evaluate(baseInput({ credential: credential({ policy: { "category.product": false } }) }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.rule).toBe("category_disabled");
  });
});

describe("evaluate: profile risk gate + escalation", () => {
  it("production_safe allows plain write", async () => {
    const decision = await evaluate(baseInput());
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error();
    expect(decision.effectiveRisk).toBe("write");
  });

  it("escalates to commerce_sensitive on a price field and denies under production_safe", async () => {
    const priceDef = def({
      escalation: [{ whenInputHas: ["price", "compareAtPrice"], toRisk: "commerce_sensitive", policyKey: "product.price.write" }],
    });
    const decision = await evaluate(baseInput({ def: priceDef, input: { id: "1", price: "19.99" } }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected denial");
    expect(decision.code).toBe("PROFILE_DENIED");
    expect(decision.rule).toBe("profile_risk_gate");
    expect(decision.details?.effectiveRisk).toBe("commerce_sensitive");
  });

  it("does not escalate when the price field is absent", async () => {
    const priceDef = def({
      escalation: [{ whenInputHas: ["price"], toRisk: "commerce_sensitive", policyKey: "product.price.write" }],
    });
    const decision = await evaluate(baseInput({ def: priceDef, input: { id: "1", title: "New" } }));
    expect(decision.allowed).toBe(true);
  });

  it("developer_full_access allows commerce_sensitive", async () => {
    const priceDef = def({
      escalation: [{ whenInputHas: ["price"], toRisk: "commerce_sensitive", policyKey: "product.price.write" }],
    });
    const decision = await evaluate(
      baseInput({ def: priceDef, credential: credential({ profile: "developer_full_access" }), input: { id: "1", price: "9.99" } }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("production_safe allows critical only for commerce.rollback.execute with confirm", async () => {
    const rollbackDef = def({ name: "commerce.rollback.execute", riskClass: "critical", requiredShopifyScopes: [], requiredStoreCapabilities: [] });
    const denied = await evaluate(baseInput({ def: rollbackDef, effectiveName: "commerce.rollback.execute", input: {} }));
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error();
    expect(denied.code).toBe("CONFIRM_REQUIRED");

    const allowed = await evaluate(baseInput({ def: rollbackDef, effectiveName: "commerce.rollback.execute", input: { confirm: true } }));
    expect(allowed.allowed).toBe(true);
  });
});

describe("evaluate: custom policy keys", () => {
  it("denies via the escalation policyKey", async () => {
    const priceDef = def({
      escalation: [{ whenInputHas: ["price"], toRisk: "write", policyKey: "product.price.write" }],
    });
    const decision = await evaluate(
      baseInput({
        def: priceDef,
        credential: credential({ policy: { "product.price.write": false } }),
        input: { id: "1", price: "9.99" },
      }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.rule).toBe("custom_policy:product.price.write");
  });

  it("denies theme.publish", async () => {
    const publishDef = def({ name: "shopify.theme.publish", riskClass: "publish", requiredShopifyScopes: [], requiredStoreCapabilities: [] });
    const decision = await evaluate(
      baseInput({
        def: publishDef,
        credential: credential({ profile: "developer_full_access", policy: { "theme.publish": false } }),
        input: { confirm: true },
      }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.rule).toBe("custom_policy:theme.publish");
  });
});

describe("evaluate: confirm requirement", () => {
  it("requires confirm for destructive under developer_full_access", async () => {
    const destructiveDef = def({ riskClass: "destructive", requiredShopifyScopes: [], requiredStoreCapabilities: [] });
    const cred = credential({ profile: "developer_full_access" });
    const denied = await evaluate(baseInput({ def: destructiveDef, credential: cred, input: { id: "1" } }));
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error();
    expect(denied.code).toBe("CONFIRM_REQUIRED");

    const allowed = await evaluate(baseInput({ def: destructiveDef, credential: cred, input: { id: "1", confirm: true } }));
    expect(allowed.allowed).toBe(true);
  });
});

describe("evaluate: approval token", () => {
  function publishDef() {
    return def({ name: "shopify.theme.publish", riskClass: "publish", requiredShopifyScopes: [], requiredStoreCapabilities: [] });
  }

  it("requires a token when none is provided", async () => {
    const cred = credential({ profile: "developer_full_access" });
    const decision = await evaluate(baseInput({ def: publishDef(), credential: cred, input: { confirm: true } }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.code).toBe("APPROVAL_REQUIRED");
    expect(decision.suggestedActions[0]?.tool).toBe("commerce.operation.approve");
  });

  it("accepts a valid token bound to the same plan hash", async () => {
    const cred = credential({ profile: "developer_full_access" });
    const approvals = new FakeApprovalService();
    const theDef = publishDef();
    const input = { confirm: true };
    const hash = planHash(theDef.name, cred.shopId, input);
    const { token } = await approvals.issue({ shopId: cred.shopId, credentialId: cred.credentialId, tool: theDef.name, planHash: hash, issuedBy: "admin@example.com" });

    const decision = await evaluate(
      baseInput({ def: theDef, credential: cred, approvals, input: { ...input, approvalToken: token }, planHash: hash }),
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error();
    expect(decision.approval).toEqual({ kind: "approval_token", approvedBy: "admin@example.com" });
  });

  it("rejects an expired token", async () => {
    const cred = credential({ profile: "developer_full_access" });
    const approvals = new FakeApprovalService();
    const theDef = publishDef();
    const input = { confirm: true };
    const hash = planHash(theDef.name, cred.shopId, input);
    approvals.seed("expired_tok", { shopId: cred.shopId, tool: theDef.name, planHash: hash, expiresAt: Date.now() - 1000 });

    const decision = await evaluate(
      baseInput({ def: theDef, credential: cred, approvals, input: { ...input, approvalToken: "expired_tok" }, planHash: hash }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.code).toBe("APPROVAL_INVALID");
  });

  it("rejects an already-consumed token", async () => {
    const cred = credential({ profile: "developer_full_access" });
    const approvals = new FakeApprovalService();
    const theDef = publishDef();
    const input = { confirm: true };
    const hash = planHash(theDef.name, cred.shopId, input);
    approvals.seed("used_tok", { shopId: cred.shopId, tool: theDef.name, planHash: hash, used: true });

    const decision = await evaluate(
      baseInput({ def: theDef, credential: cred, approvals, input: { ...input, approvalToken: "used_tok" }, planHash: hash }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.code).toBe("APPROVAL_CONSUMED");
  });

  it("rejects a token minted for a different plan (mismatch)", async () => {
    const cred = credential({ profile: "developer_full_access" });
    const approvals = new FakeApprovalService();
    const theDef = publishDef();
    const input = { confirm: true };
    const hash = planHash(theDef.name, cred.shopId, input);
    approvals.seed("mismatched_tok", { shopId: cred.shopId, tool: theDef.name, planHash: "some-other-hash" });

    const decision = await evaluate(
      baseInput({ def: theDef, credential: cred, approvals, input: { ...input, approvalToken: "mismatched_tok" }, planHash: hash }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.code).toBe("APPROVAL_INVALID");
  });
});

describe("evaluate: bulk threshold", () => {
  function bulkDef() {
    return def({ name: "shopify.products.bulk_update", riskClass: "bulk", requiredShopifyScopes: [], requiredStoreCapabilities: [] });
  }

  it("allows bulk under the default production_safe threshold (100)", async () => {
    const decision = await evaluate(baseInput({ def: bulkDef(), bulkCount: 50 }));
    expect(decision.allowed).toBe(true);
  });

  it("requires an approval token above the threshold", async () => {
    const decision = await evaluate(baseInput({ def: bulkDef(), bulkCount: 150 }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.code).toBe("APPROVAL_REQUIRED");
    expect(decision.details?.bulkCount).toBe(150);
    expect(decision.details?.maxResources).toBe(100);
  });

  it("respects a custom bulk.maxResources override", async () => {
    const decision = await evaluate(
      baseInput({ def: bulkDef(), bulkCount: 40, credential: credential({ policy: { "bulk.maxResources": 30 } }) }),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error();
    expect(decision.code).toBe("APPROVAL_REQUIRED");
  });

  it("succeeds above threshold once a matching approval token is consumed", async () => {
    const theDef = bulkDef();
    const cred = credential();
    const approvals = new FakeApprovalService();
    const input = { ids: Array.from({ length: 150 }, (_, i) => String(i)) };
    const hash = planHash(theDef.name, cred.shopId, input);
    const { token } = await approvals.issue({ shopId: cred.shopId, credentialId: cred.credentialId, tool: theDef.name, planHash: hash, issuedBy: "admin@example.com" });

    const decision = await evaluate(
      baseInput({ def: theDef, credential: cred, approvals, input: { ...input, approvalToken: token }, planHash: hash, bulkCount: 150 }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("evaluate: trace", () => {
  it("is populated on both success and denial", async () => {
    const allowed = await evaluate(baseInput());
    expect(allowed.trace.length).toBeGreaterThan(0);
    expect(allowed.trace.at(-1)).toBe("allowed");

    const denied = await evaluate(baseInput({ capabilities: new Set() }));
    expect(denied.trace.length).toBeGreaterThan(0);
    expect(denied.trace.at(-1)).toBe("deny:capability");
  });
});

describe("evaluate: platform gates (phase 1)", () => {
  it("explains a missing scope in terms of what is granted", async () => {
    const d = await evaluate(baseInput({ credential: credential({ scopesGranted: ["read_products"] }) }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("SCOPE_MISSING");
      expect(d.message).toMatch(/write_products/);
      expect(d.message).toMatch(/Granted for this resource: read_products/);
    }
  });
  it("denies Plus-only tools on non-Plus stores, allows them on Plus, ignores when plan unknown", async () => {
    const plusDef = def({ planRequirement: "plus" });
    const denied = await evaluate(baseInput({ def: plusDef, storeFacts: { plan: "Basic" } }));
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.code).toBe("PLAN_REQUIRED");
    expect((await evaluate(baseInput({ def: plusDef, storeFacts: { plan: "Shopify Plus" } }))).allowed).toBe(true);
    expect((await evaluate(baseInput({ def: plusDef }))).allowed).toBe(true);
  });
  it("denies protected-customer-data tools for unapproved public apps only", async () => {
    const pcd = def({ protectedCustomerData: true });
    const denied = await evaluate(baseInput({ def: pcd, storeFacts: { distribution: "public", protectedCustomerDataApproved: false } }));
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.code).toBe("PROTECTED_DATA_REQUIRED");
    expect((await evaluate(baseInput({ def: pcd, storeFacts: { distribution: "custom" } }))).allowed).toBe(true);
  });
  it("denies tools that need a newer API version than configured", async () => {
    const newer = def({ minApiVersion: "2026-10" });
    const denied = await evaluate(baseInput({ def: newer, storeFacts: { apiVersion: "2026-07" } }));
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.code).toBe("API_VERSION_UNSUPPORTED");
    expect((await evaluate(baseInput({ def: newer, storeFacts: { apiVersion: "2026-10" } }))).allowed).toBe(true);
  });
});
