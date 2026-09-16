import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "./db.js";
import { ConnectionRepo, MemoryRepo, normalizeClientKey } from "./repos.js";

describe("storage: ConnectionRepo", () => {
  let opened: OpenedDatabase;
  let repo: ConnectionRepo;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    repo = new ConnectionRepo(opened.db);
  });
  afterEach(() => opened.close());

  it("client_key normalisation table", () => {
    expect(normalizeClientKey("Claude Code")).toBe("claude-code");
    expect(normalizeClientKey("claude-code/1.2.3")).toBe("claude-code");
    expect(normalizeClientKey("Claude Desktop")).toBe("claude-desktop");
    expect(normalizeClientKey("claude-ai")).toBe("claude-desktop");
    expect(normalizeClientKey("Cursor")).toBe("cursor");
    expect(normalizeClientKey("Codex CLI")).toBe("codex");
    expect(normalizeClientKey("Visual Studio Code")).toBe("vscode");
    expect(normalizeClientKey("Gemini")).toBe("gemini");
    expect(normalizeClientKey("ChatGPT")).toBe("chatgpt");
    expect(normalizeClientKey("Windsurf")).toBe("windsurf");
    expect(normalizeClientKey("")).toBe("unknown");
    expect(normalizeClientKey("SomeRandomThing")).toMatch(/^other:[0-9a-f]{8}$/);
    // stable for the same (case-insensitive) name
    expect(normalizeClientKey("SomeRandomThing")).toBe(normalizeClientKey("somerandomthing"));
  });

  it("record() inserts a new row with request_count 1, then upserts incrementing the count", async () => {
    const first = await repo.record({
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "Claude token",
      kind: "token",
      clientName: "Claude Code",
      clientVersion: "1.0.0",
      protocolVersion: "2026-07-28",
    });
    expect(first.requestCount).toBe(1);
    expect(first.clientKey).toBe("claude-code");

    const second = await repo.record({
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "Claude token",
      kind: "token",
      clientName: "Claude Code",
      clientVersion: "1.0.1",
      protocolVersion: "2026-07-28",
    });
    expect(second.id).toBe(first.id);
    expect(second.requestCount).toBe(2);
    expect(second.clientVersion).toBe("1.0.1");
  });

  it("a blank client name/version on a later call does not erase what a previous call recorded", async () => {
    await repo.record({ shopId: "shop_1", credentialId: "cred_1", credentialLabel: "L", kind: "token", clientName: "Cursor", clientVersion: "2.0" });
    const second = await repo.record({ shopId: "shop_1", credentialId: "cred_1", credentialLabel: "L", kind: "token", clientName: "Cursor" });
    expect(second.clientName).toBe("Cursor");
    expect(second.clientVersion).toBe("2.0");
    expect(second.requestCount).toBe(2);
  });

  it("different clients on the same credential are separate rows (UNIQUE shop+credential+client_key)", async () => {
    await repo.record({ shopId: "shop_1", credentialId: "cred_1", credentialLabel: "L", kind: "token", clientName: "Claude Code" });
    await repo.record({ shopId: "shop_1", credentialId: "cred_1", credentialLabel: "L", kind: "token", clientName: "Cursor" });
    const rows = await repo.list("shop_1");
    expect(rows).toHaveLength(2);
  });

  it("list() scopes to shop and orders by last_seen desc", async () => {
    await repo.record({ shopId: "shop_1", credentialId: "cred_1", credentialLabel: "L", kind: "token", clientName: "Cursor" });
    await repo.record({ shopId: "shop_2", credentialId: "cred_2", credentialLabel: "L2", kind: "token", clientName: "Codex" });
    const rows = await repo.list("shop_1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientKey).toBe("cursor");
  });

  it("forget() deletes a row and reports whether one was removed", async () => {
    const row = await repo.record({ shopId: "shop_1", credentialId: "cred_1", credentialLabel: "L", kind: "token", clientName: "Cursor" });
    expect(await repo.forget(row.id)).toBe(true);
    expect(await repo.forget(row.id)).toBe(false);
    expect(await repo.list("shop_1")).toHaveLength(0);
  });

  it("forgetStale() removes rows whose credential id is not in the live set", async () => {
    await repo.record({ shopId: "shop_1", credentialId: "cred_live", credentialLabel: "L", kind: "token", clientName: "Cursor" });
    await repo.record({ shopId: "shop_1", credentialId: "cred_dead", credentialLabel: "L", kind: "token", clientName: "Codex" });
    const removed = await repo.forgetStale("shop_1", new Set(["cred_live"]));
    expect(removed).toBe(1);
    const rows = await repo.list("shop_1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.credentialId).toBe("cred_live");
  });
});

