import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Schema } from "@shopmanagerai/storage";
import { newId, sha256 } from "@shopmanagerai/shared";
import type { SnapshotStore, SnapshotRecord, ThemeFile } from "@shopmanagerai/shared";

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function blobPath(blobsDir: string, hash: string): string {
  // content-addressed, sharded two levels deep to avoid huge flat directories
  return join(blobsDir, hash.slice(0, 2), hash.slice(2, 4), hash);
}

function mapSnapshotRow(row: any): SnapshotRecord {
  return {
    snapshotId: row.snapshot_id,
    shopId: row.shop_id,
    kind: row.kind,
    label: row.label,
    themeId: row.theme_id ?? undefined,
    resourceIds: parseJson(row.resource_ids_json, undefined),
    fileCount: row.file_count ?? undefined,
    bytes: row.bytes ?? undefined,
    createdAt: row.created_at,
    createdBy: row.created_by,
    operationId: row.operation_id ?? undefined,
  };
}

/**
 * Filesystem-backed snapshot store. Each file's content is hashed and written
 * once to a content-addressed blob under `{dataDir}/blobs/ab/cd/<hash>`; the
 * `snapshot_files` table just maps `(snapshot_id, key) -> blob_hash`, so
 * identical content shared across snapshots (or repeated within one) is only
 * ever stored on disk once.
 */
export class FileSnapshotStore implements SnapshotStore {
  private readonly blobsDir: string;

  constructor(
    private readonly db: Kysely<Schema>,
    dataDir: string,
  ) {
    this.blobsDir = join(dataDir, "blobs");
    if (!existsSync(this.blobsDir)) mkdirSync(this.blobsDir, { recursive: true });
  }

