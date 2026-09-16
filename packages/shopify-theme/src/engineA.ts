/**
 * Engine A: Shopify's Theme Access app proxy (docs/THEME_ACCESS_STRATEGY.md §2).
 *
 * UNVERIFIED (Milestone 0 spike #3): the exact proxy header set. We assume,
 * following CLI behaviour, `X-Shopify-Access-Token: <shptka_ password>` and a
 * shop-identifying header (assumed name `X-Shopify-Shop`) alongside the
 * standard REST-shaped `theme-kit-access.shopifyapps.com/cli/admin/api/{version}/`
 * endpoints. Base URL, path prefix, and header names are all constructor
 * options so spike results can be applied without touching this file's logic.
 *
 * `duplicateTheme` is NOT a single REST call here (no such proxy endpoint is
 * documented): we create an empty unpublished theme, then copy every file
 * from the source theme by reading and writing in batches of 20 with
 * concurrency 2. Cost: for an N-file theme this is ceil(N/20) read calls plus
 * up to N write calls (the proxy's assets endpoint is single-file), so a
 * ~200-file Dawn-like theme costs on the order of 200+ requests, acceptable
 * under the assumed 2 req/s leaky bucket but worth surfacing to the caller as
 * a slow operation.
 */
import { ShopManagerAIError, redactString } from "@shopmanagerai/shared";
import type { ThemeEngine, ThemeFile, ThemeFileWrite, ThemeRef } from "@shopmanagerai/shared";
import { validateThemeKey } from "./paths.js";

export interface ThemeAccessProxyEngineOptions {
  /** Merchant-issued Theme Access password (starts with `shptka_`), or an async provider. */
  password: string | (() => string | Promise<string>);
  /** The store's myshopify domain, e.g. "my-shop.myshopify.com". */
  shopDomain: string;
  apiVersion: string;
  /** Proxy host. Default: theme-kit-access.shopifyapps.com. */
  baseUrl?: string;
  /** Path prefix before `themes.json` etc. Default: "/cli/admin/api/{version}". */
  pathPrefix?: string;
  /** Header carrying the Theme Access password. UNVERIFIED name; default "X-Shopify-Access-Token". */
  tokenHeaderName?: string;
  /** Header carrying the shop domain. UNVERIFIED name; default "X-Shopify-Shop". */
  shopHeaderName?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  copyBatchSize?: number;
  copyConcurrency?: number;
}

