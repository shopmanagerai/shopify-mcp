import { describe, expect, it, vi } from "vitest";
import { ThemeAccessProxyEngine } from "./engineA.js";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function makeEngine(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof ThemeAccessProxyEngine>[0]> = {}) {
  return new ThemeAccessProxyEngine({
    password: "shptka_faketestpassword1234567890",
    shopDomain: "test-shop.myshopify.com",
    apiVersion: "2026-07",
    fetch: fetchImpl,
    sleep: async () => {},
    ...overrides,
  });
}

describe("ThemeAccessProxyEngine request shaping", () => {
  it("lists themes with the configured headers against the default proxy host", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init.headers);
      return jsonResponse({ themes: [{ id: 1, name: "Live", role: "main" }] });
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    const themes = await engine.listThemes();
    expect(capturedUrl).toBe("https://theme-kit-access.shopifyapps.com/cli/admin/api/2026-07/themes.json");
    expect(capturedHeaders?.get("X-Shopify-Access-Token")).toBe("shptka_faketestpassword1234567890");
    expect(capturedHeaders?.get("X-Shopify-Shop")).toBe("test-shop.myshopify.com");
    expect(themes).toEqual([{ id: "1", gid: "gid://shopify/OnlineStoreTheme/1", name: "Live", role: "main", updatedAt: undefined, processing: undefined }]);
  });

  it("respects configurable base URL, path prefix, and header names", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init.headers);
      return jsonResponse({ themes: [] });
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch, {
      baseUrl: "https://custom.example.com",
      pathPrefix: "/custom-prefix",
      tokenHeaderName: "X-Custom-Token",
      shopHeaderName: "X-Custom-Shop",
    });
    await engine.listThemes();
    expect(capturedUrl).toBe("https://custom.example.com/custom-prefix/themes.json");
    expect(capturedHeaders?.get("X-Custom-Token")).toBe("shptka_faketestpassword1234567890");
    expect(capturedHeaders?.get("X-Custom-Shop")).toBe("test-shop.myshopify.com");
  });

  it("sends the correct PUT body when writing a text asset", async () => {
    let capturedBody: string | undefined;
    let capturedMethod: string | undefined;
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedMethod = init.method;
      capturedBody = init.body;
      return jsonResponse({ asset: { key: "snippets/foo.liquid" } });
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    const result = await engine.writeFiles("123", [{ key: "snippets/foo.liquid", content: "hello" }]);
    expect(capturedMethod).toBe("PUT");
    expect(capturedUrl).toBe("https://theme-kit-access.shopifyapps.com/cli/admin/api/2026-07/themes/123/assets.json");
    expect(JSON.parse(capturedBody!)).toEqual({ asset: { key: "snippets/foo.liquid", value: "hello" } });
    expect(result.written).toEqual(["snippets/foo.liquid"]);
  });

  it("sends an attachment body for base64 writes", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      capturedBody = init.body;
      return jsonResponse({ asset: { key: "assets/logo.png" } });
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    await engine.writeFiles("123", [{ key: "assets/logo.png", contentBase64: "YWJj" }]);
    expect(JSON.parse(capturedBody!)).toEqual({ asset: { key: "assets/logo.png", attachment: "YWJj" } });
  });

  it("rejects a write for a path outside the sandbox without calling fetch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    const result = await engine.writeFiles("123", [{ key: "../escape.liquid", content: "bad" }]);
    expect(result.errors).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a DELETE with the asset key as a query param", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedMethod = init.method;
      return jsonResponse({});
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    await engine.deleteFiles("123", ["snippets/foo.liquid"]);
    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toContain("themes/123/assets.json?");
    expect(capturedUrl).toContain(encodeURIComponent("asset[key]"));
  });

  it("retries once on 429 then succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
      return jsonResponse({ themes: [] });
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    const themes = await engine.listThemes();
    expect(call).toBe(2);
    expect(themes).toEqual([]);
  });

  it("throws RATE_LIMITED after exhausting retries", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 429 }));
    const engine = makeEngine(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    await expect(engine.listThemes()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("publishes a theme with a PUT setting role main", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      capturedBody = init.body;
      return jsonResponse({ theme: { id: 42, name: "Working", role: "main" } });
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    const ref = await engine.publishTheme("42");
    expect(JSON.parse(capturedBody!)).toEqual({ theme: { role: "main" } });
    expect(ref.role).toBe("main");
  });

  it("never includes the password in a thrown error message", async () => {
    const fetchImpl = vi.fn(async () => new Response("Internal error near shptka_faketestpassword1234567890", { status: 502 }));
    const engine = makeEngine(fetchImpl as unknown as typeof fetch, { maxRetries: 0 });
    try {
      await engine.listThemes();
      throw new Error("expected rejection");
    } catch (e: any) {
      const serialized = (e.technicalMessage ?? "") + (e.message ?? "");
      expect(serialized).not.toContain("shptka_faketestpassword1234567890");
    }
  });

  it("duplicateTheme creates a theme then copies files by reading and writing each key", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      const u = String(url);
      calls.push({ method: init.method ?? "GET", url: u });
      if (init.method === "POST" && u.endsWith("/themes.json")) {
        return jsonResponse({ theme: { id: 99, name: "Working", role: "unpublished" } });
      }
      if (!init.method || init.method === "GET") {
        if (u.includes("/themes/1/assets.json") && !u.includes("asset%5Bkey%5D") && !u.includes("asset[key]")) {
          return jsonResponse({ assets: [{ key: "snippets/a.liquid" }, { key: "snippets/b.liquid" }] });
        }
        if (u.includes("themes/1/assets.json")) {
          return jsonResponse({ asset: { key: "snippets/a.liquid", value: "content" } });
        }
      }
      if (init.method === "PUT") {
        return jsonResponse({ asset: { key: "snippets/a.liquid" } });
      }
      return jsonResponse({});
    });
    const engine = makeEngine(fetchImpl as unknown as typeof fetch);
    const dup = await engine.duplicateTheme("1", "Working copy");
    expect(dup.id).toBe("99");
    const postCalls = calls.filter((c) => c.method === "POST");
    expect(postCalls).toHaveLength(1);
    const putCalls = calls.filter((c) => c.method === "PUT");
    expect(putCalls.length).toBeGreaterThan(0);
  });
});
