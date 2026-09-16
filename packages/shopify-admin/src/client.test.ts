import { describe, expect, it, vi } from "vitest";
import { AdminGraphqlClient } from "./client.js";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function makeClient(opts: Partial<ConstructorParameters<typeof AdminGraphqlClient>[0]> & { fetch: typeof fetch }) {
  return new AdminGraphqlClient({
    shopDomain: "test-shop.myshopify.com",
    accessToken: "shpat_faketokenfortests1234567890",
    apiVersion: "2026-07",
    sleep: async () => {},
    ...opts,
  });
}

describe("AdminGraphqlClient", () => {
  it("posts to the versioned endpoint with the access token header", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init.headers);
      return jsonResponse({ data: { shop: { name: "Test" } } });
    });
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    await client.query("query { shop { name } }");
    expect(capturedUrl).toBe("https://test-shop.myshopify.com/admin/api/2026-07/graphql.json");
    expect(capturedHeaders?.get("X-Shopify-Access-Token")).toBe("shpat_faketokenfortests1234567890");
  });

  it("pre-waits when the projected available cost is below the requested cost", async () => {
    const sleepCalls: number[] = [];
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }));
    const client = makeClient({
      fetch: fetchImpl as unknown as typeof fetch,
      throttle: { currentlyAvailable: 10, maximumAvailable: 1000, restoreRate: 50, lastSeenAt: 0 },
      now: () => 0,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    });
    await client.query("query { x }", undefined, { cost: 100 });
    // deficit = 90, restoreRate 50/s -> 1800ms
    expect(sleepCalls).toEqual([1800]);
  });

  it("does not pre-wait when enough budget is available", async () => {
    const sleepCalls: number[] = [];
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }));
    const client = makeClient({
      fetch: fetchImpl as unknown as typeof fetch,
      throttle: { currentlyAvailable: 1000, maximumAvailable: 1000, restoreRate: 50, lastSeenAt: 0 },
      now: () => 0,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    });
    await client.query("query { x }", undefined, { cost: 50 });
    expect(sleepCalls).toEqual([]);
  });

  it("retries once on 429 then succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse({ errors: [{ message: "throttled" }] }, { status: 429 });
      return jsonResponse({ data: { ok: true } });
    });
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await client.query("query { x }");
    expect(call).toBe(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("retries on 5xx then succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return new Response("boom", { status: 502 });
      return jsonResponse({ data: { ok: true } });
    });
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await client.query("query { x }");
    expect(call).toBe(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("throws RATE_LIMITED after exhausting retries on repeated 429s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ message: "throttled" }] }, { status: 429 }));
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch, maxRetries: 2 });
    await expect(client.query("query { x }")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps ACCESS_DENIED with scope wording to SCOPE_MISSING", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "Access denied for productUpdate field. Required access scope missing.", extensions: { code: "ACCESS_DENIED" } }] }),
    );
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    await expect(client.mutate("mutation { x }")).rejects.toMatchObject({ code: "SCOPE_MISSING" });
  });

  it("maps ACCESS_DENIED on theme file mutations to ACCESS_DENIED_EXEMPTION", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "Access denied for themeFilesUpsert mutation.", extensions: { code: "ACCESS_DENIED" } }] }),
    );
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    await expect(client.mutate("mutation themeFilesUpsert { x }")).rejects.toMatchObject({ code: "ACCESS_DENIED_EXEMPTION" });
  });

  it("does not retry when the response contains userErrors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: { productUpdate: { product: null, userErrors: [{ field: ["title"], message: "Title can't be blank" }] } },
      }),
    );
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await client.mutate<{ productUpdate: { userErrors: Array<{ message: string }> } }>("mutation { productUpdate { userErrors { message } } }");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.data.productUpdate.userErrors[0]!.message).toBe("Title can't be blank");
  });

  it("captures the deprecation header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { ok: true } }, { headers: { "X-Shopify-API-Deprecated-Reason": "field foo is deprecated" } }));
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await client.query("query { x }");
    expect(result.deprecations).toContain("field foo is deprecated");
  });

  it("updates throttle state from extensions.cost.throttleStatus", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: { ok: true },
        extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 8, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 500, restoreRate: 50 } } },
      }),
    );
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch, now: () => 12345 });
    await client.query("query { x }");
    expect(client.getThrottleState()).toEqual({ maximumAvailable: 1000, currentlyAvailable: 500, restoreRate: 50, lastSeenAt: 12345 });
  });

  it("never leaks the access token in a thrown error's message", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ message: "Internal error near token shpat_faketokenfortests1234567890" }] }, { status: 502 }));
    const client = makeClient({ fetch: fetchImpl as unknown as typeof fetch, maxRetries: 0 });
    try {
      await client.query("query { x }");
      throw new Error("expected rejection");
    } catch (e: any) {
      const serialized = JSON.stringify(e.technicalMessage ?? "") + (e.message ?? "");
      expect(serialized).not.toContain("shpat_faketokenfortests1234567890");
    }
  });

  it("resolves an async access token provider", async () => {
    let capturedHeaders: Headers | undefined;
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      capturedHeaders = new Headers(init.headers);
      return jsonResponse({ data: { ok: true } });
    });
    const client = new AdminGraphqlClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: async () => "shpat_asyncprovidedtoken1234567890",
      apiVersion: "2026-07",
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    await client.query("query { x }");
    expect(capturedHeaders?.get("X-Shopify-Access-Token")).toBe("shpat_asyncprovidedtoken1234567890");
  });
});

describe("mutation retry guard", () => {
  it("never replays a mutation after a 5xx or dropped connection, but still retries queries", async () => {
    let calls = 0;
    const fetch502 = (async () => {
      calls++;
      return new Response("boom", { status: 502 });
    }) as unknown as typeof fetch;
    const client = makeClient({ fetch: fetch502, maxRetries: 3 });
    await expect(client.mutate("mutation ProductCreate($input: ProductInput!) { productCreate(input: $input) { product { id } } }", { input: {} })).rejects.toBeTruthy();
    expect(calls).toBe(1);
    calls = 0;
    await expect(client.query("query Shop { shop { name } }")).rejects.toBeTruthy();
    expect(calls).toBe(4);
    calls = 0;
    const fetchDrop = (async () => {
      calls++;
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    await expect(makeClient({ fetch: fetchDrop, maxRetries: 3 }).mutate("mutation X { shopifyPaymentsPayoutSchedule }", {})).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("still retries a mutation on 429 (the request was not executed)", async () => {
    let calls = 0;
    const fetch429 = (async () => {
      calls++;
      if (calls === 1) return new Response("throttled", { status: 429, headers: { "Retry-After": "0" } });
      return jsonResponse({ data: { ok: true } });
    }) as unknown as typeof fetch;
    const r = await makeClient({ fetch: fetch429 }).mutate("mutation Y { y }", {});
    expect(r.data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
