/**
 * Environment configuration (see .env.example and the task brief §1).
 * Demo mode is on when SHOPMANAGER_DEMO=1 or when no SHOPIFY_CLIENT_ID is set.
 */
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().optional(),
  DATA_DIR: z.string().default("./data"),
  /** Optional Postgres connection string; SQLite under DATA_DIR when unset. */
  DATABASE_URL: z.string().optional(),
  /** env (default when the master key env var is set) | file (dev) | aws-kms. */
  MASTER_KEY_PROVIDER: z.enum(["env", "file", "aws-kms"]).optional(),
  KMS_KEY_ID: z.string().optional(),
  KMS_REGION: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SHOPMANAGER_MASTER_KEY: z.string().optional(),
  /** pre-rename name, still read so existing .env files keep working */
  SHOPMANAGERAI_MASTER_KEY: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default("2026-07"),
  /** App handle from the Partner Dashboard (URL slug of the app). Needed for the Shopify App Pricing page link. */
  SHOPIFY_APP_HANDLE: z.string().optional(),
  SHOPIFY_SCOPES: z
    .string()
    .default(
      "read_themes,write_themes,read_products,write_products,read_content,write_content,read_online_store_navigation,write_online_store_navigation,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions,read_files,write_files,read_publications,write_publications,read_locales,read_markets,read_script_tags",
    ),
  THEME_ACCESS_PROXY_BASE: z.string().default("https://theme-kit-access.shopifyapps.com/cli/admin/api"),
  SHOPMANAGER_DEMO: z.string().optional(),
  /** pre-rename name, still read so existing .env files keep working */
  SHOPMANAGERAI_DEMO: z.string().optional(),
  PLAYWRIGHT_ENABLED: z.string().optional(),
  FREEMIUS_PRODUCT_ID: z.string().optional(),
  FREEMIUS_SECRET_KEY: z.string().optional(),
  FREEMIUS_WEBHOOK_SECRET: z.string().optional(),
  FREEMIUS_API_BASE: z.string().default("https://api.freemius.com"),
  UPGRADE_URL: z.string().optional(),
  /** Account layer (dashboard at /app): magic-link email delivery. */
  EMAIL_PROVIDER: z.enum(["resend", "console"]).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** Freemius hosted checkout: "slug=planId,...". One "pro" plan with unit tiers is enough ("pro=1234"); per-tier plans also work. */
  FREEMIUS_PLAN_IDS: z.string().optional(),
  /** Freemius pricing ids per tier when one plan carries unit tiers: "pro=111,growth=112,scale=113,agency=114" (Plans > plan > Pricing ID per unit row). */
  FREEMIUS_PRICING_IDS: z.string().optional(),
  FREEMIUS_CHECKOUT_BASE: z.string().default("https://checkout.freemius.com"),
  /** Public marketing site origin (for "back to site" links). */
  SITE_URL: z.string().optional(),
  /** Comma-separated emails that get the operator admin panel (/app/admin) on sign-in. */
  ADMIN_EMAILS: z.string().optional(),
  /** Where new-ticket notifications go (defaults to the first ADMIN_EMAILS entry). */
  SUPPORT_INBOX: z.string().optional(),
});

export interface ShopManagerAIConfig {
  port: number;
  appUrl: string;
  dataDir: string;
  databaseUrl?: string;
  masterKeyProvider?: { provider?: "env" | "file" | "aws-kms"; kmsKeyId?: string; kmsRegion?: string };
  logLevel: "debug" | "info" | "warn" | "error";
  masterKey?: string;
  shopify: {
    clientId?: string;
    clientSecret?: string;
    apiVersion: string;
    scopes: string[];
    appHandle?: string;
  };
  themeAccessProxyBase: string;
  demo: boolean;
  playwrightEnabled: boolean;
  freemius: {
    productId?: string;
    secretKey?: string;
    webhookSecret?: string;
    apiBase: string;
  };
  upgradeUrl: string;
  email: { provider: "resend" | "console"; resendApiKey?: string; from: string };
  freemiusCheckout: { base: string; planIds: Record<string, string>; pricingIds: Record<string, string> };
  siteUrl: string;
  adminEmails: string[];
  supportInbox: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShopManagerAIConfig {
  // A blank "KEY=" line in .env (copied from .env.example) means "unset", not "empty string".
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v.trim() !== "") cleaned[k] = v;
  const parsed = EnvSchema.parse(cleaned);
  const demoFlag = parsed.SHOPMANAGER_DEMO ?? parsed.SHOPMANAGERAI_DEMO;
  const demo = demoFlag === "1" || !parsed.SHOPIFY_CLIENT_ID;

