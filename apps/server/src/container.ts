/**
 * Builds the singleton services the rest of the server depends on.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import type { BrowserPlane, EntitlementProvider, Logger } from "@shopmanagerai/shared";
import { CapabilityRepo, ConnectionRepo, CredentialRepo, DesignManifestRepo, EntitlementRepo, JobRepo, KvRepo, MagicLinkRepo, MemoryRepo, OAuthRepo, PostRepo, SecretStore, SessionRepo, ShopRepo, SkillRepo, TicketRepo, UserRepo, UserShopRepo, openDatabase, resolveMasterKey, type Schema } from "@shopmanagerai/storage";
import { SqliteLedger, FileSnapshotStore, SqliteApprovalService, RollbackService } from "@shopmanagerai/ledger";
import { ShopifyApiVersionManager } from "@shopmanagerai/shopify-admin";
import { FakeBrowserPlane } from "./oss-runtime.js";
import { FreemiusWebhookHandler, LicenseActivation } from "@shopmanagerai/entitlement-freemius";
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import type { ShopManagerAIConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { buildEntitlementProvider } from "./entitlements.js";
import { loadToolsPackage, type SkillDescriptor } from "./tools-boundary.js";
import { ShopService } from "./shops/service.js";
import { TelemetryEmitter } from "./telemetry.js";
import { SqliteDesignManifestService } from "./design-manifests.js";
import { AccountService } from "./accounts/service.js";
import { TicketService } from "./accounts/tickets.js";
import { ConsoleEmailSender, ResendEmailSender, type EmailSender } from "./accounts/email.js";
import { BRAND } from "@shopmanagerai/shared";

export interface Container {
  config: ShopManagerAIConfig;
  log: Logger;
  db: Kysely<Schema>;
  closeDb: () => void;
  secrets: SecretStore;
  shops: ShopRepo;
  credentials: CredentialRepo;
  oauth: OAuthRepo;
  capabilities: CapabilityRepo;
  jobs: JobRepo;
  ledger: SqliteLedger;
  snapshots: FileSnapshotStore;
  approvals: SqliteApprovalService;
  rollback: RollbackService;
  apiVersion: ShopifyApiVersionManager;
  entitlements: EntitlementProvider;
  entitlementRepo: EntitlementRepo;
  invalidateEntitlementsCache: (shopId: string) => void;
  freemiusWebhook: FreemiusWebhookHandler | null;
  licenseActivation: LicenseActivation | null;
  designManifests: DesignManifestRepo;
  designManifestService: SqliteDesignManifestService;
  browser: BrowserPlane;
  registry: ToolRegistry;
  skills: SkillDescriptor[];
  skillRepo: SkillRepo;
  kv: KvRepo;
  connections: ConnectionRepo;
  memory: MemoryRepo;
  toolsFallback: boolean;
  shopService: ShopService;
  telemetry: TelemetryEmitter;
  users: UserRepo;
  magicLinks: MagicLinkRepo;
  sessions: SessionRepo;
  userShops: UserShopRepo;
  email: EmailSender;
  accounts: AccountService;
  tickets: TicketRepo;
  posts: PostRepo;
  ticketService: TicketService;
  /** Which database driver is in use (diagnostics, /healthz). */
  dbDriver: "better-sqlite3" | "node:sqlite" | "postgres";
  /** In-process counters served at /metrics (Prometheus text format). */
  metrics: Metrics;
}

