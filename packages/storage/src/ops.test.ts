import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, resolveMasterKey, SecretStore, encryptSecret, decryptSecret } from "./index.js";

describe("storage hardening (Phase 8)", () => {
  it("openDatabase routes postgres:// urls to the Postgres dialect rather than silently opening sqlite", async () => {
    // Both failure paths name Postgres: the optional `pg` driver being absent,
    // and the connection itself failing. Asserting on one of them made the test
    // depend on whether optional dependencies happened to be installed.
    await expect(openDatabase({ path: ":memory:", url: "postgres://user:pw@localhost:5432/db" })).rejects.toThrow(/postgres/i);
  });

  it("openDatabase ignores a non-postgres url and opens sqlite", async () => {
    const { db, close, driver } = await openDatabase({ path: ":memory:", url: "mysql://nope" });
    expect(driver).not.toBe("postgres");
    await db.selectFrom("kv").select("key").execute();
    close();
  });

  it("resolveMasterKey: env/file providers return 32 bytes; aws-kms without KMS_KEY_ID fails clearly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-key-"));
    try {
      const k = await resolveMasterKey({ provider: "file", dataDir: dir });
      expect(k.length).toBe(32);
      expect(existsSync(join(dir, "dev-master.key"))).toBe(true);
      await expect(resolveMasterKey({ provider: "aws-kms", dataDir: dir })).rejects.toThrow(/KMS_KEY_ID/);
      const enc = encryptSecret("hello", k);
      expect(decryptSecret(enc, k)).toBe("hello");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("SecretStore uses an explicit key when given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-key2-"));
    const { db, close } = await openDatabase({ path: ":memory:" });
    try {
      const key = Buffer.alloc(32, 7);
      const store = new SecretStore(db, dir, key);
      await store.set("shop_1", "admin_token", "shpat_x");
      expect(await store.get("shop_1", "admin_token")).toBe("shpat_x");
      const other = new SecretStore(db, dir, Buffer.alloc(32, 9));
      await expect(other.get("shop_1", "admin_token")).rejects.toThrow();
    } finally { close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