interface RestTheme {
  id: number;
  name: string;
  role: string;
  updated_at?: string;
  processing?: boolean;
}
interface RestAsset {
  key: string;
  size?: number;
  checksum?: string;
  content_type?: string;
  value?: string;
  attachment?: string;
  updated_at?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ThemeAccessProxyEngine implements ThemeEngine {
  readonly kind = "theme_access_proxy" as const;

  private readonly password: string | (() => string | Promise<string>);
  private readonly shopDomain: string;
  private readonly baseUrl: string;
  private readonly pathPrefix: string;
  private readonly tokenHeaderName: string;
  private readonly shopHeaderName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly copyBatchSize: number;
  private readonly copyConcurrency: number;

  constructor(opts: ThemeAccessProxyEngineOptions) {
    this.password = opts.password;
    this.shopDomain = opts.shopDomain;
    this.baseUrl = opts.baseUrl ?? "https://theme-kit-access.shopifyapps.com";
    this.pathPrefix = opts.pathPrefix ?? `/cli/admin/api/${opts.apiVersion}`;
    this.tokenHeaderName = opts.tokenHeaderName ?? "X-Shopify-Access-Token";
    this.shopHeaderName = opts.shopHeaderName ?? "X-Shopify-Shop";
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleepImpl = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 5;
    this.copyBatchSize = opts.copyBatchSize ?? 20;
    this.copyConcurrency = opts.copyConcurrency ?? 2;
  }

  async listThemes(): Promise<ThemeRef[]> {
    const body = await this.request<{ themes: RestTheme[] }>("GET", "/themes.json");
    return body.themes.map(toThemeRef);
  }

  async getTheme(themeId: string): Promise<ThemeRef | null> {
    try {
      const body = await this.request<{ theme: RestTheme }>("GET", `/themes/${themeId}.json`);
      return toThemeRef(body.theme);
    } catch (e) {
      if (e instanceof ShopManagerAIError && e.code === "NOT_FOUND") return null;
      throw e;
    }
  }

  async listFiles(themeId: string, opts?: { prefix?: string }): Promise<ThemeFile[]> {
    const body = await this.request<{ assets: RestAsset[] }>("GET", `/themes/${themeId}/assets.json`);
    const assets = opts?.prefix ? body.assets.filter((a) => a.key.startsWith(opts.prefix!)) : body.assets;
    return assets.map(toThemeFileMeta);
  }

  async readFiles(themeId: string, keys: string[]): Promise<ThemeFile[]> {
    const out: ThemeFile[] = [];
    for (const key of keys) {
      validateThemeKey(key);
      const body = await this.request<{ asset: RestAsset }>("GET", `/themes/${themeId}/assets.json`, { query: { "asset[key]": key } });
      out.push(toThemeFile(body.asset));
    }
    return out;
  }

  async writeFiles(themeId: string, files: ThemeFileWrite[]): Promise<{ written: string[]; errors: Array<{ key: string; message: string }> }> {
    const written: string[] = [];
    const errors: Array<{ key: string; message: string }> = [];
    for (const f of files) {
      try {
        validateThemeKey(f.key);
        const asset: Record<string, unknown> = { key: f.key };
        if (f.contentBase64 !== undefined) asset.attachment = f.contentBase64;
        else asset.value = f.content ?? "";
        await this.request("PUT", `/themes/${themeId}/assets.json`, { body: { asset } });
        written.push(f.key);
      } catch (e: any) {
        errors.push({ key: f.key, message: redactString(e?.message ?? String(e)) });
      }
    }
    return { written, errors };
  }

  async deleteFiles(themeId: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
    const deleted: string[] = [];
    const errors: Array<{ key: string; message: string }> = [];
    for (const key of keys) {
      try {
        validateThemeKey(key);
        await this.request("DELETE", `/themes/${themeId}/assets.json`, { query: { "asset[key]": key } });
        deleted.push(key);
      } catch (e: any) {
        errors.push({ key, message: redactString(e?.message ?? String(e)) });
      }
    }
    return { deleted, errors };
  }

  /**
   * Creates a new unpublished theme, then copies every file from
   * `sourceThemeId` in batches of `copyBatchSize` with `copyConcurrency`
   * concurrent read+write pairs per batch. See class-level cost note.
   */
  async duplicateTheme(sourceThemeId: string, name: string): Promise<ThemeRef> {
    const created = await this.request<{ theme: RestTheme }>("POST", "/themes.json", { body: { theme: { name, role: "unpublished" } } });
    const target = toThemeRef(created.theme);

    const sourceFiles = await this.listFiles(sourceThemeId);
    const keys = sourceFiles.map((f) => f.key);

    for (let i = 0; i < keys.length; i += this.copyBatchSize) {
      const batch = keys.slice(i, i + this.copyBatchSize);
      await runWithConcurrency(batch, this.copyConcurrency, async (key) => {
        const [file] = await this.readFiles(sourceThemeId, [key]);
        if (!file) return;
        const write: ThemeFileWrite = { key: file.key, content: file.content, contentBase64: file.contentBase64 };
        await this.writeFiles(target.id, [write]);
      });
    }

    return target;
  }

  async publishTheme(themeId: string): Promise<ThemeRef> {
    const body = await this.request<{ theme: RestTheme }>("PUT", `/themes/${themeId}.json`, { body: { theme: { role: "main" } } });
    return toThemeRef(body.theme);
  }

  async deleteTheme(themeId: string): Promise<void> {
    await this.request("DELETE", `/themes/${themeId}.json`);
  }

  async renameTheme(themeId: string, name: string): Promise<ThemeRef> {
    const body = await this.request<{ theme: RestTheme }>("PUT", `/themes/${themeId}.json`, { body: { theme: { name } } });
    return toThemeRef(body.theme);
  }

  /**
   * UNVERIFIED (docs/THEME_ACCESS_STRATEGY.md §2 spike list): the Theme Access
   * proxy's REST `POST /themes.json` is assumed to accept a `src` field the
   * same way the CLI/Admin REST theme resource does, downloading the zip at
   * `src` server-side. Confirm against the live proxy before relying on this
   * in production; `themeFilesUpsert`-based copy (see `duplicateTheme`) is
   * the verified fallback.
   */
  async createFromUrl(src: string, name: string): Promise<ThemeRef> {
    const body = await this.request<{ theme: RestTheme }>("POST", "/themes.json", { body: { theme: { name, src, role: "unpublished" } } });
    return toThemeRef(body.theme);
  }

  private async resolvePassword(): Promise<string> {
    return typeof this.password === "function" ? await this.password() : this.password;
  }

  private async request<T = any>(
    method: "GET" | "PUT" | "POST" | "DELETE",
    path: string,
    opts: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      const password = await this.resolvePassword();
      const url = new URL(`${this.pathPrefix}${path}`, this.baseUrl);
      if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);

      const headers: Record<string, string> = {
        [this.tokenHeaderName]: password,
        [this.shopHeaderName]: this.shopDomain,
      };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";

      const res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      const callLimit = res.headers.get("X-Shopify-Shop-Api-Call-Limit");
      if (callLimit) await this.backOffIfNearLimit(callLimit);

      if (res.status === 429) {
        if (attempt >= this.maxRetries) {
          throw new ShopManagerAIError("RATE_LIMITED", "Theme Access proxy rate limit exceeded.", { retryable: true });
        }
        const retryAfter = res.headers.get("Retry-After");
        await this.sleepImpl(retryAfter ? Number(retryAfter) * 1000 : this.backoffMs(attempt));
        attempt++;
        continue;
      }

      if (res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new ShopManagerAIError("UPSTREAM_ERROR", `Theme Access proxy returned ${res.status}.`, { retryable: true, httpStatus: res.status });
        }
        await this.sleepImpl(this.backoffMs(attempt));
        attempt++;
        continue;
      }