/** Minimal in-process metrics: tool executions by name/outcome, latency sum, API cost seen. */
export class Metrics {
  readonly startedAt = Date.now();
  private counters = new Map<string, number>();
  private sums = new Map<string, number>();
  inc(name: string, labels: Record<string, string> = {}, by = 1): void { const k = key(name, labels); this.counters.set(k, (this.counters.get(k) ?? 0) + by); }
  observe(name: string, labels: Record<string, string>, value: number): void { const k = key(name + "_sum", labels); this.sums.set(k, (this.sums.get(k) ?? 0) + value); this.inc(name + "_count", labels); }
  render(): string {
    const lines: string[] = [`# TYPE shopmanager_uptime_seconds gauge`, `shopmanager_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.sums) lines.push(`${k} ${Math.round(v)}`);
    return lines.join("\n") + "\n";
  }
}
function key(name: string, labels: Record<string, string>): string {
  const l = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`).join(",");
  return l ? `${name}{${l}}` : name;
}

export interface BuildContainerOptions {
  /** Override the sqlite path, e.g. ":memory:" for tests. */
  dbPath?: string;
}

export async function buildContainer(config: ShopManagerAIConfig, opts: BuildContainerOptions = {}): Promise<Container> {
  const log = createLogger(config.logLevel);
  const dbPath = opts.dbPath ?? join(config.dataDir, "shopmanagerai.sqlite");
  const { db, close, driver } = await openDatabase({ path: dbPath, url: opts.dbPath ? undefined : config.databaseUrl });
  if (driver === "postgres") log.info("storage: using Postgres (DATABASE_URL)."); else log.info(`storage: using SQLite (${driver}) at ${dbPath}.`);

  const masterKey = await resolveMasterKey({ provider: config.masterKeyProvider?.provider, dataDir: config.dataDir, kmsKeyId: config.masterKeyProvider?.kmsKeyId, kmsRegion: config.masterKeyProvider?.kmsRegion });
  const secrets = new SecretStore(db, config.dataDir, masterKey);
  const shops = new ShopRepo(db);
  const credentials = new CredentialRepo(db);
  const oauth = new OAuthRepo(db);
  const capabilities = new CapabilityRepo(db);
  const jobs = new JobRepo(db);
  const skillRepo = new SkillRepo(db);
  const kv = new KvRepo(db);
  const connections = new ConnectionRepo(db);
  const memory = new MemoryRepo(db);
  const entitlementRepo = new EntitlementRepo(db);
  const designManifests = new DesignManifestRepo(db);
  const designManifestService = new SqliteDesignManifestService(designManifests);

  const ledger = new SqliteLedger(db);
  const snapshots = new FileSnapshotStore(db, config.dataDir);
  const approvals = new SqliteApprovalService(db);
  const rollback = new RollbackService(ledger, snapshots);
  const apiVersion = new ShopifyApiVersionManager({ SHOPIFY_API_VERSION: config.shopify.apiVersion });
  const entitlements = buildEntitlementProvider(config, entitlementRepo, log);
  const invalidateEntitlements = (shopId: string) => {
    const maybeInvalidatable = entitlements as { invalidate?: (shopId: string) => void };
    maybeInvalidatable.invalidate?.(shopId);
  };
  const licenseActivation =
    config.freemius.productId && config.freemius.secretKey
      ? new LicenseActivation(entitlementRepo, {
          productId: config.freemius.productId,
          secretKey: config.freemius.secretKey,
          apiBase: config.freemius.apiBase,
        })
      : null;
  const users = new UserRepo(db);
  const magicLinks = new MagicLinkRepo(db);
  const sessions = new SessionRepo(db);
  const userShops = new UserShopRepo(db);
  const email: EmailSender =
    config.email.provider === "resend" && config.email.resendApiKey
      ? new ResendEmailSender({ apiKey: config.email.resendApiKey, from: config.email.from, log })
      : new ConsoleEmailSender(log);
  if (email.kind === "console" && !config.demo) log.warn("accounts: EMAIL_PROVIDER is console; magic links are only logged. Set RESEND_API_KEY for real delivery.");
  const accounts = new AccountService({
    users,
    magicLinks,
    sessions,
    userShops,
    shops,
    entitlements: entitlementRepo,
    kv,
    email,
    licenseActivation,
    invalidateEntitlements,
    log,
    appUrl: config.appUrl,
    brand: BRAND.name,
    echoMagicLinks: config.demo || email.kind === "console",
    adminEmails: config.adminEmails,
  });
  const tickets = new TicketRepo(db);
  const posts = new PostRepo(db);
  const ticketService = new TicketService({ tickets, users, email, log, appUrl: config.appUrl, brand: BRAND.name, supportInbox: config.supportInbox });
  const freemiusWebhook =
    config.freemius.productId && config.freemius.webhookSecret
      ? new FreemiusWebhookHandler({
          secret: config.freemius.webhookSecret,
          entitlements: entitlementRepo,
          kv,
          applyToAccount: (binding, outcome, graceUntil) => accounts.applyWebhookOutcome(binding, outcome, graceUntil),
          resolveShopId: async (binding: { shopDomain?: string; shopId?: string; licenseId?: string }) => {
            if (binding.shopId) return binding.shopId;
            if (binding.shopDomain) return (await shops.getByDomain(binding.shopDomain))?.shopId ?? null;
            return null;
          },
          onInvalidate: invalidateEntitlements,
        })
      : null;
  const browser: BrowserPlane = await buildBrowserPlane(config);

  const toolsApi = await loadToolsPackage();
  const registry = toolsApi.createRegistry();
  let skills: SkillDescriptor[] = [];
  // Skills live at <repo>/skills. Resolve relative to this module first (apps/server/dist → ../../../skills)
  // so the server works from any cwd, then fall back to cwd for the tsx dev runner.
  const skillDirs = [fileURLToPath(new URL("../../../skills/", import.meta.url)), join(process.cwd(), "skills"), join(process.cwd(), "..", "..", "skills")];
  for (const dir of skillDirs) {
    try {
      skills = await toolsApi.loadSkills(dir);
      if (skills.length > 0) break;
    } catch {
      skills = [];
    }
  }
  if (skills.length === 0) log.warn("container: no skills loaded (looked in " + skillDirs.join(", ") + ")");
  if (toolsApi.usingFallback) {
    log.warn("container: @shopmanagerai/tools does not yet export createRegistry(); using the local fallback registry.", {
      tools: registry.list().map((t) => t.name),
    });
  }

  const shopService = new ShopService({ config, log, shops, secrets, capabilities, apiVersion, browser });

  const telemetry = new TelemetryEmitter(process.env.TELEMETRY_ENDPOINT, { log });
  telemetry.start();

  return {
    config,
    log,
    db,
    closeDb: close,
    secrets,
    shops,
    credentials,
    oauth,
    capabilities,
    jobs,
    ledger,
    snapshots,
    approvals,
    rollback,
    apiVersion,
    entitlements,
    entitlementRepo,
    invalidateEntitlementsCache: invalidateEntitlements,
    freemiusWebhook,
    licenseActivation,
    designManifests,
    designManifestService,
    browser,
    registry,
    skills,
    skillRepo,
    kv,
    connections,
    memory,
    toolsFallback: toolsApi.usingFallback,
    shopService,
    telemetry,
    users,
    magicLinks,
    sessions,
    userShops,
    email,
    accounts,
    tickets,
    posts,
    ticketService,
    dbDriver: driver,
    metrics: new Metrics(),
  };
}

async function buildBrowserPlane(config: ShopManagerAIConfig): Promise<BrowserPlane> {
  if (!config.playwrightEnabled) return new FakeBrowserPlane();
  return new FakeBrowserPlane();

}
