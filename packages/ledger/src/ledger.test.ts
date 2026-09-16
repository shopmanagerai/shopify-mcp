import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, fingerprint } from "@shopmanagerai/shared";
import type { ThemeEngine, ThemeFile, ThemeFileWrite, ThemeRef } from "@shopmanagerai/shared";
import { openDatabase, type OpenedDatabase } from "@shopmanagerai/storage";
import { SqliteLedger, inputsFingerprint } from "./ledger.js";
import { FileSnapshotStore } from "./snapshots.js";
import { SqliteApprovalService } from "./approvals.js";
import { RollbackService } from "./rollback.js";

// ---------------------------------------------------------------------------
// A small in-memory fake implementing the shared ThemeEngine interface, used
// only by these tests to exercise rollback without a real Shopify connection.
// ---------------------------------------------------------------------------
class FakeThemeEngine implements ThemeEngine {
  readonly kind = "fake" as const;
  private themes = new Map<string, ThemeRef>();
  private files = new Map<string, Map<string, ThemeFile>>();
  private publishedThemeId: string | null = null;

  addTheme(ref: ThemeRef, files: ThemeFile[] = []): void {
    this.themes.set(ref.id, ref);
    const m = new Map<string, ThemeFile>();
    for (const f of files) m.set(f.key, f);
    this.files.set(ref.id, m);
    if (ref.role === "main") this.publishedThemeId = ref.id;
  }

  async listThemes(): Promise<ThemeRef[]> {
    return [...this.themes.values()];
  }
  async getTheme(themeId: string): Promise<ThemeRef | null> {
    return this.themes.get(themeId) ?? null;
  }
  async listFiles(themeId: string): Promise<ThemeFile[]> {
    return [...(this.files.get(themeId)?.values() ?? [])];
  }
  async readFiles(themeId: string, keys: string[]): Promise<ThemeFile[]> {
    const store = this.files.get(themeId) ?? new Map();
    return keys.map((k) => store.get(k)).filter((f): f is ThemeFile => f !== undefined);
  }
  async writeFiles(themeId: string, files: ThemeFileWrite[]): Promise<{ written: string[]; errors: Array<{ key: string; message: string }> }> {
    let store = this.files.get(themeId);
    if (!store) {
      store = new Map();
      this.files.set(themeId, store);
    }
    const written: string[] = [];
    for (const f of files) {
      store.set(f.key, { key: f.key, content: f.content, contentBase64: f.contentBase64 });
      written.push(f.key);
    }
    return { written, errors: [] };
  }
  async deleteFiles(themeId: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
    const store = this.files.get(themeId) ?? new Map();
    const deleted: string[] = [];
    for (const k of keys) {
      if (store.delete(k)) deleted.push(k);
    }
    return { deleted, errors: [] };
  }
  async duplicateTheme(sourceThemeId: string, name: string): Promise<ThemeRef> {
    const ref: ThemeRef = { id: newId("theme"), name, role: "unpublished" };
    this.addTheme(ref, await this.listFiles(sourceThemeId));
    return ref;
  }
  async publishTheme(themeId: string): Promise<ThemeRef> {
    const ref = this.themes.get(themeId);
    if (!ref) throw new Error("no such theme");
    if (this.publishedThemeId) {
      const prev = this.themes.get(this.publishedThemeId);
      if (prev) this.themes.set(prev.id, { ...prev, role: "unpublished" });
    }
    const published = { ...ref, role: "main" as const };
    this.themes.set(themeId, published);
    this.publishedThemeId = themeId;
    return published;
  }
  async deleteTheme(themeId: string): Promise<void> {
    this.themes.delete(themeId);
    this.files.delete(themeId);
  }
  async renameTheme(themeId: string, name: string): Promise<ThemeRef> {
    const ref = this.themes.get(themeId);
    if (!ref) throw new Error("no such theme");
    const updated = { ...ref, name };
    this.themes.set(themeId, updated);
    return updated;
  }
}

async function fileContent(theme: FakeThemeEngine, themeId: string, key: string): Promise<string | undefined> {
  const [f] = await theme.readFiles(themeId, [key]);
  return f?.content;
}

// ---------------------------------------------------------------------------

