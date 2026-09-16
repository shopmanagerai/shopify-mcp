import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { loadConfig } from "../config.js";
import { buildContainer, type Container } from "../container.js";
import { buildApp } from "../app.js";

let container: Container;
let app: ReturnType<typeof buildApp>;
let dataDir: string;

async function setup(envOverrides: Record<string, string> = {}) {
  dataDir = mkdtempSync(join(tmpdir(), "cp-test-entitlement-api-"));
  const config = loadConfig({ SHOPMANAGER_DEMO: "1", DATA_DIR: dataDir, APP_URL: "http://localhost:3000", ...envOverrides } as any);
  container = await buildContainer(config, { dbPath: ":memory:" });
  await container.shopService.ensureDemoShop();
  app = buildApp(container);
}

afterEach(() => {
  container.closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/admin/entitlement", () => {
  it("returns FREE state and an activationUrl, never license data", async () => {
    await setup();
    const res = await app.request("/api/admin/entitlement?shop=demo.myshopify.com");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("FREE");
    expect(body.activationUrl).toContain("/activate");
    expect(JSON.stringify(body)).not.toMatch(/licenseKey|license_key/i);
  });
});

describe("POST /api/admin/entitlement/activate", () => {
  it("404s (as NOT_FOUND) when Freemius is not configured", async () => {
    await setup();
    const res = await app.request("/api/admin/entitlement/activate?shop=demo.myshopify.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseKey: "whatever" }),
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("POST /freemius/webhook", () => {
  it("acknowledges without side effects when Freemius is not configured", async () => {
    await setup();
    const res = await app.request("/freemius/webhook", {
      method: "POST",
      body: JSON.stringify({ id: "evt_1", type: "license.activated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe("not_configured");
  });

  it("rejects a bad signature and processes a valid one when configured", async () => {
    await setup({ FREEMIUS_PRODUCT_ID: "p1", FREEMIUS_WEBHOOK_SECRET: "whsec_test" });
    const shop = await container.shopService.getByDomain("demo.myshopify.com");

    const badRes = await app.request("/freemius/webhook", {
      method: "POST",
      headers: { "x-freemius-signature": "deadbeef" },
      body: JSON.stringify({ id: "evt_1", type: "license.activated", data: { custom: { shop_id: shop!.shopId } } }),
    });
    expect(badRes.status).toBe(401);

    const event = { id: "evt_2", type: "license.activated", data: { custom: { shop_id: shop!.shopId } } };
    const raw = JSON.stringify(event);
    const sig = createHmac("sha256", "whsec_test").update(raw, "utf8").digest("hex");
    const goodRes = await app.request("/freemius/webhook", {
      method: "POST",
      headers: { "x-freemius-signature": sig },
      body: raw,
    });
    expect(goodRes.status).toBe(200);

    const state = await container.entitlements.getState(shop!.shopId);
    expect(state.state).toBe("PRO_ACTIVE");
  });
});
