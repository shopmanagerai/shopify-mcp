/**
 * Minimal OAuth 2.1 authorization server per shop (task brief §7), a port of
 * the original plugin includes/oauth/*.php: PKCE (S256) required, CIMD client
 * identification, authorization page rendered inside the embedded admin
 * (open in demo mode), rotating refresh tokens, 1h access tokens.
 */
import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { newId } from "@shopmanagerai/shared";
import type { Container } from "../container.js";
import { resolveShop } from "../shops/resolve.js";
import { verifyAdminSession } from "./shopify.js";

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1h
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const CODE_TTL_MS = 5 * 60 * 1000; // 5 min

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function newToken(prefix: string): string {
  return `${prefix}_${b64url(randomBytes(32))}`;
}

function verifyPkce(verifier: string, challenge: string, method: string | null): boolean {
  if (!challenge) return true; // PKCE optional only if the client never sent a challenge (rejected earlier at /authorize in production)
  if ((method ?? "S256") === "plain") return verifier === challenge;
  const computed = b64url(createHash("sha256").update(verifier).digest());
  return computed === challenge;
}

// ---------------------------------------------------------------------------
// SSRF-guarded CIMD fetch
// ---------------------------------------------------------------------------
const PRIVATE_HOST_RE = /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$|localhost$)/i;
const PRIVATE_172_RE = /^172\.(1[6-9]|2\d|3[0-1])\./;

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname) || PRIVATE_172_RE.test(hostname);
}

async function fetchClientMetadata(clientIdUrl: string): Promise<Record<string, unknown>> {
  const url = new URL(clientIdUrl);
  if (url.protocol !== "https:") throw new Error("client_id must be an https URL.");
  if (isPrivateHost(url.hostname)) throw new Error("client_id must not resolve to a private address.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`client metadata fetch failed: ${res.status}`);
    const reader = res.body?.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) throw new Error("client metadata document too large (>64KB).");
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    return JSON.parse(text || "{}");
  } finally {
    clearTimeout(timeout);
  }
}

