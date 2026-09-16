/**
 * Envelope encryption for secrets (offline tokens, Theme Access passwords, app
 * client secrets). AES-256-GCM with a master key sourced from
 * `SHOPMANAGER_MASTER_KEY` (base64, 32 bytes); falls back to a dev key file
 * generated on first run (with a loud stderr warning. Never use in production).
 *
 * Never logs plaintext secret values.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Schema } from "./schema.js";

const ALGO = "aes-256-gcm";
const KEY_VERSION = 1;

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  keyVersion: number;
}

// Cached per data dir (or "$env" when sourced from SHOPMANAGER_MASTER_KEY) so
// tests using distinct dataDirs in the same process don't cross-contaminate.
const cachedMasterKeys = new Map<string, Buffer>();

/** Resolves the master key: env var first, else a dev key file under `{dataDir}/dev-master.key`. */
export function loadMasterKey(dataDir: string): Buffer {
  const fromEnv = process.env["SHOPMANAGER_MASTER_KEY"] ?? process.env["SHOPMANAGERAI_MASTER_KEY"];
  if (fromEnv) {
    const cached = cachedMasterKeys.get("$env");
    if (cached) return cached;
    const buf = Buffer.from(fromEnv, "base64");
    if (buf.length !== 32) {
      throw new Error(`SHOPMANAGER_MASTER_KEY must decode to 32 bytes (got ${buf.length}).`);
    }
    cachedMasterKeys.set("$env", buf);
    return buf;
  }

  const cached = cachedMasterKeys.get(dataDir);
  if (cached) return cached;

  const keyPath = join(dataDir, "dev-master.key");
  if (existsSync(keyPath)) {
    const buf = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    cachedMasterKeys.set(dataDir, buf);
    return buf;
  }

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  // eslint-disable-next-line no-console
  console.error(
    `[shopmanager/storage] WARNING: no SHOPMANAGER_MASTER_KEY set. Generated a dev-only master key at ${keyPath}. ` +
      "Do not use this in production, set SHOPMANAGER_MASTER_KEY (base64, 32 bytes) instead.",
  );
  cachedMasterKeys.set(dataDir, key);
  return key;
}