  private writeBlob(bytes: Buffer): string {
    const hash = sha256(bytes);
    const path = blobPath(this.blobsDir, hash);
    if (!existsSync(path)) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, bytes);
    }
    return hash;
  }

  private async ensureBlobRow(hash: string, bytes: number): Promise<void> {
    const existing = await this.db.selectFrom("blobs").select("blob_hash").where("blob_hash", "=", hash).executeTakeFirst();
    if (existing) return;
    await this.db
      .insertInto("blobs")
      .values({ blob_hash: hash, bytes, stored_at: new Date().toISOString() })
      .execute();
  }

  private readBlob(hash: string): Buffer {
    const path = blobPath(this.blobsDir, hash);
    return readFileSync(path);
  }

  async createThemeSnapshot(
    shopId: string,
    themeId: string,
    files: ThemeFile[],
    meta: { label: string; createdBy: string; operationId?: string },
  ): Promise<SnapshotRecord> {
    const snapshotId = newId("snap");
    const now = new Date().toISOString();
    let totalBytes = 0;

    for (const file of files) {
      const bytes = file.contentBase64 !== undefined ? Buffer.from(file.contentBase64, "base64") : Buffer.from(file.content ?? "", "utf8");
      const hash = this.writeBlob(bytes);
      await this.ensureBlobRow(hash, bytes.length);
      await this.db
        .insertInto("snapshot_files")
        .values({
          snapshot_id: snapshotId,
          key: file.key,
          blob_hash: hash,
          size: bytes.length,
          content_type: file.contentType ?? null,
        })
        .execute();
      totalBytes += bytes.length;
    }

    await this.db
      .insertInto("snapshots")
      .values({
        snapshot_id: snapshotId,
        shop_id: shopId,
        kind: "theme",
        label: meta.label,
        theme_id: themeId,
        resource_ids_json: null,
        file_count: files.length,
        bytes: totalBytes,
        created_at: now,
        created_by: meta.createdBy,
        operation_id: meta.operationId ?? null,
      })
      .execute();

    const row = await this.getRow(snapshotId);
    if (!row) throw new Error("ledger: theme snapshot did not persist");
    return mapSnapshotRow(row);
  }

  async createResourceSnapshot(
    shopId: string,
    resources: Array<{ id: string; type: string; body: unknown }>,
    meta: { label: string; createdBy: string; operationId?: string },
  ): Promise<SnapshotRecord> {
    const snapshotId = newId("snap");
    const now = new Date().toISOString();
    let totalBytes = 0;

    for (const resource of resources) {
      const bytes = Buffer.from(JSON.stringify({ id: resource.id, type: resource.type, body: resource.body }), "utf8");
      const hash = this.writeBlob(bytes);
      await this.ensureBlobRow(hash, bytes.length);
      await this.db
        .insertInto("snapshot_files")
        .values({
          snapshot_id: snapshotId,
          key: `${resource.type}:${resource.id}`,
          blob_hash: hash,
          size: bytes.length,
          content_type: "application/json",
        })
        .execute();
      totalBytes += bytes.length;
    }

    await this.db
      .insertInto("snapshots")
      .values({
        snapshot_id: snapshotId,
        shop_id: shopId,
        kind: "resource",
        label: meta.label,
        theme_id: null,
        resource_ids_json: toJson(resources.map((r) => r.id)),
        file_count: resources.length,
        bytes: totalBytes,
        created_at: now,
        created_by: meta.createdBy,
        operation_id: meta.operationId ?? null,
      })
      .execute();

    const row = await this.getRow(snapshotId);
    if (!row) throw new Error("ledger: resource snapshot did not persist");
    return mapSnapshotRow(row);
  }

  async get(snapshotId: string): Promise<SnapshotRecord | null> {
    const row = await this.getRow(snapshotId);
    return row ? mapSnapshotRow(row) : null;
  }

  async list(shopId: string, opts: { kind?: SnapshotRecord["kind"]; limit?: number } = {}): Promise<SnapshotRecord[]> {
    let q = this.db.selectFrom("snapshots").selectAll().where("shop_id", "=", shopId);
    if (opts.kind) q = q.where("kind", "=", opts.kind);
    q = q.orderBy("created_at", "desc").limit(opts.limit ?? 100);
    const rows = await q.execute();
    return rows.map(mapSnapshotRow);
  }

  async readThemeFiles(snapshotId: string, keys?: string[]): Promise<ThemeFile[]> {
    let q = this.db.selectFrom("snapshot_files").selectAll().where("snapshot_id", "=", snapshotId);
    if (keys && keys.length > 0) q = q.where("key", "in", keys);
    const rows = await q.execute();
    return rows.map((row) => this.toThemeFile(row));
  }

  async readResources(snapshotId: string): Promise<Array<{ id: string; type: string; body: unknown }>> {
    const rows = await this.db.selectFrom("snapshot_files").selectAll().where("snapshot_id", "=", snapshotId).execute();
    return rows.map((row) => {
      const bytes = this.readBlob(row.blob_hash);
      const parsed = JSON.parse(bytes.toString("utf8"));
      return { id: parsed.id, type: parsed.type, body: parsed.body };
    });
  }

  async delete(snapshotId: string): Promise<void> {
    await this.db.deleteFrom("snapshot_files").where("snapshot_id", "=", snapshotId).execute();
    await this.db.deleteFrom("snapshots").where("snapshot_id", "=", snapshotId).execute();
  }

  /** Removes blob files (and rows) that are no longer referenced by any snapshot_files row. */
  async gcBlobs(): Promise<{ removed: number }> {
    const blobs = await this.db.selectFrom("blobs").select("blob_hash").execute();
    let removed = 0;
    for (const { blob_hash } of blobs) {
      const ref = await this.db.selectFrom("snapshot_files").select("snapshot_id").where("blob_hash", "=", blob_hash).executeTakeFirst();
      if (ref) continue;
      const path = blobPath(this.blobsDir, blob_hash);
      if (existsSync(path)) unlinkSync(path);
      await this.db.deleteFrom("blobs").where("blob_hash", "=", blob_hash).execute();
      removed++;
    }
    return { removed };
  }

  private toThemeFile(row: { key: string; blob_hash: string; size: number; content_type: string | null }): ThemeFile {
    const bytes = this.readBlob(row.blob_hash);
    const isText = row.content_type ? row.content_type.startsWith("text/") || row.content_type === "application/json" : isLikelyUtf8Text(bytes);
    const base: ThemeFile = { key: row.key, size: row.size, checksum: row.blob_hash };
    if (row.content_type) base.contentType = row.content_type;
    if (isText) {
      base.content = bytes.toString("utf8");
    } else {
      base.contentBase64 = bytes.toString("base64");
    }
    return base;
  }

  private async getRow(snapshotId: string) {
    return this.db.selectFrom("snapshots").selectAll().where("snapshot_id", "=", snapshotId).executeTakeFirst();
  }
}

/** Cheap heuristic: no NUL bytes and round-trips through utf8 cleanly. */
function isLikelyUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  return true;
}
