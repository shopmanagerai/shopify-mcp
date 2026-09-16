import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId } from "@shopmanagerai/shared";
import { openDatabase, type OpenedDatabase } from "./db.js";
import { SecretStore, encryptSecret, decryptSecret, loadMasterKey } from "./crypto.js";
import { ShopRepo, CredentialRepo } from "./repos.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("storage: migrations", () => {
  let opened: OpenedDatabase;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
  });
  afterEach(() => {
    opened.close();
  });

  it("creates all expected tables on an in-memory db", async () => {
    const tables = [
      "shops",
      "secrets",
      "credentials",
      "oauth_clients",
      "oauth_codes",
      "oauth_tokens",
      "operations",
      "snapshots",
      "snapshot_files",
      "blobs",
      "approvals",
      "jobs",
      "capability_cache",
      "kv",
    ];
    for (const t of tables) {
      // simple smoke query against each table
      const rows = await (opened.db as any).selectFrom(t).selectAll().limit(1).execute();
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  it("reports a driver", () => {
    expect(["better-sqlite3", "node:sqlite"]).toContain(opened.driver);
  });
});

describe("storage: secrets", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "cp-storage-test-"));
    delete process.env["SHOPMANAGER_MASTER_KEY"];
    delete process.env["SHOPMANAGERAI_MASTER_KEY"];
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("round-trips a plaintext value through encrypt/decrypt", () => {
    const key = loadMasterKey(dataDir);
    const enc = encryptSecret("shpat_supersecrettoken1234567890", key);
    const plain = decryptSecret(enc, key);
    expect(plain).toBe("shpat_supersecrettoken1234567890");
  });

  it("detects tampering with the ciphertext (auth tag fails)", () => {
    const key = loadMasterKey(dataDir);
    const enc = encryptSecret("theme-access-password-abc", key);
    const tampered = { ...enc, ciphertext: Buffer.from("tampered-bytes-xxxxxxxxxxxx").toString("base64") };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("SecretStore round-trips via the db and never stores plaintext", async () => {
    const opened = await openDatabase({ path: ":memory:" });
    try {
      const store = new SecretStore(opened.db, dataDir);
      await store.set("shop_1", "admin_token", "shpat_abcdefghijklmnopqrstuvwxyz");
      const value = await store.get("shop_1", "admin_token");
      expect(value).toBe("shpat_abcdefghijklmnopqrstuvwxyz");

      const row = await opened.db
        .selectFrom("secrets")
        .selectAll()
        .where("shop_id", "=", "shop_1")
        .where("kind", "=", "admin_token")
        .executeTakeFirstOrThrow();
      expect(row.ciphertext).not.toContain("shpat_");
      expect(JSON.stringify(row)).not.toContain("shpat_abcdefghijklmnopqrstuvwxyz");

      expect(await store.has("shop_1", "admin_token")).toBe(true);
      await store.delete("shop_1", "admin_token");
      expect(await store.has("shop_1", "admin_token")).toBe(false);
      expect(await store.get("shop_1", "admin_token")).toBeNull();
    } finally {
      opened.close();
    }
  });
});

describe("storage: repos", () => {
  let opened: OpenedDatabase;
  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
  });
  afterEach(() => {
    opened.close();
  });

  it("ShopRepo upserts and reads back a shop", async () => {
    const repo = new ShopRepo(opened.db);
    const shopId = newId("shop");
    await repo.upsert({ shopId, domain: "example.myshopify.com", name: "Example", plan: "basic" });
    const byDomain = await repo.getByDomain("example.myshopify.com");
    expect(byDomain?.shopId).toBe(shopId);
    expect(byDomain?.name).toBe("Example");

    await repo.upsert({ shopId, domain: "example.myshopify.com", plan: "plus" });
    const updated = await repo.getById(shopId);
    expect(updated?.plan).toBe("plus");
    expect(updated?.name).toBe("Example"); // preserved across partial upsert

    await repo.markUninstalled(shopId);
    const uninstalled = await repo.getById(shopId);
    expect(uninstalled?.uninstalledAt).not.toBeNull();
  });

  it("CredentialRepo creates and looks up credentials by token hash", async () => {
    const repo = new CredentialRepo(opened.db);
    const credentialId = newId("cred");
    const token = "cp_" + "x".repeat(32);
    await repo.create({
      credentialId,
      shopId: "shop_1",
      kind: "token",
      label: "CI token",
      profile: "read_only",
      token,
      scopes: ["read_themes"],
    });

    const hash = CredentialRepo.hashToken(token);
    const found = await repo.findByTokenHash(hash);
    expect(found?.credentialId).toBe(credentialId);
    expect(found?.label).toBe("CI token");

    // wrong token never matches
    const wrongHash = CredentialRepo.hashToken("cp_" + "y".repeat(32));
    expect(await repo.findByTokenHash(wrongHash)).toBeNull();

    await repo.touch(credentialId);
    const touched = await repo.get(credentialId);
    expect(touched?.lastUsedAt).not.toBeNull();

    await repo.revoke(credentialId);
    const revoked = await repo.get(credentialId);
    expect(revoked?.revokedAt).not.toBeNull();

    const list = await repo.listByShop("shop_1");
    expect(list.some((c) => c.credentialId === credentialId)).toBe(true);
  });
});