  return {
    port: parsed.PORT,
    appUrl: (parsed.APP_URL ?? `http://localhost:${parsed.PORT}`).replace(/\/$/, ""),
    dataDir: parsed.DATA_DIR,
    databaseUrl: parsed.DATABASE_URL,
    masterKeyProvider: { provider: parsed.MASTER_KEY_PROVIDER, kmsKeyId: parsed.KMS_KEY_ID, kmsRegion: parsed.KMS_REGION },
    logLevel: parsed.LOG_LEVEL,
    masterKey: parsed.SHOPMANAGER_MASTER_KEY ?? parsed.SHOPMANAGERAI_MASTER_KEY,
    shopify: {
      clientId: parsed.SHOPIFY_CLIENT_ID,
      clientSecret: parsed.SHOPIFY_CLIENT_SECRET,
      apiVersion: parsed.SHOPIFY_API_VERSION,
      scopes: parsed.SHOPIFY_SCOPES.split(",").map((s) => s.trim()).filter(Boolean),
      appHandle: parsed.SHOPIFY_APP_HANDLE,
    },
    themeAccessProxyBase: parsed.THEME_ACCESS_PROXY_BASE,
    demo,
    playwrightEnabled: parsed.PLAYWRIGHT_ENABLED === "1",
    freemius: {
      productId: parsed.FREEMIUS_PRODUCT_ID,
      secretKey: parsed.FREEMIUS_SECRET_KEY,
      webhookSecret: parsed.FREEMIUS_WEBHOOK_SECRET,
      apiBase: parsed.FREEMIUS_API_BASE,
    },
    upgradeUrl: parsed.UPGRADE_URL ?? `${(parsed.APP_URL ?? `http://localhost:${parsed.PORT}`).replace(/\/$/, "")}/app/billing`,
    email: {
      provider: parsed.EMAIL_PROVIDER ?? (parsed.RESEND_API_KEY ? "resend" : "console"),
      resendApiKey: parsed.RESEND_API_KEY,
      from: parsed.EMAIL_FROM ?? "ShopManager AI <no-reply@shopmanagerai.com>",
    },
    freemiusCheckout: { base: parsed.FREEMIUS_CHECKOUT_BASE.replace(/\/$/, ""), planIds: parsePlanIds(parsed.FREEMIUS_PLAN_IDS), pricingIds: parsePlanIds(parsed.FREEMIUS_PRICING_IDS) },
    siteUrl: (parsed.SITE_URL ?? "https://shopmanagerai.com").replace(/\/$/, ""),
    adminEmails: (parsed.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    supportInbox: parsed.SUPPORT_INBOX?.trim() || ((parsed.ADMIN_EMAILS ?? "").split(",")[0]?.trim() || null),
  };
}

function parsePlanIds(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [slug, id] = part.split("=").map((x) => x.trim());
    if (slug && id) out[slug.toLowerCase()] = id;
  }
  return out;
}

export function demoBanner(cfg: ShopManagerAIConfig): string {
  return [
    "======================================================================",
    " ShopManager AI, DEMO MODE",
    ` No SHOPIFY_CLIENT_ID configured or SHOPMANAGER_DEMO=1 set.`,
    ` Serving a single fake store: demo.myshopify.com`,
    ` Admin UI:  ${cfg.appUrl}/admin?shop=demo.myshopify.com`,
    ` MCP URL:   ${cfg.appUrl}/mcp/demo.myshopify.com`,
    "======================================================================",
  ].join("\n");
}
