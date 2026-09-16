import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { buildContainer, type Container } from "./container.js";
import { buildApp } from "./app.js";
import { ensureDemoToken, DEMO_TOKEN } from "./auth/mcp.js";

let container: Container;
let app: ReturnType<typeof buildApp>;
let dataDir: string;

async function setup() {
  dataDir = mkdtempSync(join(tmpdir(), "cp-test-"));
  const config = loadConfig({ SHOPMANAGER_DEMO: "1", DATA_DIR: dataDir, APP_URL: "http://localhost:3000" } as any);
  container = await buildContainer(config, { dbPath: ":memory:" });
  await container.shopService.ensureDemoShop();
  await ensureDemoToken(container);
  app = buildApp(container);
}

beforeEach(async () => {
  vi.useFakeTimers();
  await setup();
});

afterEach(() => {
  vi.useRealTimers();
  container.closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

function modernBody(method: string, params: Record<string, unknown> = {}, clientInfo?: { name: string; version?: string }, id: number | string = 1) {
  const meta: Record<string, unknown> = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
  if (clientInfo) meta["io.modelcontextprotocol/clientInfo"] = clientInfo;
  return { jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } };
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": method };
  if (name !== undefined) headers["mcp-name"] = name;
  return headers;
}

async function flushConnections() {
  await vi.advanceTimersByTimeAsync(10_050);
}

describe("connections: recorded via the MCP endpoint", () => {
  it("a modern request with _meta clientInfo {name: claude-code} is recorded and listed by the admin API", async () => {
    const res = await app.request("/mcp/demo", {
      method: "POST",
      headers: { ...modernHeaders("tools/list"), authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify(modernBody("tools/list", {}, { name: "claude-code", version: "1.2.3" })),
    });
    expect(res.status).toBe(200);

    await flushConnections();

    const list = await app.request("/api/admin/connections?shop=demo.myshopify.com");
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.connections.some((c: any) => c.clientKey === "claude-code" && c.clientVersion === "1.2.3")).toBe(true);
  });

  it("legacy initialize clientInfo is remembered for the session and applied to later calls without clientInfo", async () => {
    const sessionId = "sess_test_1";
    const initRes = await app.request("/mcp/demo", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-05", clientInfo: { name: "Cursor", version: "0.9" } } }),
    });
    expect(initRes.status).toBe(200);
    const sessionHeader = initRes.headers.get("mcp-session-id") ?? sessionId;

    const callRes = await app.request("/mcp/demo", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${DEMO_TOKEN}`, "mcp-session-id": sessionHeader },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "execute-tool", arguments: { name: "commerce.diagnostics", input: {} } } }),
    });
    expect(callRes.status).toBe(200);

    await flushConnections();

    const list = await app.request("/api/admin/connections?shop=demo.myshopify.com");
    const body = await list.json();
    const cursorRow = body.connections.find((c: any) => c.clientKey === "cursor");
    expect(cursorRow).toBeTruthy();
    expect(cursorRow.requestCount).toBeGreaterThanOrEqual(2);
  });

  it("DELETE /connections/:id forgets one row", async () => {
    const res = await app.request("/mcp/demo", {
      method: "POST",
      headers: { ...modernHeaders("tools/list"), authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify(modernBody("tools/list", {}, { name: "windsurf" })),
    });
    expect(res.status).toBe(200);
    await flushConnections();

    const list = await app.request("/api/admin/connections?shop=demo.myshopify.com");
    const body = await list.json();
    const row = body.connections.find((c: any) => c.clientKey === "windsurf");
    expect(row).toBeTruthy();

    const del = await app.request(`/api/admin/connections/${row.id}?shop=demo.myshopify.com`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const after = await app.request("/api/admin/connections?shop=demo.myshopify.com");
    const afterBody = await after.json();
    expect(afterBody.connections.some((c: any) => c.id === row.id)).toBe(false);
  });
});

describe("memory: discover-tools memoryIndex", () => {
  async function saveMemory() {
    return app.request("/mcp/demo", {
      method: "POST",
      headers: { ...modernHeaders("tools/call", "execute-tool"), authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify(
        modernBody("tools/call", { name: "execute-tool", arguments: { name: "commerce.memory.save", input: { name: "User profile", description: "Who the user is", type: "user", content: "Senior engineer." } } }),
      ),
    });
  }

  it("includes memoryIndex after a memory is saved", async () => {
    const saveRes = await saveMemory();
    expect(saveRes.status).toBe(200);
    const saveBody = await saveRes.json();
    expect(saveBody.result.structuredContent.ok).toBe(true);

    const discoverRes = await app.request("/mcp/demo", {
      method: "POST",
      headers: { ...modernHeaders("tools/call", "discover-tools"), authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify(modernBody("tools/call", { name: "discover-tools", arguments: {} })),
    });
    expect(discoverRes.status).toBe(200);
    const discoverBody = await discoverRes.json();
    const data = discoverBody.result.structuredContent.data;
    expect(Array.isArray(data.memoryIndex)).toBe(true);
    expect(data.memoryIndex.some((line: string) => line.includes("User profile"))).toBe(true);
  });

  it("omits memoryIndex when memory is disabled for the shop", async () => {
    await saveMemory();

    const disable = await app.request("/api/admin/memory/settings?shop=demo.myshopify.com", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);

    const discoverRes = await app.request("/mcp/demo", {
      method: "POST",
      headers: { ...modernHeaders("tools/call", "discover-tools"), authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify(modernBody("tools/call", { name: "discover-tools", arguments: {} })),
    });
    const discoverBody = await discoverRes.json();
    expect(discoverBody.result.structuredContent.data.memoryIndex).toBeUndefined();
  });
});

describe("admin API: memory CRUD + restore", () => {
  it("create -> update -> versions -> restore -> delete", async () => {
    const create = await app.request("/api/admin/memory?shop=demo.myshopify.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "n", description: "d1", type: "project", content: "v1" }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.memory.version).toBe(1);
    const id = created.memory.id;

    const update = await app.request(`/api/admin/memory/${id}?shop=demo.myshopify.com`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "n", description: "d2", type: "project", content: "v2" }),
    });
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(updated.memory.version).toBe(2);

    const versionsRes = await app.request(`/api/admin/memory/${id}/versions?shop=demo.myshopify.com`);
    expect(versionsRes.status).toBe(200);
    const versionsBody = await versionsRes.json();
    expect(versionsBody.versions).toHaveLength(2);

    const restore = await app.request(`/api/admin/memory/${id}/restore?shop=demo.myshopify.com`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(restore.status).toBe(200);
    const restored = await restore.json();
    expect(restored.memory.content).toBe("v1");
    expect(restored.memory.version).toBe(3);

    const del = await app.request(`/api/admin/memory/${id}?shop=demo.myshopify.com`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const list = await app.request("/api/admin/memory?shop=demo.myshopify.com");
    const listBody = await list.json();
    expect(listBody.memories.some((m: any) => m.id === id)).toBe(false);
  });

  it("GET/PUT memory settings toggles the shop-level enabled flag", async () => {
    const get = await app.request("/api/admin/memory/settings?shop=demo.myshopify.com");
    expect((await get.json()).enabled).toBe(true);

    const put = await app.request("/api/admin/memory/settings?shop=demo.myshopify.com", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect((await put.json()).enabled).toBe(false);

    const after = await app.request("/api/admin/memory/settings?shop=demo.myshopify.com");
    expect((await after.json()).enabled).toBe(false);
  });
});
