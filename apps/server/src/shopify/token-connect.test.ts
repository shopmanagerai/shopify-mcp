import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { buildContainer, type Container } from "../container.js";
import { connectWithToken, normalizeShop, requiredScopes } from "./token-connect.js";
import { shopifyPricingUrl, syncShopifySubscription, tierFromPlanName } from "./billing.js";

let container: Container;
let dataDir: string;

async function setup(env: Record<string, string> = {}) {
  dataDir = mkdtempSync(join(tmpdir(), "sm-token-"));
  const config = loadConfig({ SHOPMANAGER_DEMO: "1", DATA_DIR: dataDir, APP_URL: "http://localhost:3000", SHOPIFY_APP_HANDLE: "shopmanager-ai", ...env } as any);
  container = await buildContainer(config, { dbPath: ":memory:" });
}

afterEach(() => {
  container?.closeDb();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const TOKEN = "shpat_" + "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function fakeFetch(handler: (body: any) => { status?: number; json: unknown }): typeof fetch {
  return (async (_url: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const r = handler(body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("normalizeShop", () => {
  it("accepts bare handles, URLs and admin.shopify.com links", () => {
    expect(normalizeShop("my-store")).toBe("my-store.myshopify.com");
    expect(normalizeShop("https://My-Store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShop("https://admin.shopify.com/store/acme/settings")).toBe("acme.myshopify.com");
    expect(normalizeShop("example.com")).toBeNull();
  });
});

describe("connectWithToken", () => {
  it("rejects a malformed token before calling Shopify", async () => {
    await setup();
    await expect(connectWithToken(container, { shop: "acme", token: "nope" })).rejects.toThrow(/shpat_/);
  });

  it("stores the token, scopes and shop when Shopify accepts it", async () => {
    await setup();
    const scopes = requiredScopes(container);
    const granted = scopes.filter((s) => s !== "read_script_tags");
    const fetchImpl = fakeFetch(() => ({
      json: {
        data: {
          shop: { name: "Acme", myshopifyDomain: "acme.myshopify.com", primaryDomain: { host: "acme.com" }, currencyCode: "USD", plan: { displayName: "Basic" }, passwordEnabled: false },
          currentAppInstallation: { accessScopes: granted.map((handle) => ({ handle })) },
        },
      },
    }));
    const r = await connectWithToken(container, { shop: "acme", token: TOKEN }, { fetchImpl });
    expect(r.shopId).toBe("acme.myshopify.com");
    expect(r.name).toBe("Acme");
    expect(r.missing).toEqual(["read_script_tags"]);
    expect(await container.secrets.get("acme.myshopify.com", "admin_token")).toBe(TOKEN);
    const row = await container.shops.getById("acme.myshopify.com");
    expect((row?.settings as any).connection).toBe("token");
    expect(await container.kv.get("shop_scopes:acme.myshopify.com")).toEqual(granted);
  });

  it("maps a 401 from Shopify to a clear error", async () => {
    await setup();
    const fetchImpl = fakeFetch(() => ({ status: 401, json: { errors: "[API] Invalid API key or access token" } }));
    await expect(connectWithToken(container, { shop: "acme", token: TOKEN }, { fetchImpl })).rejects.toThrow(/rejected that token/);
    expect(await container.shops.getById("acme.myshopify.com")).toBeNull();
  });
});

describe("shopify billing", () => {
  it("builds the App Pricing URL from the app handle", async () => {
    await setup();
    expect(shopifyPricingUrl(container, "acme.myshopify.com")).toBe("https://admin.shopify.com/store/acme/charges/shopmanager-ai/pricing_plans");
  });

  it("maps plan names to entitlement states", () => {
    expect(tierFromPlanName("Pro")).toEqual({ state: "PRO_ACTIVE", plan: "shopify:pro" });
    expect(tierFromPlanName("Agency Unlimited")).toEqual({ state: "AGENCY_ACTIVE", plan: "shopify:agency" });
  });

  it("is a no-op in demo mode and leaves the row untouched", async () => {
    await setup();
    await container.shopService.ensureDemoShop();
    const r = await syncShopifySubscription(container, "demo.myshopify.com", { force: true });
    expect(r.subscription).toBeNull();
  });
});