      if (res.status === 404) {
        throw new ShopManagerAIError("NOT_FOUND", "Resource not found via Theme Access proxy.", { httpStatus: 404 });
      }

      if (!res.ok) {
        let text = "";
        try {
          text = await res.text();
        } catch {
          // ignore
        }
        throw new ShopManagerAIError("UPSTREAM_ERROR", `Theme Access proxy returned ${res.status}.`, {
          technicalMessage: redactString(text),
          httpStatus: res.status,
        });
      }

      if (res.status === 204) return {} as T;
      try {
        return (await res.json()) as T;
      } catch {
        return {} as T;
      }
    }
  }

  private async backOffIfNearLimit(header: string): Promise<void> {
    const match = /^(\d+)\/(\d+)$/.exec(header.trim());
    if (!match) return;
    const current = Number(match[1]);
    const max = Number(match[2]);
    if (max > 0 && current / max >= 0.9) {
      await this.sleepImpl(500);
    }
  }

  private backoffMs(attempt: number): number {
    return 250 * Math.pow(2, attempt) + Math.random() * 100;
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function toThemeRef(t: RestTheme): ThemeRef {
  return {
    id: String(t.id),
    gid: `gid://shopify/OnlineStoreTheme/${t.id}`,
    name: t.name,
    role: mapRole(t.role),
    updatedAt: t.updated_at,
    processing: t.processing,
  };
}

function mapRole(role: string): ThemeRef["role"] {
  const lower = (role ?? "").toLowerCase();
  return lower === "main" || lower === "unpublished" || lower === "development" || lower === "demo" ? lower : lower;
}

function toThemeFileMeta(a: RestAsset): ThemeFile {
  return { key: a.key, size: a.size, checksum: a.checksum, contentType: a.content_type, updatedAt: a.updated_at };
}

function toThemeFile(a: RestAsset): ThemeFile {
  return {
    key: a.key,
    content: a.value,
    contentBase64: a.attachment,
    size: a.size,
    checksum: a.checksum,
    contentType: a.content_type,
    updatedAt: a.updated_at,
  };
}