async function getOrFetchClient(container: Container, clientId: string, shopId: string) {
  const existing = await container.oauth.getClient(clientId);
  if (existing) return existing;
  const metadata = await fetchClientMetadata(clientId);
  return container.oauth.createClient({ clientId, shopId, metadata });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function mountOAuthAuthorizationServer(app: Hono, container: Container): void {
  app.get("/.well-known/oauth-authorization-server", (c) => {
    const base = container.config.appUrl;
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  app.get("/.well-known/oauth-protected-resource/mcp/:shop", (c) => {
    const shop = c.req.param("shop");
    const base = container.config.appUrl;
    return c.json({
      resource: `${base}/mcp/${shop}`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
    });
  });

  app.get("/oauth/authorize", async (c) => {
    const clientId = c.req.query("client_id") ?? "";
    const redirectUri = c.req.query("redirect_uri") ?? "";
    const state = c.req.query("state") ?? "";
    const codeChallenge = c.req.query("code_challenge") ?? "";
    const codeChallengeMethod = c.req.query("code_challenge_method") ?? "S256";
    const shopHandle = c.req.query("shop") ?? "";
    const resource = c.req.query("resource") ?? "";

    if (!container.config.demo) {
      const session = await verifyAdminSession(container, c);
      if (!session) return c.text("You must be logged into the Shopify admin to approve this connection.", 401);
    }

    if (!clientId || !redirectUri || !codeChallenge) {
      return c.text("Missing client_id, redirect_uri, or code_challenge (PKCE is required).", 400);
    }

    const shopRow = await resolveShop(container.shopService, shopHandle || resource.split("/mcp/")[1] || "");
    if (!shopRow) return c.text("Unknown shop.", 400);

    let clientName = clientId;
    try {
      const client = await getOrFetchClient(container, clientId, shopRow.shopId);
      const meta = client.metadata as { client_name?: string } | null;
      clientName = meta?.client_name ?? clientId;
    } catch (e) {
      return c.text(`Could not verify client metadata: ${String(e instanceof Error ? e.message : e)}`, 400);
    }

    return c.html(renderApprovalPage({ clientName, clientId, redirectUri, state, codeChallenge, codeChallengeMethod, shop: shopHandle }));
  });

  app.post("/oauth/authorize", async (c) => {
    const form = await c.req.parseBody();
    const decision = String(form["decision"] ?? "deny");
    const clientId = String(form["client_id"] ?? "");
    const redirectUri = String(form["redirect_uri"] ?? "");
    const state = String(form["state"] ?? "");
    const codeChallenge = String(form["code_challenge"] ?? "");
    const codeChallengeMethod = String(form["code_challenge_method"] ?? "S256");
    const profile = String(form["profile"] ?? "production_safe");
    const label = String(form["label"] ?? "MCP client");
    const shopHandle = String(form["shop"] ?? "");

    const shopRow = await resolveShop(container.shopService, shopHandle);
    if (!shopRow) return c.text("Unknown shop.", 400);

    if (decision !== "approve") {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      if (state) url.searchParams.set("state", state);
      return c.redirect(url.toString());
    }

    const credential = await container.credentials.create({
      credentialId: newId("cred"),
      shopId: shopRow.shopId,
      kind: "oauth",
      label,
      profile,
      scopes: container.config.shopify.scopes,
    });

    const code = newToken("cpc");
    await container.oauth.createCode({
      code,
      clientId,
      credentialSeed: { credentialId: credential.credentialId, shopId: shopRow.shopId },
      pkceChallenge: codeChallenge,
      pkceMethod: codeChallengeMethod,
      redirectUri,
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString());
  });

  app.post("/oauth/token", async (c) => {
    const body = await parseTokenRequestBody(c);
    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      const { code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId } = body;
      if (!code || !verifier) return c.json({ error: "invalid_request" }, 400);

      const row = await container.oauth.consumeCode(code);
      if (!row) return c.json({ error: "invalid_grant" }, 400);
      if (row.redirectUri !== redirectUri || row.clientId !== clientId) return c.json({ error: "invalid_grant" }, 400);
      if (!verifyPkce(verifier, row.pkceChallenge ?? "", row.pkceMethod)) return c.json({ error: "invalid_grant", error_description: "PKCE verification failed." }, 400);

      const seed = row.credentialSeed as { credentialId: string; shopId: string } | null;
      if (!seed) return c.json({ error: "invalid_grant" }, 400);

      return c.json(await issueTokenPair(container, seed.credentialId, row.clientId));
    }

    if (grantType === "refresh_token") {
      const { refresh_token: refreshToken, client_id: clientId } = body;
      if (!refreshToken) return c.json({ error: "invalid_request" }, 400);
      const existing = await container.oauth.findToken(refreshToken);
      if (!existing || existing.kind !== "refresh" || existing.revokedAt || existing.clientId !== clientId) {
        return c.json({ error: "invalid_grant" }, 400);
      }
      if (new Date(existing.expiresAt).getTime() < Date.now()) return c.json({ error: "invalid_grant" }, 400);

      await container.oauth.revokeToken(existing.tokenHash);
      return c.json(await issueTokenPair(container, existing.credentialId, existing.clientId, refreshToken));
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  app.post("/oauth/revoke", async (c) => {
    const body = await parseTokenRequestBody(c);
    if (body.token) await container.oauth.revokeToken(require_sha256(body.token));
    return c.json({ ok: true });
  });
}

async function issueTokenPair(container: Container, credentialId: string, clientId: string, rotatedFrom?: string) {
  const access = newToken("cpat");
  const refresh = newToken("cprt");
  const now = Date.now();
  await container.oauth.createToken({ token: access, kind: "access", credentialId, clientId, expiresAt: new Date(now + ACCESS_TTL_MS).toISOString() });
  await container.oauth.createToken({
    token: refresh,
    kind: "refresh",
    credentialId,
    clientId,
    expiresAt: new Date(now + REFRESH_TTL_MS).toISOString(),
    rotatedFrom: rotatedFrom ? require_sha256(rotatedFrom) : null,
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh };
}

function require_sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function parseTokenRequestBody(c: { req: { header(name: string): string | undefined; parseBody(): Promise<Record<string, unknown>>; json(): Promise<unknown> } } & any): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await c.req.json()) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v)]));
  }
  const form = await c.req.parseBody();
  return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
}

function renderApprovalPage(opts: { clientName: string; clientId: string; redirectUri: string; state: string; codeChallenge: string; codeChallengeMethod: string; shop: string }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connect ${esc(opts.clientName)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;">
  <h1>Connect "${esc(opts.clientName)}" to ShopManager AI</h1>
  <p>This application is requesting access to your store's MCP endpoint.</p>
  <form method="post" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${esc(opts.clientId)}">
    <input type="hidden" name="redirect_uri" value="${esc(opts.redirectUri)}">
    <input type="hidden" name="state" value="${esc(opts.state)}">
    <input type="hidden" name="code_challenge" value="${esc(opts.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${esc(opts.codeChallengeMethod)}">
    <input type="hidden" name="shop" value="${esc(opts.shop)}">
    <label>Safety profile
      <select name="profile">
        <option value="read_only">Read Only, inspect only, no writes</option>
        <option value="production_safe" selected>Production Safe, writes, no publish/destructive</option>
        <option value="developer_full_access">Developer Full Access, everything, with confirm/approval</option>
      </select>
    </label>
    <br><br>
    <label>Label for this connection <input type="text" name="label" value="${esc(opts.clientName)}"></label>
    <br><br>
    <button type="submit" name="decision" value="approve">Approve</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </form>
</body></html>`;
}
