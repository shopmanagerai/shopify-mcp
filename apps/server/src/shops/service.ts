/**
 * ShopService: shop rows, and the per-shop execution-plane factory
 * (`planesFor`) described in the task brief §3.
 */
import { AdminGraphqlClient, FakeAdminClient, seedDemoCatalog, ShopifyApiVersionService } from "@shopmanagerai/shopify-admin";
import { AdminGraphqlThemeEngine, FakeThemeEngine, ThemeAccessProxyEngine, WorkingThemeService, seedDawnLike } from "@shopmanagerai/shopify-theme";
import { CapabilityRepo, SecretStore, ShopRepo, type ShopRow } from "@shopmanagerai/storage";
import { describeError, type AdminClient, type BrowserPlane, type Logger, type ShopSummary, type StoreCapability, type ThemeEngine } from "@shopmanagerai/shared";
import type { ShopManagerAIConfig } from "../config.js";

export const DEMO_SHOP_DOMAIN = "demo.myshopify.com";
export const DEMO_SHOP_ID = "demo";

export interface ShopPlanes {
  admin?: AdminClient;
  theme?: ThemeEngine;
  workingTheme: WorkingThemeService;
  browser?: BrowserPlane;
  capabilities: Set<StoreCapability>;
}

interface Deps {
  config: ShopManagerAIConfig;
  log: Logger;
  shops: ShopRepo;
  secrets: SecretStore;
  capabilities: CapabilityRepo;
  apiVersion: ShopifyApiVersionService;
  browser: BrowserPlane;
}

export class ShopService {
  private readonly demoThemeEngine: FakeThemeEngine;
  private readonly demoWorkingTheme: WorkingThemeService;
  private readonly demoAdminClient: FakeAdminClient;
  private planesCache = new Map<string, ShopPlanes>();

  constructor(private readonly deps: Deps) {
    this.demoThemeEngine = new FakeThemeEngine();
    seedDawnLike(this.demoThemeEngine, { name: "Live", role: "main" });
    this.demoWorkingTheme = new WorkingThemeService(this.demoThemeEngine);
    this.demoAdminClient = new FakeAdminClient(seedDemoCatalog());
  }

  isDemo(shopId: string): boolean {
    return this.deps.config.demo && shopId === DEMO_SHOP_ID;
  }

  async ensureDemoShop(): Promise<ShopRow> {
    return this.deps.shops.upsert({ shopId: DEMO_SHOP_ID, domain: DEMO_SHOP_DOMAIN, name: "Demo Store", plan: "demo", currency: "USD" });
  }

  async getByDomain(domain: string): Promise<ShopRow | null> {
    if (this.deps.config.demo && domain === DEMO_SHOP_DOMAIN) return this.ensureDemoShop();
    return this.deps.shops.getByDomain(domain);
  }

  async getById(shopId: string): Promise<ShopRow | null> {
    if (this.isDemo(shopId)) return this.ensureDemoShop();
    return this.deps.shops.getById(shopId);
  }

  toSummary(row: ShopRow): ShopSummary {
    return {
      shopId: row.shopId,
      domain: row.domain,
      name: row.name ?? undefined,
      plan: row.plan ?? undefined,
      primaryDomain: row.primaryDomain ?? undefined,
      currency: row.currency ?? undefined,
      passwordProtected: row.passwordProtected,
    };
  }

  /** Per-shop execution planes: admin client, theme engine, working theme, capabilities. */
  async planesFor(shopId: string): Promise<ShopPlanes> {
    const cached = this.planesCache.get(shopId);
    if (cached) return cached;

    if (this.isDemo(shopId)) {
      const planes: ShopPlanes = {
        admin: this.demoAdminClient,
        theme: this.demoThemeEngine,
        workingTheme: this.demoWorkingTheme,
        browser: this.deps.browser,
        capabilities: new Set<StoreCapability>(["theme.read", "theme.write", "theme.engine_a", "browser.capture", "admin.read", "admin.write"]),
      };
      this.planesCache.set(shopId, planes);
      return planes;
    }

    const shop = await this.deps.shops.getById(shopId);
    if (!shop) throw new Error(`shops: unknown shop ${shopId}`);

    let admin: AdminClient | undefined;
    const adminToken = await this.deps.secrets.get(shopId, "admin_token");
    if (adminToken) {
      admin = new AdminGraphqlClient({ shopDomain: shop.domain, accessToken: adminToken, apiVersion: this.deps.apiVersion.current() });
    }

    let theme: ThemeEngine | undefined;
    const themeAccessPassword = await this.deps.secrets.get(shopId, "theme_access");
    const cachedCaps = await this.deps.capabilities.get(shopId);
    const capSet = new Set<StoreCapability>((cachedCaps?.capabilities ?? []) as StoreCapability[]);

    if (themeAccessPassword) {
      theme = new ThemeAccessProxyEngine({
        password: themeAccessPassword,
        shopDomain: shop.domain,
        apiVersion: this.deps.apiVersion.current(),
        baseUrl: this.deps.config.themeAccessProxyBase,
      });
      capSet.add("theme.engine_a");
    } else if (admin && capSet.has("theme.engine_b")) {
      theme = new AdminGraphqlThemeEngine(admin);
    }
    if (theme) capSet.add("theme.read").add("theme.write");
    if (admin) capSet.add("admin.read").add("admin.write");

    const workingTheme = new WorkingThemeService(theme ?? this.demoThemeEngine);

    const planes: ShopPlanes = { admin, theme, workingTheme, browser: this.browserWithStoredPassword(shopId), capabilities: capSet };
    this.planesCache.set(shopId, planes);
    return planes;
  }

  invalidate(shopId: string): void {
    this.planesCache.delete(shopId);
  }