describe("ledger: begin/finish/list/redaction", () => {
  let opened: OpenedDatabase;
  let ledger: SqliteLedger;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    ledger = new SqliteLedger(opened.db);
  });
  afterEach(() => opened.close());

  it("begins an operation as pending and finishes it with a status/duration", async () => {
    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "product.price.update",
      tier: "pro",
      risk: "write",
      inputsHash: inputsFingerprint({ id: 1, price: "9.99" }),
      inputsRedacted: { id: 1, price: "9.99" },
      resources: ["product:gid://shopify/Product/1"],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: false, strategy: "none" },
    });
    expect(op.status).toBe("pending");
    expect(op.finishedAt).toBeUndefined();

    const finished = await ledger.finish(op.operationId, {
      status: "succeeded",
      changes: [{ resource: "product:gid://shopify/Product/1", kind: "update" }],
      evidence: [{ type: "text", label: "ok" }],
    });
    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).toBeTruthy();
    expect(finished.durationMs).toBeGreaterThanOrEqual(0);
    expect(finished.changes).toHaveLength(1);
  });

  it("redacts secret-shaped inputs before they are ever persisted", async () => {
    const token = "shpat_" + "a".repeat(32);
    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.write",
      tier: "pro",
      risk: "theme_write",
      inputsHash: inputsFingerprint({ adminToken: token }),
      inputsRedacted: { adminToken: token, note: `bearer token is ${token} in the body` },
      resources: [],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: false, strategy: "none" },
    });

    expect(JSON.stringify(op.inputsRedacted)).not.toContain(token);

    const row = await opened.db.selectFrom("operations").selectAll().where("operation_id", "=", op.operationId).executeTakeFirstOrThrow();
    expect(row.inputs_redacted_json).not.toContain(token);
  });

  it("paginates list() with a stable cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const op = await ledger.begin({
        operationId: newId("op"),
        shopId: "shop_page",
        credentialId: "cred_1",
        credentialLabel: "CI",
        tool: "tool.x",
        tier: "pro",
        risk: "read",
        inputsHash: inputsFingerprint({ i }),
        inputsRedacted: { i },
        resources: [],
        changes: [],
        evidence: [],
        warnings: [],
        rollback: { available: false, strategy: "none" },
      });
      ids.push(op.operationId);
      await new Promise((r) => setTimeout(r, 2));
    }

    const page1 = await ledger.list("shop_page", { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await ledger.list("shop_page", { limit: 2, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(2);

    const page3 = await ledger.list("shop_page", { limit: 2, cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeUndefined();

    const seen = [...page1.items, ...page2.items, ...page3.items].map((o) => o.operationId);
    expect(new Set(seen).size).toBe(5); // no dupes/gaps across pages
    // newest first
    expect(seen[0]).toBe(ids[4]);
  });
});

describe("ledger: snapshots", () => {
  let opened: OpenedDatabase;
  let dataDir: string;
  let store: FileSnapshotStore;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    dataDir = mkdtempSync(join(tmpdir(), "cp-ledger-test-"));
    store = new FileSnapshotStore(opened.db, dataDir);
  });
  afterEach(() => {
    opened.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("round-trips theme files and dedupes identical content to one blob", async () => {
    const files: ThemeFile[] = [
      { key: "sections/hero.liquid", content: "<section>hero</section>" },
      { key: "sections/footer.liquid", content: "<section>hero</section>" }, // same bytes as hero on purpose
    ];
    const snap = await store.createThemeSnapshot("shop_1", "theme_1", files, { label: "before edit", createdBy: "test" });
    expect(snap.fileCount).toBe(2);

    const blobRows = await opened.db.selectFrom("blobs").selectAll().execute();
    expect(blobRows).toHaveLength(1); // deduped

    const readBack = await store.readThemeFiles(snap.snapshotId);
    expect(readBack).toHaveLength(2);
    const byKey = Object.fromEntries(readBack.map((f) => [f.key, f]));
    expect(byKey["sections/hero.liquid"]?.content).toBe("<section>hero</section>");
    expect(byKey["sections/footer.liquid"]?.content).toBe("<section>hero</section>");

    const single = await store.readThemeFiles(snap.snapshotId, ["sections/hero.liquid"]);
    expect(single).toHaveLength(1);
  });

  it("round-trips binary content via base64", async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 255, 254]);
    const snap = await store.createThemeSnapshot("shop_1", "theme_1", [{ key: "assets/icon.png", contentBase64: bytes.toString("base64") }], {
      label: "binary",
      createdBy: "test",
    });
    const [file] = await store.readThemeFiles(snap.snapshotId);
    expect(file).toBeDefined();
    const roundTripped = file!.contentBase64 !== undefined ? Buffer.from(file!.contentBase64, "base64") : Buffer.from(file!.content ?? "", "utf8");
    expect(roundTripped.equals(bytes)).toBe(true);
  });

  it("round-trips resource snapshots", async () => {
    const snap = await store.createResourceSnapshot(
      "shop_1",
      [{ id: "1", type: "product", body: { title: "Widget" } }],
      { label: "before update", createdBy: "test" },
    );
    const [resource] = await store.readResources(snap.snapshotId);
    expect(resource).toEqual({ id: "1", type: "product", body: { title: "Widget" } });
  });

  it("gcBlobs removes blobs no longer referenced after delete", async () => {
    const snap = await store.createThemeSnapshot("shop_1", "theme_1", [{ key: "a.liquid", content: "only-here" }], {
      label: "gc test",
      createdBy: "test",
    });
    await store.delete(snap.snapshotId);
    const { removed } = await store.gcBlobs();
    expect(removed).toBe(1);
    const blobRows = await opened.db.selectFrom("blobs").selectAll().execute();
    expect(blobRows).toHaveLength(0);
  });
});