export function encryptSecret(plain: string, masterKey: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptSecret(enc: EncryptedSecret, masterKey: Buffer): string {
  const iv = Buffer.from(enc.iv, "base64");
  const tag = Buffer.from(enc.tag, "base64");
  const ciphertext = Buffer.from(enc.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, masterKey, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  } catch (e) {
    throw new Error("storage: secret decryption failed (tampered ciphertext or wrong key).", { cause: e });
  }
}

export type SecretKind = "admin_token" | "theme_access" | "app_client_secret" | "storefront_password";

/** Small repository over the `secrets` table with envelope encryption baked in. Never logs values. */
export type MasterKeyProvider = "env" | "file" | "aws-kms";
export interface ResolveMasterKeyOptions {
  provider?: MasterKeyProvider;
  dataDir: string;
  /** aws-kms: the KMS key id/ARN/alias used to wrap the data key. */
  kmsKeyId?: string;
  kmsRegion?: string;
}

/**
 * Resolves the 32-byte master key once at boot.
 * - env  (default when SHOPMANAGER_MASTER_KEY is set): base64 key from the environment.
 * - file: dev key file under dataDir (auto-generated, dev only).
 * - aws-kms: envelope encryption with AWS KMS. The data key is generated once with
 *   GenerateDataKey (AES_256), its ciphertext stored at {dataDir}/master.key.kms and
 *   decrypted with KMS on every boot; the plaintext never touches disk. Needs the
 *   optional @aws-sdk/client-kms dependency and AWS credentials in the environment.
 *   UNVERIFIED against a live AWS account (no credentials in this workspace); the
 *   call shapes follow the SDK v3 reference.
 */
export async function resolveMasterKey(opts: ResolveMasterKeyOptions): Promise<Buffer> {
  const provider = opts.provider ?? (process.env["SHOPMANAGER_MASTER_KEY"] || process.env["SHOPMANAGERAI_MASTER_KEY"] ? "env" : "file");
  if (provider === "env" || provider === "file") return loadMasterKey(opts.dataDir);
  if (!opts.kmsKeyId) throw new Error("MASTER_KEY_PROVIDER=aws-kms needs KMS_KEY_ID.");
  const cached = cachedMasterKeys.get(`kms:${opts.kmsKeyId}`);
  if (cached) return cached;
  let kms: any;
  try {
    const optional = "@aws-sdk/client-kms"; // optional dependency: resolved at runtime only
    kms = await import(optional);
  } catch {
    throw new Error("MASTER_KEY_PROVIDER=aws-kms needs the optional dependency @aws-sdk/client-kms (pnpm add @aws-sdk/client-kms -w).");
  }
  const client = new kms.KMSClient(opts.kmsRegion ? { region: opts.kmsRegion } : {});
  if (!existsSync(opts.dataDir)) mkdirSync(opts.dataDir, { recursive: true });
  const wrappedPath = join(opts.dataDir, "master.key.kms");
  let plaintext: Buffer;
  if (existsSync(wrappedPath)) {
    const wrapped = Buffer.from(readFileSync(wrappedPath, "utf8").trim(), "base64");
    const out = await client.send(new kms.DecryptCommand({ KeyId: opts.kmsKeyId, CiphertextBlob: wrapped }));
    plaintext = Buffer.from(out.Plaintext);
  } else {
    const out = await client.send(new kms.GenerateDataKeyCommand({ KeyId: opts.kmsKeyId, KeySpec: "AES_256" }));
    plaintext = Buffer.from(out.Plaintext);
    writeFileSync(wrappedPath, Buffer.from(out.CiphertextBlob).toString("base64"), { mode: 0o600 });
  }
  if (plaintext.length !== 32) throw new Error(`KMS data key must be 32 bytes (got ${plaintext.length}).`);
  cachedMasterKeys.set(`kms:${opts.kmsKeyId}`, plaintext);
  return plaintext;
}

export class SecretStore {
  constructor(
    private readonly db: Kysely<Schema>,
    private readonly dataDir: string,
    /** Explicit master key (from resolveMasterKey); falls back to loadMasterKey(dataDir). */
    private readonly explicitKey?: Buffer,
  ) {}

  private key(): Buffer {
    return this.explicitKey ?? loadMasterKey(this.dataDir);
  }

  async set(shopId: string, kind: SecretKind, value: string): Promise<void> {
    const enc = encryptSecret(value, this.key());
    const now = new Date().toISOString();
    await this.db
      .insertInto("secrets")
      .values({
        shop_id: shopId,
        kind,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        tag: enc.tag,
        key_version: enc.keyVersion,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(["shop_id", "kind"]).doUpdateSet({
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          key_version: enc.keyVersion,
          updated_at: now,
        }),
      )
      .execute();
  }

  async get(shopId: string, kind: SecretKind): Promise<string | null> {
    const row = await this.db
      .selectFrom("secrets")
      .selectAll()
      .where("shop_id", "=", shopId)
      .where("kind", "=", kind)
      .executeTakeFirst();
    if (!row) return null;
    return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version }, this.key());
  }

  async delete(shopId: string, kind: SecretKind): Promise<void> {
    await this.db.deleteFrom("secrets").where("shop_id", "=", shopId).where("kind", "=", kind).execute();
  }

  async has(shopId: string, kind: SecretKind): Promise<boolean> {
    const row = await this.db
      .selectFrom("secrets")
      .select("shop_id")
      .where("shop_id", "=", shopId)
      .where("kind", "=", kind)
      .executeTakeFirst();
    return row !== undefined;
  }
}

/** Helper used by tests / callers who want the default dev data dir layout. */
export function defaultDataDir(base: string): string {
  return join(base, ".shopmanagerai");
}