  /**
   * Wraps the shared browser plane so captures for this shop automatically use the
   * storefront password stored via commerce.settings.storefront_password (looked up
   * per call, so storing/clearing takes effect without a restart). An explicit
   * storefrontPassword on the request still wins.
   */
  private browserWithStoredPassword(shopId: string): BrowserPlane {
    const inner = this.deps.browser;
    const secrets = this.deps.secrets;
    return {
      capture: async (req) => {
        if (req.storefrontPassword) return inner.capture(req);
        const stored = await secrets.get(shopId, "storefront_password");
        return inner.capture(stored ? { ...req, storefrontPassword: stored } : req);
      },
    };
  }

  /** Probes admin/engine-A/engine-B/browser and persists the capability set. */
  async probe(shopId: string): Promise<Set<StoreCapability>> {
    if (this.isDemo(shopId)) {
      const caps = new Set<StoreCapability>(["theme.read", "theme.write", "theme.engine_a", "browser.capture", "admin.read", "admin.write"]);
      await this.deps.capabilities.set(shopId, Array.from(caps));
      return caps;
    }

    const shop = await this.deps.shops.getById(shopId);
    if (!shop) throw new Error(`shops: unknown shop ${shopId}`);
    const caps = new Set<StoreCapability>();

    const adminToken = await this.deps.secrets.get(shopId, "admin_token");
    let admin: AdminClient | undefined;
    if (adminToken) {
      admin = new AdminGraphqlClient({ shopDomain: shop.domain, accessToken: adminToken, apiVersion: this.deps.apiVersion.current() });
      try {
        await admin.query(`query { shop { name } }`);
        caps.add("admin.read").add("admin.write");
      } catch (e) {
        this.deps.log.warn("shops.probe: admin probe failed", { shopId, error: describeError(e) });
      }
    }

    const themeAccessPassword = await this.deps.secrets.get(shopId, "theme_access");
    if (themeAccessPassword) {
      try {
        const engineA = new ThemeAccessProxyEngine({
          password: themeAccessPassword,
          shopDomain: shop.domain,
          apiVersion: this.deps.apiVersion.current(),
          baseUrl: this.deps.config.themeAccessProxyBase,
        });
        await engineA.listThemes();
        caps.add("theme.read").add("theme.write").add("theme.engine_a");
      } catch (e) {
        this.deps.log.warn("shops.probe: engine A probe failed", { shopId, error: describeError(e) });
      }
    }

    if (admin && !caps.has("theme.engine_a")) {
      try {
        const engineB = new AdminGraphqlThemeEngine(admin);
        const themes = await engineB.listThemes();
        const target = themes.find((t) => t.role !== "main") ?? themes[0];
        if (!target) {
          this.deps.log.warn("shops.probe: engine B skipped - no themes found on the store", { shopId });
        } else {
          const ok = await engineB.probe(target.id, {
            onDenied: (detail) => this.deps.log.warn("shops.probe: engine B probe declined (theme.read/write not added)", { shopId, themeId: target.id, detail }),
          });
          if (ok) caps.add("theme.read").add("theme.write").add("theme.engine_b");
        }
      } catch (e) {
        this.deps.log.warn("shops.probe: engine B probe failed", { shopId, error: describeError(e) });
      }
    }

    if (this.deps.config.playwrightEnabled) caps.add("browser.capture");

    // No prior log stated what a probe actually decided - only individual engine *failures*
    // warned, so a capability silently never being added (as opposed to erroring) was
    // indistinguishable from the probe not running at all. Always log the outcome.
    this.deps.log.info("shops.probe: result", { shopId, hasAdminToken: Boolean(adminToken), hasThemeAccessPassword: Boolean(themeAccessPassword), capabilities: Array.from(caps) });

    await this.deps.capabilities.set(shopId, Array.from(caps));
    this.invalidate(shopId);
    return caps;
  }
}

/**
 * Scopes Shopify actually granted at install (stored by the OAuth callback under
 * kv `shop_scopes:<shopId>`), falling back to the configured request list. Shopify
 * collapses `read_x` into `write_x` in the granted set; the policy engine treats a
 * write scope as implying its read scope.
 */
export async function grantedScopesFor(container: { kv: { get<T>(key: string): Promise<T | null> }; config: { shopify: { scopes: string[] } } }, shopId: string): Promise<string[]> {
  const stored = await container.kv.get<string[]>(`shop_scopes:${shopId}`);
  const scopes = stored && stored.length > 0 ? stored : container.config.shopify.scopes;
  return expandWriteToReadScopes(scopes);
}

/**
 * Shopify collapses a requested read_x + write_x pair into just write_x in the granted-scopes
 * response - confirmed live: this app requests both for e.g. products/content/discounts, but the
 * OAuth grant only ever lists write_products, never read_products alongside it. The docstring
 * above already claimed "the policy engine treats a write scope as implying its read scope", but
 * nothing anywhere actually did this - packages/tool-registry's availability check does a literal
 * Set.has() with no inference, so every read-only tool whose scope also has a write_ counterpart
 * (32 of the 123 free tools: products, content, discounts, markets, metafields, navigation,
 * pixels, publications, script tags, locales, translations, ...) was permanently stuck at
 * "scope_missing" no matter what the merchant granted. Expand here, once, so every caller of
 * grantedScopesFor (MCP tool gating, the embedded admin UI, account API) sees the same corrected set.
 */
function expandWriteToReadScopes(scopes: string[]): string[] {
  const set = new Set(scopes);
  for (const s of scopes) {
    if (s.startsWith("write_")) set.add(`read_${s.slice("write_".length)}`);
  }
  return Array.from(set);
}