describe("ledger: approvals", () => {
  let opened: OpenedDatabase;
  let approvals: SqliteApprovalService;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    approvals = new SqliteApprovalService(opened.db);
  });
  afterEach(() => opened.close());

  const req = { shopId: "shop_1", credentialId: "cred_1", tool: "theme.publish", planHash: fingerprint({ x: 1 }) };

  it("consumes a freshly issued token exactly once", async () => {
    const { token } = await approvals.issue({ ...req, issuedBy: "merchant@example.com" });
    const first = await approvals.consume({ token, shopId: req.shopId, tool: req.tool, planHash: req.planHash });
    expect(first).toEqual({ ok: true, approvedBy: "merchant@example.com" });

    const second = await approvals.consume({ token, shopId: req.shopId, tool: req.tool, planHash: req.planHash });
    expect(second).toEqual({ ok: false, reason: "consumed" });
  });

  it("rejects an unknown token as invalid", async () => {
    const result = await approvals.consume({ token: "apv_does-not-exist", shopId: req.shopId, tool: req.tool, planHash: req.planHash });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired token", async () => {
    const { token } = await approvals.issue({ ...req, issuedBy: "merchant@example.com", ttlMs: -1000 });
    const result = await approvals.consume({ token, shopId: req.shopId, tool: req.tool, planHash: req.planHash });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a (shop, tool, planHash) mismatch", async () => {
    const { token } = await approvals.issue({ ...req, issuedBy: "merchant@example.com" });
    const result = await approvals.consume({ token, shopId: req.shopId, tool: "a-different-tool", planHash: req.planHash });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("ledger: rollback", () => {
  let opened: OpenedDatabase;
  let dataDir: string;
  let ledger: SqliteLedger;
  let snapshots: FileSnapshotStore;
  let rollback: RollbackService;
  let theme: FakeThemeEngine;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    dataDir = mkdtempSync(join(tmpdir(), "cp-ledger-rollback-"));
    ledger = new SqliteLedger(opened.db);
    snapshots = new FileSnapshotStore(opened.db, dataDir);
    rollback = new RollbackService(ledger, snapshots);
    theme = new FakeThemeEngine();
  });
  afterEach(() => {
    opened.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("restores a file update via ledger_before_image", async () => {
    theme.addTheme({ id: "theme_1", name: "Main", role: "main" }, [{ key: "sections/hero.liquid", content: "before" }]);
    await theme.writeFiles("theme_1", [{ key: "sections/hero.liquid", content: "after" }]);

    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.file.update",
      tier: "pro",
      risk: "theme_write",
      inputsHash: fingerprint({ key: "sections/hero.liquid" }),
      inputsRedacted: {},
      resources: ["theme_file:theme_1:sections/hero.liquid"],
      changes: [
        {
          resource: "theme_file:theme_1:sections/hero.liquid",
          kind: "update",
          before: { content: "before" },
          after: { content: "after" },
          fingerprintBefore: fingerprint("before"),
          fingerprintAfter: fingerprint("after"),
        },
      ],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "ledger_before_image" },
    });
    await ledger.finish(op.operationId, { status: "succeeded" });

    const plan = await rollback.plan(op.operationId);
    expect(plan.available).toBe(true);
    expect(plan.strategy).toBe("ledger_before_image");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.action).toBe("restore");

    const result = await rollback.execute(op.operationId, { theme, verifyFingerprints: true });
    expect(result.status).toBe("succeeded");
    expect(await fileContent(theme, "theme_1", "sections/hero.liquid")).toBe("before");

    const original = await ledger.get(op.operationId);
    expect(original?.status).toBe("rolled_back");
    expect(original?.rollback.byOperationId).toBe(result.operationId);
  });

  it("undoes a file creation by deleting it, and re-creates a deleted file from its before-image", async () => {
    theme.addTheme({ id: "theme_1", name: "Main", role: "main" }, [{ key: "snippets/old.liquid", content: "old" }]);
    await theme.writeFiles("theme_1", [{ key: "snippets/new.liquid", content: "new" }]);
    await theme.deleteFiles("theme_1", ["snippets/old.liquid"]);

    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.files.apply",
      tier: "free",
      risk: "theme_write",
      inputsHash: fingerprint({}),
      inputsRedacted: {},
      resources: ["theme_file:theme_1:snippets/new.liquid", "theme_file:theme_1:snippets/old.liquid"],
      changes: [
        { resource: "theme_file:theme_1:snippets/new.liquid", kind: "create", after: "new", fingerprintAfter: fingerprint("new") },
        { resource: "theme_file:theme_1:snippets/old.liquid", kind: "delete", before: "old", fingerprintBefore: fingerprint("old") },
      ],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "ledger_before_image" },
    });
    await ledger.finish(op.operationId, { status: "succeeded" });

    const plan = await rollback.plan(op.operationId);
    expect(plan.available).toBe(true);
    expect(plan.steps.map((s) => s.action)).toEqual(["delete", "restore"]);

    const result = await rollback.execute(op.operationId, { theme, verifyFingerprints: true });
    expect(result.status).toBe("succeeded");
    const [created] = await theme.readFiles("theme_1", ["snippets/new.liquid"]);
    expect(created).toBeUndefined();
    expect(await fileContent(theme, "theme_1", "snippets/old.liquid")).toBe("old");
  });

  it("refuses to restore when the live fingerprint no longer matches (unless forced)", async () => {
    theme.addTheme({ id: "theme_1", name: "Main", role: "main" }, [{ key: "sections/hero.liquid", content: "before" }]);
    await theme.writeFiles("theme_1", [{ key: "sections/hero.liquid", content: "after" }]);

    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.file.update",
      tier: "pro",
      risk: "theme_write",
      inputsHash: fingerprint({ key: "sections/hero.liquid" }),
      inputsRedacted: {},
      resources: ["theme_file:theme_1:sections/hero.liquid"],
      changes: [
        {
          resource: "theme_file:theme_1:sections/hero.liquid",
          kind: "update",
          before: { content: "before" },
          after: { content: "after" },
          fingerprintBefore: fingerprint("before"),
          fingerprintAfter: fingerprint("after"),
        },
      ],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "ledger_before_image" },
    });
    await ledger.finish(op.operationId, { status: "succeeded" });

    // Someone else changed the live file after our operation finished.
    await theme.writeFiles("theme_1", [{ key: "sections/hero.liquid", content: "changed-by-someone-else" }]);

    await expect(rollback.execute(op.operationId, { theme, verifyFingerprints: true })).rejects.toMatchObject({ code: "FINGERPRINT_MISMATCH" });
    // still whatever the interloper wrote
    expect(await fileContent(theme, "theme_1", "sections/hero.liquid")).toBe("changed-by-someone-else");

    const forced = await rollback.execute(op.operationId, { theme, verifyFingerprints: true, force: true });
    expect(forced.status).toBe("succeeded");
    expect(await fileContent(theme, "theme_1", "sections/hero.liquid")).toBe("before");
  });

  it("restores from a snapshot, leaving extra files alone unless pruneExtras is set", async () => {
    theme.addTheme({ id: "theme_1", name: "Main", role: "main" }, [{ key: "sections/hero.liquid", content: "v1" }]);
    const snap = await snapshots.createThemeSnapshot("shop_1", "theme_1", [{ key: "sections/hero.liquid", content: "v1" }], {
      label: "baseline",
      createdBy: "test",
    });

    await theme.writeFiles("theme_1", [
      { key: "sections/hero.liquid", content: "v2" },
      { key: "sections/new-file.liquid", content: "added later" },
    ]);

    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.bulk.edit",
      tier: "pro",
      risk: "bulk",
      inputsHash: fingerprint({}),
      inputsRedacted: {},
      resources: [],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "snapshot", snapshotId: snap.snapshotId },
    });
    await ledger.finish(op.operationId, { status: "succeeded" });

    const plan = await rollback.plan(op.operationId);
    expect(plan.available).toBe(true);
    expect(plan.strategy).toBe("snapshot");

    const result = await rollback.execute(op.operationId, { theme, verifyFingerprints: false });
    expect(result.status).toBe("succeeded");
    expect(await fileContent(theme, "theme_1", "sections/hero.liquid")).toBe("v1");
    expect(await fileContent(theme, "theme_1", "sections/new-file.liquid")).toBe("added later"); // left alone

    // Reset and try again with pruneExtras
    await theme.writeFiles("theme_1", [{ key: "sections/hero.liquid", content: "v2-again" }]);
    const op2 = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.bulk.edit",
      tier: "pro",
      risk: "bulk",
      inputsHash: fingerprint({ n: 2 }),
      inputsRedacted: {},
      resources: [],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "snapshot", snapshotId: snap.snapshotId },
    });
    await ledger.finish(op2.operationId, { status: "succeeded" });
    await rollback.execute(op2.operationId, { theme, verifyFingerprints: false, pruneExtras: true });
    expect(await fileContent(theme, "theme_1", "sections/new-file.liquid")).toBeUndefined();
  });

  it("republishes the previous theme via republish_previous", async () => {
    theme.addTheme({ id: "theme_old", name: "Old main", role: "unpublished" });
    theme.addTheme({ id: "theme_new", name: "New main", role: "main" });

    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "theme.publish",
      tier: "pro",
      risk: "publish",
      inputsHash: fingerprint({ themeId: "theme_new" }),
      inputsRedacted: {},
      resources: ["theme:theme_new"],
      changes: [{ resource: "theme:publish", kind: "publish", before: "theme_old", after: "theme_new" }],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "republish_previous" },
    });
    await ledger.finish(op.operationId, { status: "succeeded" });

    const plan = await rollback.plan(op.operationId);
    expect(plan.available).toBe(true);
    expect(plan.steps[0]?.action).toBe("publish");

    const result = await rollback.execute(op.operationId, { theme, verifyFingerprints: false });
    expect(result.status).toBe("succeeded");
    const oldRef = await theme.getTheme("theme_old");
    expect(oldRef?.role).toBe("main");
  });

  it("reports inverse_operation as not available (NOT_SUPPORTED) in 0.1", async () => {
    const op = await ledger.begin({
      operationId: newId("op"),
      shopId: "shop_1",
      credentialId: "cred_1",
      credentialLabel: "CI",
      tool: "order.note.update",
      tier: "pro",
      risk: "write",
      inputsHash: fingerprint({}),
      inputsRedacted: {},
      resources: [],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "inverse_operation" },
    });
    await ledger.finish(op.operationId, { status: "succeeded" });

    const plan = await rollback.plan(op.operationId);
    expect(plan.available).toBe(false);

    await expect(rollback.execute(op.operationId, { theme, verifyFingerprints: false })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });
});
