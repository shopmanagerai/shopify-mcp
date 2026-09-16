import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { buildContainer, type Container } from "./container.js";
import { buildApp } from "./app.js";
import type { Hono } from "hono";

let container: Container;
let app: Hono;
let dataDir: string;

async function setup(env: Record<string, string> = {}) {
  dataDir = mkdtempSync(join(tmpdir(), "sm-account-"));
  const config = loadConfig({ SHOPMANAGER_DEMO: "1", DATA_DIR: dataDir, APP_URL: "http://localhost:3000", EMAIL_PROVIDER: "console", ...env } as any);
  container = await buildContainer(config, { dbPath: ":memory:" });
  await container.shopService.ensureDemoShop();
  app = buildApp(container);
}

afterEach(() => {
  container?.closeDb();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function signIn(email: string): Promise<string> {
  const login = await app.request("/api/account/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  expect(login.status).toBe(200);
  const body = (await login.json()) as { devLink: string };
  expect(body.devLink).toMatch(/\/app\/auth\/verify\?token=/);
  const verify = await app.request(new URL(body.devLink).pathname + new URL(body.devLink).search, { redirect: "manual" });
  expect(verify.status).toBe(302);
  expect(verify.headers.get("location")).toBe("/app");
  const cookie = verify.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/^sm_session=/);
  expect(cookie).toMatch(/HttpOnly/);
  return cookie.split(";")[0]!;
}

const json = (cookie: string, body?: unknown, method = body ? "POST" : "GET") => ({
  method,
  headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

describe("account layer", () => {
  it("magic link creates the user, sets a session cookie, and /me works", async () => {
    await setup();
    const cookie = await signIn("Owner@Example.com");
    const me = await app.request("/api/account/me", json(cookie));
    expect(me.status).toBe(200);
    const body = (await me.json()) as any;
    expect(body.user.email).toBe("owner@example.com"); // normalised
    expect(body.plan.state).toBe("FREE");
    expect(body.shops).toEqual([]);
  });

  it("rejects a reused or bogus link and an unauthenticated /me", async () => {
    await setup();
    const login = await app.request("/api/account/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.co" }) });
    const { devLink } = (await login.json()) as { devLink: string };
    const path = new URL(devLink).pathname + new URL(devLink).search;
    expect((await app.request(path, { redirect: "manual" })).status).toBe(302);
    const again = await app.request(path, { redirect: "manual" });
    expect(again.headers.get("location")).toBe("/app/login?error=link");
    expect((await app.request("/api/account/me")).status).toBe(401);
    expect((await app.request("/api/account/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nope" }) })).status).toBe(400);
  });

  it("links a store, mints a token that works on /mcp, revokes it, and unlinks", async () => {
    await setup();
    const cookie = await signIn("merchant@example.com");
    const connect = await app.request("/api/account/shops/connect", json(cookie, { shop: "demo" }));
    expect(connect.status).toBe(200);
    const { shop } = (await connect.json()) as { shop: string };
    const me = (await (await app.request("/api/account/me", json(cookie))).json()) as any;
    expect(me.shops).toHaveLength(1);
    const shopId = me.shops[0].shopId as string;
    expect(me.shops[0].entitlement).toBe("FREE");

    const created = await app.request(`/api/account/shops/${shopId}/tokens`, json(cookie, { label: "Claude Code", profile: "production_safe" }));
    expect(created.status).toBe(200);
    const tok = (await created.json()) as { token: string; credential: { credentialId: string }; clientConfigs: { claudeCode: string } };
    expect(tok.token).toMatch(/^cp_/);
    expect(tok.clientConfigs.claudeCode).toContain(tok.token);

    const mcp = await app.request(`/mcp/${shop}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }),
    });
    expect(mcp.status).toBe(200);

    const detail = (await (await app.request(`/api/account/shops/${shopId}`, json(cookie))).json()) as any;
    expect(detail.tokens).toHaveLength(1);
    expect(detail.clientConfigs.cursor).toContain("<TOKEN>");

    expect((await app.request(`/api/account/shops/${shopId}/tokens/${tok.credential.credentialId}`, json(cookie, undefined, "DELETE"))).status).toBe(200);
    const after = await app.request(`/mcp/${shop}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }),
    });
    expect(after.status).toBe(401);

    expect((await app.request(`/api/account/shops/${shopId}`, json(cookie, undefined, "DELETE"))).status).toBe(200);
    const me2 = (await (await app.request("/api/account/me", json(cookie))).json()) as any;
    expect(me2.shops).toEqual([]);
  });

  it("another account cannot see or touch my store", async () => {
    await setup();
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    await app.request("/api/account/shops/connect", json(a, { shop: "demo" }));
    const meA = (await (await app.request("/api/account/me", json(a))).json()) as any;
    const shopId = meA.shops[0].shopId as string;
    expect((await app.request(`/api/account/shops/${shopId}`, json(b))).status).toBe(404);
    expect((await app.request(`/api/account/shops/${shopId}/tokens`, json(b, { label: "x", profile: "admin" }))).status).toBe(404);
  });

  it("account plan projects onto shop entitlements through seats, and a Free account cannot assign one", async () => {
    await setup();
    const cookie = await signIn("agency@example.com");
    await app.request("/api/account/shops/connect", json(cookie, { shop: "demo" }));
    const me = (await (await app.request("/api/account/me", json(cookie))).json()) as any;
    const shopId = me.shops[0].shopId as string;
    expect((await app.request(`/api/account/shops/${shopId}/seat`, json(cookie, { pro: true }))).status).toBe(403);

    // Simulate the Freemius webhook outcome for this account (license bound to account_id).
    const handled = await container.accounts.applyWebhookOutcome({ accountId: me.user.userId, licenseId: "lic_1", plan: { slug: "agency" }, seats: 3 }, "AGENCY_ACTIVE", null);
    expect(handled).toBe(true);
    const me2 = (await (await app.request("/api/account/me", json(cookie))).json()) as any;
    expect(me2.plan.state).toBe("AGENCY_ACTIVE");
    expect(me2.seats).toEqual({ used: 1, total: 3 }); // auto-assigned to the one linked shop
    expect(me2.shops[0].proSeat).toBe(true);
    expect(me2.shops[0].entitlement).toBe("AGENCY_ACTIVE");
    const row = await container.entitlementRepo.get(shopId);
    expect(row?.freemiusUserId).toBe(`account:${me.user.userId}`);

    // Releasing the seat downgrades the shop row this account manages.
    expect((await app.request(`/api/account/shops/${shopId}/seat`, json(cookie, { pro: false }))).status).toBe(200);
    expect((await container.entitlementRepo.get(shopId))?.state).toBe("FREE");

    // Expiry keeps a 72h grace window then drops to FREE.
    await container.accounts.applyWebhookOutcome({ accountId: me.user.userId }, "PRO_EXPIRED", new Date(Date.now() + 3600_000).toISOString());
    const me3 = (await (await app.request("/api/account/me", json(cookie))).json()) as any;
    expect(me3.plan.state).toBe("PRO_GRACE");
  });

  it("logout revokes the session", async () => {
    await setup();
    const cookie = await signIn("bye@example.com");
    expect((await app.request("/api/account/logout", json(cookie, {}))).status).toBe(200);
    expect((await app.request("/api/account/me", json(cookie))).status).toBe(401);
  });

  it("serves the dashboard shell at /app and /app/anything", async () => {
    await setup();
    for (const p of ["/app", "/app/login", "/app/stores/demo"]) {
      const r = await app.request(p);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
    }
  });
});
