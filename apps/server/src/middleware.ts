/**
 * Security middleware (task brief §12): body size limits, security headers,
 * frame-ancestors for /admin, per-credential rate limiting, request id,
 * redacted access log.
 */
import { randomUUID } from "node:crypto";
import type { Hono, Context, Next } from "hono";
import { redactString } from "@shopmanagerai/shared";
import type { Container } from "./container.js";

const MAX_BODY_DEFAULT = 2 * 1024 * 1024; // 2MB
const MAX_BODY_MCP = 5 * 1024 * 1024; // 5MB

export function bodyLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const limit = c.req.path.startsWith("/mcp/") ? MAX_BODY_MCP : MAX_BODY_DEFAULT;
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > limit) return c.text("Payload too large.", 413);
    await next();
  };
}

export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    if (c.req.path.startsWith("/admin") || c.req.path.startsWith("/auth") || c.req.path.startsWith("/oauth/authorize")) {
      // Embedded in Shopify admin: CSP frame-ancestors is authoritative; X-Frame-Options must be absent.
      c.header("content-security-policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
    } else {
      c.header("x-frame-options", "DENY");
    }
  };
}

export function requestIdMiddleware() {
  return async (c: Context, next: Next) => {
    const id = c.req.header("x-request-id") ?? randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  };
}

export function accessLogMiddleware(container: Container) {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    container.log.info(redactString(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`), {
      requestId: c.get("requestId"),
    });
  };
}

// ---------------------------------------------------------------------------
// Rate limiting: a simple in-memory token bucket per credential/IP.
// ---------------------------------------------------------------------------
interface Bucket {
  tokens: number;
  lastRefill: number;
}
const buckets = new Map<string, Bucket>();
// Agents make many small calls; 600/min per credential is the default (override with MCP_RATE_LIMIT_PER_MIN).
const MCP_RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.MCP_RATE_LIMIT_PER_MIN ?? 600));

export function rateLimitKey(c: Context): string {
  const authz = c.req.header("authorization");
  if (authz) return `auth:${authz}`;
  return `ip:${c.req.header("x-forwarded-for") ?? "unknown"}`;
}

export function mcpRateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const key = rateLimitKey(c);
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: MCP_RATE_LIMIT_PER_MIN, lastRefill: now };
    const elapsedMin = (now - bucket.lastRefill) / 60000;
    bucket.tokens = Math.min(MCP_RATE_LIMIT_PER_MIN, bucket.tokens + elapsedMin * MCP_RATE_LIMIT_PER_MIN);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      return c.json({ error: "rate_limited" }, 429);
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    await next();
  };
}

export function mountMiddleware(app: Hono, container: Container): void {
  app.use("*", requestIdMiddleware());
  app.use("*", accessLogMiddleware(container));
  app.use("*", securityHeadersMiddleware());
  app.use("*", bodyLimitMiddleware());
  app.use("/mcp/*", mcpRateLimitMiddleware());
}
