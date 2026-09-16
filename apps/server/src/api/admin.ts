/**
 * Embedded-admin API (task brief §9, docs/ADMIN_API.md. Every route below).
 */
import { Hono } from "hono";
import { z } from "zod";
import { ShopManagerAIError, ERROR_CODES, isShopManagerAIError, newId, PRODUCT_VERSION, toShopManagerAIError, type Credential, type Entitlement } from "@shopmanagerai/shared";
import { computeCards, type AvailabilityContext } from "@shopmanagerai/tool-registry";
import { planHash as computePlanHash } from "@shopmanagerai/policy-engine";
import { CredentialRepo, type ShopRow } from "@shopmanagerai/storage";
import type { Container } from "../container.js";
import { verifyAdminSession } from "../auth/shopify.js";
import { grantedScopesFor } from "../shops/service.js";
import { buildClientConfigs } from "./client-configs.js";
import { executeTool, toMemoryRecord, type McpRequestCtx } from "../mcp/execute.js";
import type { MemoryType } from "@shopmanagerai/storage";

function errResponse(c: any, e: unknown) {
  const cpErr = isShopManagerAIError(e) ? e : toShopManagerAIError(e);
  return c.json({ ok: false, code: cpErr.code, message: cpErr.message }, cpErr.httpStatus as any);
}

async function requireShop(container: Container, c: any): Promise<ShopRow> {
  const session = await verifyAdminSession(container, c);
  if (!session) throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Not authenticated.", { httpStatus: 401 });
  const row = await container.shopService.getById(session.shopId);
  if (!row) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Shop not found.");
  return row;
}

