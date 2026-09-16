/**
 * Mounts createMcpHandler at /mcp/:shop (task brief §8).
 */
import { Hono } from "hono";
import { createMcpHandler } from "@shopmanagerai/mcp-protocol";
import type { Container } from "../container.js";
import { authenticateMcp, McpAuthError } from "../auth/mcp.js";
import { makeMcpDeps } from "./deps.js";
import type { McpRequestCtx } from "./execute.js";

export function mountMcp(app: Hono, container: Container): void {
  const deps = makeMcpDeps(container, (ctx: McpRequestCtx & { surface?: "meta" | "flat" }) => ctx.surface ?? "meta");
  const { handle } = createMcpHandler(deps);

  app.all("/mcp/:shop", async (c) => {
    const shopHandle = c.req.param("shop");
    let reqCtx: McpRequestCtx;
    try {
      reqCtx = await authenticateMcp(container, shopHandle, c.req.header("authorization"));
    } catch (e) {
      if (e instanceof McpAuthError) {
        return c.body(JSON.stringify({ error: "unauthorized", message: e.message }), e.status, {
          "content-type": "application/json",
          "www-authenticate": e.wwwAuthenticate,
        });
      }
      throw e;
    }

    const surface = c.req.query("surface") === "flat" ? "flat" : "meta";
    (reqCtx as McpRequestCtx & { surface?: "meta" | "flat" }).surface = surface;

    let body: unknown = undefined;
    if (c.req.method === "POST") {
      try {
        body = await c.req.json();
      } catch {
        body = undefined;
      }
    }

    const headers: Record<string, string | string[] | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const result = await handle({
      method: c.req.method as "POST" | "GET" | "DELETE",
      headers,
      body,
      ctx: reqCtx,
    });

    for (const [key, value] of Object.entries(result.headers)) c.header(key, value);
    if (result.body === undefined) return c.body(null, result.status as 200 | 202);
    return c.json(result.body as object, result.status as 200);
  });
}