describe("storage: MemoryRepo", () => {
  let opened: OpenedDatabase;
  let repo: MemoryRepo;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    repo = new MemoryRepo(opened.db);
  });
  afterEach(() => opened.close());

  it("save() without an id creates a new memory at version 1 and writes a version row", async () => {
    const row = await repo.save({ shopId: "shop_1", name: "User profile", description: "Who the user is", type: "user", content: "Senior engineer.", createdBy: "cred_1" });
    expect(row.version).toBe(1);
    const versions = await repo.versions(row.memoryId);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.content).toBe("Senior engineer.");
  });

  it("save() with an id updates the memory, bumping the version and appending a version row of the new state", async () => {
    const created = await repo.save({ shopId: "shop_1", name: "n", description: "d", type: "project", content: "v1", createdBy: "cred_1" });
    const updated = await repo.save({ memoryId: created.memoryId, shopId: "shop_1", name: "n", description: "d", type: "project", content: "v2", createdBy: "cred_1" });
    expect(updated.version).toBe(2);
    expect(updated.content).toBe("v2");
    const versions = await repo.versions(created.memoryId);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe(2);
    expect(versions[0]!.content).toBe("v2");
    expect(versions[1]!.content).toBe("v1");
  });

  it("keeps only the most recent 50 versions", async () => {
    let memoryId: string | undefined;
    for (let i = 0; i < 55; i++) {
      const row = await repo.save({ memoryId, shopId: "shop_1", name: "n", description: "d", type: "project", content: `v${i}`, createdBy: "c" });
      memoryId = row.memoryId;
    }
    const versions = await repo.versions(memoryId!);
    expect(versions.length).toBe(50);
    expect(versions[0]!.content).toBe("v54");
  });

  it("restore() copies a past version's fields into the memory as a new version", async () => {
    const created = await repo.save({ shopId: "shop_1", name: "n", description: "d1", type: "project", content: "v1", createdBy: "c" });
    await repo.save({ memoryId: created.memoryId, shopId: "shop_1", name: "n", description: "d2", type: "project", content: "v2", createdBy: "c" });
    const restored = await repo.restore(created.memoryId, 1, "c");
    expect(restored?.content).toBe("v1");
    expect(restored?.description).toBe("d1");
    expect(restored?.version).toBe(3);
    const versions = await repo.versions(created.memoryId);
    expect(versions).toHaveLength(3);
  });

  it("restore() returns null for an unknown version", async () => {
    const created = await repo.save({ shopId: "shop_1", name: "n", description: "d", type: "project", content: "v1", createdBy: "c" });
    expect(await repo.restore(created.memoryId, 99, "c")).toBeNull();
  });

  it("list() filters by type and scopes to shop", async () => {
    await repo.save({ shopId: "shop_1", name: "a", description: "d", type: "user", content: "c", createdBy: "c" });
    await repo.save({ shopId: "shop_1", name: "b", description: "d", type: "project", content: "c", createdBy: "c" });
    await repo.save({ shopId: "shop_2", name: "c", description: "d", type: "user", content: "c", createdBy: "c" });
    expect(await repo.list("shop_1")).toHaveLength(2);
    expect(await repo.list("shop_1", "user")).toHaveLength(1);
  });

  it("setEnabled() toggles the enabled flag", async () => {
    const created = await repo.save({ shopId: "shop_1", name: "a", description: "d", type: "user", content: "c", createdBy: "c" });
    expect(created.enabled).toBe(true);
    const disabled = await repo.setEnabled(created.memoryId, false);
    expect(disabled?.enabled).toBe(false);
  });

  it("delete() hard-deletes the memory and its version history", async () => {
    const created = await repo.save({ shopId: "shop_1", name: "a", description: "d", type: "user", content: "c", createdBy: "c" });
    expect(await repo.delete(created.memoryId)).toBe(true);
    expect(await repo.get(created.memoryId)).toBeNull();
    expect(await repo.versions(created.memoryId)).toHaveLength(0);
    expect(await repo.delete(created.memoryId)).toBe(false);
  });

  it("getByName() finds a memory by shop + name", async () => {
    await repo.save({ shopId: "shop_1", name: "unique-name", description: "d", type: "user", content: "c", createdBy: "c" });
    expect(await repo.getByName("shop_1", "unique-name")).not.toBeNull();
    expect(await repo.getByName("shop_2", "unique-name")).toBeNull();
  });
});
