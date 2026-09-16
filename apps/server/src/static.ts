/**
 * Serves apps/admin/dist at /admin/* (task brief §10), injecting
 * %SHOPIFY_API_KEY% into index.html. Falls back to a helpful placeholder
 * page if the admin app hasn't been built yet.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Container } from "./container.js";
import { BRAND } from "@shopmanagerai/shared";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function placeholderHtml(what = "admin", cmd = "pnpm --filter @shopmanagerai/admin build"): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${BRAND.name} ${what}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;">
<h1>${BRAND.name} ${what} is not built</h1>
<p>Run <code>${cmd}</code> from the repo root, then reload this page.</p>
</body></html>`;
}

export function mountStatic(app: Hono, container: Container): void {
  // Resolve relative to this module (apps/server/dist/static.js → apps/admin/dist) so the
  // server works from any cwd; fall back to a cwd-relative path for the tsx dev runner.
  const candidates = [
    fileURLToPath(new URL("../../admin/dist/", import.meta.url)),
    join(process.cwd(), "apps", "admin", "dist"),
    join(process.cwd(), "..", "admin", "dist"),
  ];
  const distDir = candidates.find((d) => existsSync(join(d, "index.html"))) ?? candidates[0]!;

  // The app host has no marketing page: land on the dashboard (which shows login when signed out).
  app.get("/", (c) => c.redirect("/app", 302));

  // Account dashboard (apps/dashboard, Vite SPA) at /app/*. Never framed (middleware sets X-Frame-Options: DENY there).
  const dashCandidates = [
    fileURLToPath(new URL("../../dashboard/dist/", import.meta.url)),
    join(process.cwd(), "apps", "dashboard", "dist"),
    join(process.cwd(), "..", "dashboard", "dist"),
  ];
  const dashDir = dashCandidates.find((d) => existsSync(join(d, "index.html"))) ?? dashCandidates[0]!;
  const serveDashIndex = (c: any) => {
    const indexPath = join(dashDir, "index.html");
    if (!existsSync(indexPath)) return c.html(placeholderHtml("dashboard", "pnpm --filter @shopmanagerai/dashboard build"));
    c.header("cache-control", "no-cache");
    return c.html(readFileSync(indexPath, "utf8"));
  };
  app.get("/app", serveDashIndex);
  app.get("/app/*", (c) => {
    const path = c.req.path.replace(/^\/app\/?/, "");
    if (!path) return serveDashIndex(c);
    const filePath = join(dashDir, path);
    if (existsSync(filePath) && filePath.startsWith(dashDir) && !filePath.endsWith("index.html") && extname(filePath)) {
      const bytes = readFileSync(filePath);
      const type = MIME[extname(filePath)] ?? "application/octet-stream";
      const cache = /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache";
      return c.body(bytes, 200, { "content-type": type, "cache-control": cache });
    }
    return serveDashIndex(c);
  });

  app.get("/admin", (c) => serveAdminIndex(c, container, distDir));
  app.get("/admin/*", (c) => {
    const path = c.req.path.replace(/^\/admin\/?/, "");
    if (!path) return serveAdminIndex(c, container, distDir);
    const filePath = join(distDir, path);
    if (existsSync(filePath) && filePath.startsWith(distDir)) {
      const bytes = readFileSync(filePath);
      const type = MIME[extname(filePath)] ?? "application/octet-stream";
      return c.body(bytes, 200, { "content-type": type });
    }
    return serveAdminIndex(c, container, distDir);
  });
}

async function serveAdminIndex(c: any, container: Container, distDir: string) {
  // First embedded load of a store that has not completed install: start OAuth instead of
  // rendering a UI whose API calls would all 401. Demo mode and installed shops fall through.
  const shopParam = c.req.query("shop");
  if (!container.config.demo && shopParam && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopParam)) {
    const row = await container.shopService.getByDomain(shopParam);
    const installed = row ? await container.secrets.has(row.shopId, "admin_token") : false;
    if (!installed) return c.redirect(`/auth?shop=${encodeURIComponent(shopParam)}${c.req.query("host") ? "&embedded=1" : ""}`);
  }
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) return c.html(placeholderHtml());
  const html = readFileSync(indexPath, "utf8").replace(/%SHOPIFY_API_KEY%/g, container.config.shopify.clientId ?? "demo");
  c.header("content-security-policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  c.header("cache-control", "no-cache"); // hashed assets are immutable; the shell must not go stale
  return c.html(html);
}