function toClientCredential(row: Awaited<ReturnType<CredentialRepo["get"]>>) {
  if (!row) return null;
  return {
    credentialId: row.credentialId,
    kind: row.kind,
    label: row.label,
    profile: row.profile,
    policy: row.policy,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

async function buildAdminCredential(container: Container, shop: ShopRow, profile = "admin"): Promise<Credential> {
  return {
    credentialId: "admin_ui",
    shopId: shop.shopId,
    shopDomain: shop.domain,
    kind: "admin_ui",
    label: "Admin UI",
    profile: profile as Credential["profile"],
    policy: {},
    scopesGranted: await grantedScopesFor(container, shop.shopId),
  };
}

async function buildAdminReqCtx(container: Container, shop: ShopRow): Promise<McpRequestCtx> {
  const entitlementState = await container.entitlements.getState(shop.shopId);
  const planes = await container.shopService.planesFor(shop.shopId);
  return {
    credential: await buildAdminCredential(container, shop),
    shop: container.shopService.toSummary(shop),
    planes,
    tier: entitlementState.state === "AGENCY_ACTIVE" ? "agency" : entitlementState.state === "PRO_ACTIVE" ? "pro" : "free",
    entitlements: new Set<Entitlement>(entitlementState.entitlements),
    entitlementState: entitlementState.state,
    upgradeUrl: entitlementState.upgradeUrl,
    era: "modern",
  };
}

export function mountAdminApi(app: Hono, container: Container): void {
  const api = new Hono();

  api.get("/session", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const entitlementState = await container.entitlements.getState(shop.shopId);
      return c.json({
        shop: { domain: shop.domain, name: shop.name, plan: shop.plan },
        demo: container.config.demo,
        entitlement: { state: entitlementState.state, plan: entitlementState.plan, entitlements: entitlementState.entitlements, upgradeUrl: entitlementState.upgradeUrl },
        version: PRODUCT_VERSION,
      });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/connect", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const mcpUrl = `${container.config.appUrl}/mcp/${shop.domain}`;
      const flatMcpUrl = `${mcpUrl}?surface=flat`;
      // A revoked token stays in the table (audit trail) but must never be shown as live: the
      // Connect page's Revoke button only removed it from local React state, so it reappeared on
      // any reload/refetch because this endpoint returned every row including revoked ones.
      const tokens = (await container.credentials.listByShop(shop.shopId)).filter((t) => !t.revokedAt);
      return c.json({
        mcpUrl,
        flatMcpUrl,
        oauth: {
          authorizeUrl: `${container.config.appUrl}/oauth/authorize`,
          metadataUrl: `${container.config.appUrl}/.well-known/oauth-authorization-server`,
          cimdSupported: true,
        },
        tokens: tokens.map(toClientCredential),
        clientConfigs: buildClientConfigs(mcpUrl),
      });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const CreateTokenBody = z.object({
    label: z.string().min(1),
    profile: z.enum(["read_only", "production_safe", "developer_full_access", "admin"]),
    policy: z.record(z.union([z.boolean(), z.number(), z.string()])).optional(),
    expiresInDays: z.number().optional(),
  });

  api.post("/tokens", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const body = CreateTokenBody.parse(await c.req.json());
      const token = `cp_${newId()}`;
      const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86400000).toISOString() : null;
      const credential = await container.credentials.create({
        credentialId: newId("cred"),
        shopId: shop.shopId,
        kind: "token",
        label: body.label,
        profile: body.profile,
        policy: body.policy ?? {},
        token,
        expiresAt,
        scopes: await grantedScopesFor(container, shop.shopId),
      });
      const mcpUrl = `${container.config.appUrl}/mcp/${shop.domain}`;
      return c.json({ token, credential: toClientCredential(credential), clientConfigs: buildClientConfigs(mcpUrl, token) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/tokens/:credentialId", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const credentialId = c.req.param("credentialId");
      const row = await container.credentials.get(credentialId);
      if (!row || row.shopId !== shop.shopId) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown credential.");
      await container.credentials.revoke(credentialId);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const UpdateCredentialBody = z.object({
    profile: z.enum(["read_only", "production_safe", "developer_full_access", "admin"]).optional(),
    policy: z.record(z.union([z.boolean(), z.number(), z.string()])).optional(),
    label: z.string().optional(),
  });

  api.put("/credentials/:credentialId", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const credentialId = c.req.param("credentialId");
      const row = await container.credentials.get(credentialId);
      if (!row || row.shopId !== shop.shopId) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown credential.");
      const body = UpdateCredentialBody.parse(await c.req.json());
      // storage's CredentialRepo has no generic update(); re-create-in-place via db is out of scope for 0.1,
      // so persist via a targeted upsert using the existing repo surface (revoke+recreate keeps the token stable
      // only if callers avoid rotating tokens on profile/policy edits, which the admin UI does).
      await container.db
        .updateTable("credentials")
        .set({
          profile: body.profile ?? row.profile,
          policy_json: JSON.stringify(body.policy ?? row.policy),
          label: body.label ?? row.label,
        })
        .where("credential_id", "=", credentialId)
        .execute();
      const updated = await container.credentials.get(credentialId);
      return c.json({ credential: toClientCredential(updated) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/theme-access", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const configured = await container.secrets.has(shop.shopId, "theme_access");
      const cached = await container.capabilities.get(shop.shopId);
      const caps = new Set(cached?.capabilities ?? []);
      let last4: string | undefined;
      if (configured) {
        const pw = await container.secrets.get(shop.shopId, "theme_access");
        last4 = pw ? pw.slice(-4) : undefined;
      }
      return c.json({
        configured,
        last4,
        engineA: container.config.demo ? "ok" : caps.has("theme.engine_a") ? "ok" : configured ? "invalid" : "missing",
        engineB: caps.has("theme.engine_b") ? "ok" : "unknown",
        demo: container.config.demo,
      });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/theme-access", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const { password } = z.object({ password: z.string().min(1) }).parse(await c.req.json());
      await container.secrets.set(shop.shopId, "theme_access", password);
      container.shopService.invalidate(shop.shopId);
      await container.shopService.probe(shop.shopId);
      const pw = await container.secrets.get(shop.shopId, "theme_access");
      return c.json({ configured: true, last4: pw?.slice(-4) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/theme-access", async (c) => {
    try {
      const shop = await requireShop(container, c);
      await container.secrets.delete(shop.shopId, "theme_access");
      container.shopService.invalidate(shop.shopId);
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/tools", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const profileParam = (c.req.query("profile") as Credential["profile"]) ?? "production_safe";
      const entitlementState = await container.entitlements.getState(shop.shopId);
      const planes = await container.shopService.planesFor(shop.shopId);
      const settings = (shop.settings ?? {}) as { disabledTools?: string[] };
      const policy: Record<string, boolean> = {};
      for (const name of settings.disabledTools ?? []) policy[`tool.${name}`] = false;
      const availCtx: AvailabilityContext = {
        tier: entitlementState.state === "AGENCY_ACTIVE" ? "agency" : entitlementState.state === "PRO_ACTIVE" ? "pro" : "free",
        entitlements: new Set(entitlementState.entitlements),
        profile: profileParam,
        scopesGranted: new Set(await grantedScopesFor(container, shop.shopId)),
        capabilities: planes.capabilities,
        policy,
      };
      const cards = computeCards(container.registry, availCtx);
      return c.json({ cards, disabled: settings.disabledTools ?? [] });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/tools/:name", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const name = c.req.param("name");
      const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
      const settings = (shop.settings ?? {}) as { disabledTools?: string[] };
      const disabled = new Set(settings.disabledTools ?? []);
      if (enabled) disabled.delete(name);
      else disabled.add(name);
      await container.shops.upsert({ shopId: shop.shopId, domain: shop.domain, settings: { ...settings, disabledTools: Array.from(disabled) } });
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/policy/profiles", async (c) => {
    return c.json({
      profiles: [
        { id: "read_only", label: "Read Only", description: "Read-only tools.", allowedRisks: ["read"] },
        { id: "production_safe", label: "Production Safe", description: "Reads and safe writes; no publish/destructive.", allowedRisks: ["read", "write", "theme_write", "bulk"] },
        { id: "developer_full_access", label: "Developer Full Access", description: "Everything, with confirm/approval gates.", allowedRisks: ["read", "write", "theme_write", "bulk", "commerce_sensitive", "destructive", "publish", "critical"] },
        { id: "admin", label: "Admin", description: "Same as developer, plus may approve operations.", allowedRisks: ["read", "write", "theme_write", "bulk", "commerce_sensitive", "destructive", "publish", "critical"] },
      ],
      policyKeys: [
        { key: "bulk.maxResources", type: "number", default: 100, description: "Max resources per bulk operation before an approval token is required." },
        { key: "theme.publish", type: "boolean", default: true, description: "Allow theme publish." },
        { key: "delete", type: "boolean", default: true, description: "Allow destructive deletes." },
      ],
    });
  });

  api.get("/operations", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const { items, nextCursor } = await container.ledger.list(shop.shopId, {
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
        cursor: c.req.query("cursor") ?? undefined,
        tool: c.req.query("tool") ?? undefined,
        status: (c.req.query("status") as any) ?? undefined,
      });
      return c.json({ items, nextCursor });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/operations/:id", async (c) => {
    try {
      await requireShop(container, c);
      const operation = await container.ledger.get(c.req.param("id"));
      if (!operation) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown operation.");
      const rollbackPlan = await container.rollback.plan(operation.operationId);
      return c.json({ operation, rollbackPlan });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/operations/:id/rollback", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const { confirm, force } = z.object({ confirm: z.literal(true), force: z.boolean().optional() }).parse(await c.req.json());
      if (!confirm) throw new ShopManagerAIError(ERROR_CODES.CONFIRM_REQUIRED, "confirm: true is required.");
      const planes = await container.shopService.planesFor(shop.shopId);
      const operation = await container.rollback.execute(c.req.param("id"), { theme: planes.theme, verifyFingerprints: true, force, executedBy: "merchant" });
      return c.json({ operation });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/snapshots", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const items = await container.snapshots.list(shop.shopId, { kind: (c.req.query("kind") as any) ?? undefined });
      return c.json({ items });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/snapshots", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const body = z.object({ label: z.string().optional(), themeId: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
      const planes = await container.shopService.planesFor(shop.shopId);
      if (!planes.theme) throw new ShopManagerAIError(ERROR_CODES.THEME_ENGINE_UNAVAILABLE, "No theme engine configured.");
      const themeId = body.themeId ?? (await planes.workingTheme.ensure()).id;
      const files = await planes.theme.listFiles(themeId);
      const fullFiles = await planes.theme.readFiles(themeId, files.map((f) => f.key));
      const snapshot = await container.snapshots.createThemeSnapshot(shop.shopId, themeId, fullFiles, { label: body.label ?? `Manual snapshot ${new Date().toISOString()}`, createdBy: "merchant" });
      return c.json({ snapshot });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/theme", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const planes = await container.shopService.planesFor(shop.shopId);
      if (!planes.theme) return c.json({ live: null, working: null });
      const live = await planes.workingTheme.live().catch(() => null);
      const working = await planes.workingTheme.current();
      return c.json({ live, working });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/theme/working/ensure", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const planes = await container.shopService.planesFor(shop.shopId);
      if (!planes.theme) throw new ShopManagerAIError(ERROR_CODES.THEME_ENGINE_UNAVAILABLE, "No theme engine configured.");
      const working = await planes.workingTheme.ensure();
      return c.json({ working });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/approvals", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const { tool, input } = z.object({ tool: z.string(), input: z.record(z.unknown()).default({}) }).parse(await c.req.json());
      const hash = computePlanHash(tool, shop.shopId, input);
      const { token, expiresAt } = await container.approvals.issue({ shopId: shop.shopId, credentialId: "admin_ui", tool, planHash: hash, issuedBy: "merchant" });
      return c.json({ token, expiresAt, planHash: hash });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/theme/publish", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const { themeId, confirm } = z.object({ themeId: z.string(), confirm: z.literal(true) }).parse(await c.req.json());
      const reqCtx = await buildAdminReqCtx(container, shop);
      const input = { themeId, confirm };
      const hash = computePlanHash("shopify.theme.publish", shop.shopId, input);
      const { token } = await container.approvals.issue({ shopId: shop.shopId, credentialId: "admin_ui", tool: "shopify.theme.publish", planHash: hash, issuedBy: "merchant" });
      const operation = await executeTool(container, reqCtx, "shopify.theme.publish", { ...input, approvalToken: token });
      return c.json({ operation });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/apps", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      // Run the same Free tools the MCP surface exposes, under the admin-UI credential.
      const scan = await executeTool(container, reqCtx, "shopify.apps.scan", {});
      const manifest = await executeTool(container, reqCtx, "shopify.apps.preservation_manifest_basic", {});
      const detected = scan.ok ? ((scan.data as { apps?: unknown[] }).apps ?? []) : [];
      const preservation = manifest.ok ? ((manifest.data as { preservationManifest?: unknown[] }).preservationManifest ?? []) : [];
      return c.json({ detected, preservation, warnings: [...(scan.ok ? scan.warnings : [scan.message]), ...(manifest.ok ? manifest.warnings : [manifest.message])] });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/diagnostics", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const planes = await container.shopService.planesFor(shop.shopId);
      type CheckStatus = "ok" | "warn" | "fail" | "skip";
      const checks: Array<{ id: string; label: string; status: CheckStatus; detail?: string }> = [
        { id: "database", label: "Database", status: "ok" },
        { id: "admin_api", label: "Shopify Admin API", status: planes.admin ? "ok" : "skip", detail: planes.admin ? undefined : "Not connected." },
        { id: "theme_engine", label: "Theme engine", status: planes.theme ? "ok" : "warn", detail: planes.theme ? undefined : "No theme engine available." },
        { id: "browser", label: "Visual capture", status: planes.browser ? "ok" : "skip" },
        { id: "tools_package", label: "@shopmanagerai/tools", status: container.toolsFallback ? "warn" : "ok", detail: container.toolsFallback ? "Using the local fallback registry." : undefined },
      ];
      return c.json({ checks });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const PrivacyShape = z.object({
    retainSnapshotsDays: z.number(),
    retainScreenshotsDays: z.number(),
    retainLedgerDays: z.number(),
    twinStoresContent: z.boolean(),
    telemetry: z.boolean(),
  });
  const DEFAULT_PRIVACY = { retainSnapshotsDays: 90, retainScreenshotsDays: 30, retainLedgerDays: 365, twinStoresContent: true, telemetry: false };

  api.get("/privacy", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const settings = (shop.settings ?? {}) as { privacy?: z.infer<typeof PrivacyShape> };
      return c.json(settings.privacy ?? DEFAULT_PRIVACY);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/privacy", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const body = PrivacyShape.parse(await c.req.json());
      const settings = (shop.settings ?? {}) as Record<string, unknown>;
      await container.shops.upsert({ shopId: shop.shopId, domain: shop.domain, settings: { ...settings, privacy: body } });
      return c.json(body);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  interface MergedSkillRow {
    name: string;
    title: string;
    description: string;
    tier: string;
    body: string;
    source: "builtin" | "custom";
    enabled: boolean;
    updatedAt: string;
  }

  async function mergedSkillsForShop(shopId: string): Promise<MergedSkillRow[]> {
    const builtins: MergedSkillRow[] = container.skills.map((s) => ({ name: s.name, title: s.title, description: s.description, tier: s.tier, body: (s as { body?: string }).body ?? s.description, source: "builtin", enabled: true, updatedAt: "" }));
    const custom = await container.skillRepo.list(shopId);
    const byName = new Map(builtins.map((s) => [s.name, s]));
    for (const row of custom) byName.set(row.name, { name: row.name, title: row.title, description: row.description, tier: row.tier, body: row.body, source: row.source, enabled: row.enabled, updatedAt: row.updatedAt });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  api.get("/skills", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const merged = await mergedSkillsForShop(shop.shopId);
      return c.json({ skills: merged.map(({ body, ...rest }) => rest) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/skills/:name", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const merged = await mergedSkillsForShop(shop.shopId);
      const skill = merged.find((s) => s.name === c.req.param("name"));
      if (!skill) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown skill.");
      return c.json({ skill });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  const SkillWriteBody = z.object({ name: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1), description: z.string().min(1), tier: z.string().optional(), body: z.string().min(1).max(32 * 1024) });

  api.post("/skills", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const body = SkillWriteBody.parse(await c.req.json());
      const row = await container.skillRepo.upsert({ shopId: shop.shopId, ...body, source: "custom" });
      return c.json({ skill: { name: row.name, title: row.title, description: row.description, tier: row.tier, body: row.body, source: row.source, enabled: row.enabled, updatedAt: row.updatedAt } });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/skills/:name", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const name = c.req.param("name");
      const patch = SkillWriteBody.omit({ name: true }).partial({ tier: true }).extend({ title: z.string().min(1), description: z.string().min(1), body: z.string().min(1).max(32 * 1024) }).parse(await c.req.json());
      const row = await container.skillRepo.upsert({ shopId: shop.shopId, name, ...patch, source: "custom" });
      return c.json({ skill: { name: row.name, title: row.title, description: row.description, tier: row.tier, body: row.body, source: row.source, enabled: row.enabled, updatedAt: row.updatedAt } });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/skills/:name", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const deleted = await container.skillRepo.delete(shop.shopId, c.req.param("name"));
      if (!deleted) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown custom skill (built-in skills cannot be deleted; disable them instead).");
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/skills/:name/enabled", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const name = c.req.param("name");
      const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
      let row = await container.skillRepo.setEnabled(shop.shopId, name, enabled);
      if (!row) {
        // No custom row yet for a built-in skill, create a disabled/enabled override copy so
        // the enabled flag has somewhere to live without duplicating the built-in body.
        const builtin = container.skills.find((s) => s.name === name);
        if (!builtin) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown skill.");
        row = await container.skillRepo.upsert({
          shopId: shop.shopId,
          name: builtin.name,
          title: builtin.title,
          description: builtin.description,
          tier: builtin.tier,
          body: (builtin as { body?: string }).body ?? builtin.description,
          source: "builtin",
          enabled,
        });
      }
      return c.json({ skill: { name: row.name, title: row.title, description: row.description, tier: row.tier, source: row.source, enabled: row.enabled, updatedAt: row.updatedAt } });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/design/manifests", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const result = await executeTool(container, reqCtx, "shopify.design.list_manifests", {});
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/design/manifests/active", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const result = await executeTool(container, reqCtx, "shopify.design.get_manifest", {});
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data ?? {});
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/design/manifests/:id", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const result = await executeTool(container, reqCtx, "shopify.design.get_manifest", { manifestId: c.req.param("id") });
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data ?? {});
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/design/manifests/extract", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const body = z.object({ themeId: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
      const result = await executeTool(container, reqCtx, "shopify.design.extract_manifest", body);
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/design/manifests", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const body = z.object({ name: z.string(), manifest: z.record(z.unknown()) }).parse(await c.req.json());
      const result = await executeTool(container, reqCtx, "shopify.design.create_manifest", body);
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/design/manifests/:id", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const body = z.object({ patch: z.record(z.unknown()) }).parse(await c.req.json());
      const result = await executeTool(container, reqCtx, "shopify.design.update_manifest", { manifestId: c.req.param("id"), patch: body.patch });
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/design/manifests/:id/activate", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const result = await executeTool(container, reqCtx, "shopify.design.set_active_manifest", { manifestId: c.req.param("id") });
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/design/manifests/:id/markdown", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const result = await executeTool(container, reqCtx, "shopify.design.export_markdown", { manifestId: c.req.param("id") });
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, result.code === "NOT_FOUND" ? 404 : 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/design/manifests/import", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const body = z.object({ markdown: z.string().min(1), name: z.string().optional(), activate: z.boolean().optional() }).parse(await c.req.json());
      const result = await executeTool(container, reqCtx, "shopify.design.import_markdown", body);
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/design/manifests/validate", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const body = z.object({ manifest: z.record(z.unknown()) }).parse(await c.req.json());
      const result = await executeTool(container, reqCtx, "shopify.design.validate_manifest", body);
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---------------------------------------------------------------------
  // Design Pro: anti-generic audit (runs shopify.design.anti_generic_audit
  // under the admin credential so the Design screen can surface findings
  // without the caller needing an MCP client).
  // ---------------------------------------------------------------------
  api.post("/design/anti-generic", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const body = z.object({ themeId: z.string().optional(), manifestId: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
      const result = await executeTool(container, reqCtx, "shopify.design.anti_generic_audit", body);
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---------------------------------------------------------------------
  // Store orchestration: job records + Markdown/JSON report export
  // (shopify.store.build/redesign/audit/repair persist a job under
  // kv "job:<shopId>:<jobId>"; these routes let the admin UI list/read them
  // and export a finished job as a report without an MCP client).
  // ---------------------------------------------------------------------
  api.get("/jobs", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const rows = await container.kv.listByPrefix<Record<string, unknown>>(`job:${shop.shopId}:`);
      const jobs = rows
        .map((r) => r.value)
        .filter((v): v is Record<string, unknown> => !!v)
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      return c.json({ jobs });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/jobs/:jobId", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const result = await executeTool(container, reqCtx, "shopify.store.job_status", { jobId: c.req.param("jobId") });
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, result.code === "NOT_FOUND" ? 404 : 400);
      return c.json(result.data);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/reports/:jobId/export", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const reqCtx = await buildAdminReqCtx(container, shop);
      const format = c.req.query("format") === "markdown" ? "markdown" : "json";
      const result = await executeTool(container, reqCtx, "commerce.export", { kind: "report", id: c.req.param("jobId"), format });
      if (!result.ok) return c.json({ ok: false, code: result.code, message: result.message }, result.code === "NOT_FOUND" ? 404 : 400);
      const data = result.data as { document: unknown; format: string };
      if (format === "markdown") return c.text(String(data.document), 200, { "Content-Type": "text/markdown; charset=utf-8" });
      return c.json(data.document as Record<string, unknown>);
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---------------------------------------------------------------------
  // Connections (the original WordPress plugin includes/connections.php port): which AI clients
  // have actually reached the MCP endpoint for this shop, and how much.
  // ---------------------------------------------------------------------
  api.get("/connections", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const rows = await container.connections.list(shop.shopId);
      return c.json({ connections: rows });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/connections/:id", async (c) => {
    try {
      await requireShop(container, c);
      const deleted = await container.connections.forget(c.req.param("id"));
      if (!deleted) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown connection.");
      return c.json({ ok: true });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/connections/forget-stale", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const existingIds = new Set((await container.credentials.listByShop(shop.shopId)).filter((r) => !r.revokedAt).map((r) => r.credentialId));
      const removed = await container.connections.forgetStale(shop.shopId, existingIds);
      return c.json({ removed });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // ---------------------------------------------------------------------
  // Memory (the original Pro plugin the original memory abilities port): persistent,
  // database-backed memories, plus the shop-level enable/disable flag.
  // ---------------------------------------------------------------------
  const MemoryWriteBody = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(["user", "feedback", "project", "reference", "design"]),
    content: z.string().min(1).max(32 * 1024),
  });

  async function requireOwnedMemory(shopId: string, id: string) {
    const existing = await container.memory.get(id);
    if (!existing || existing.shopId !== shopId) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown memory.");
    return existing;
  }

  api.get("/memory", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const type = c.req.query("type") as MemoryType | undefined;
      const rows = await container.memory.list(shop.shopId, type);
      return c.json({ memories: rows.map(toMemoryRecord) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/memory", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const body = MemoryWriteBody.parse(await c.req.json());
      const row = await container.memory.save({ shopId: shop.shopId, name: body.name, description: body.description, type: body.type, content: body.content, createdBy: "admin_ui" });
      return c.json({ memory: toMemoryRecord(row) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  // Registered before "/memory/:id" so "settings" is never captured as an :id param.
  api.get("/memory/settings", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const settings = (shop.settings ?? {}) as { memory?: { enabled?: boolean } };
      return c.json({ enabled: settings.memory?.enabled !== false });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/memory/settings", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
      const settings = (shop.settings ?? {}) as Record<string, unknown>;
      await container.shops.upsert({ shopId: shop.shopId, domain: shop.domain, settings: { ...settings, memory: { ...(settings.memory as Record<string, unknown> | undefined), enabled } } });
      return c.json({ enabled });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.put("/memory/:id", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const id = c.req.param("id");
      await requireOwnedMemory(shop.shopId, id);
      const body = MemoryWriteBody.parse(await c.req.json());
      const row = await container.memory.save({ memoryId: id, shopId: shop.shopId, name: body.name, description: body.description, type: body.type, content: body.content, createdBy: "admin_ui" });
      return c.json({ memory: toMemoryRecord(row) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.delete("/memory/:id", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const id = c.req.param("id");
      await requireOwnedMemory(shop.shopId, id);
      const deleted = await container.memory.delete(id);
      return c.json({ ok: deleted });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.get("/memory/:id/versions", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const id = c.req.param("id");
      await requireOwnedMemory(shop.shopId, id);
      const versions = await container.memory.versions(id);
      return c.json({ versions });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  api.post("/memory/:id/restore", async (c) => {
    try {
      const shop = await requireShop(container, c);
      const id = c.req.param("id");
      await requireOwnedMemory(shop.shopId, id);
      const { version } = z.object({ version: z.number().int().positive() }).parse(await c.req.json());
      const restored = await container.memory.restore(id, version, "admin_ui");
      if (!restored) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Unknown version.");
      return c.json({ memory: toMemoryRecord(restored) });
    } catch (e) {
      return errResponse(c, e);
    }
  });

  app.route("/api/admin", api);
}
