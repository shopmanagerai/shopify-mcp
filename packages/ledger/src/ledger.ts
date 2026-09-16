import type { Kysely } from "kysely";
import type { Schema } from "@shopmanagerai/storage";
import { fingerprint, redactValue } from "@shopmanagerai/shared";
import type { Ledger, OperationRecord } from "@shopmanagerai/shared";

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: any): OperationRecord {
  return {
    operationId: row.operation_id,
    shopId: row.shop_id,
    credentialId: row.credential_id,
    credentialLabel: row.credential_label,
    tool: row.tool,
    tier: row.tier,
    risk: row.risk,
    status: row.status,
    inputsHash: row.inputs_hash,
    inputsRedacted: parseJson(row.inputs_redacted_json, null),
    resources: parseJson(row.resources_json, []),
    changes: parseJson(row.changes_json, []),
    evidence: parseJson(row.evidence_json, []),
    warnings: parseJson(row.warnings_json, []),
    approval: parseJson(row.approval_json, undefined),
    rollback: parseJson(row.rollback_json, { available: false, strategy: "none" }),
    error: parseJson(row.error_json, undefined),
    era: row.era ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

/**
 * SQLite-backed implementation of the `Ledger` execution-plane interface
 * (packages/shared/src/planes.ts). Inputs are redacted (shared `redactValue`)
 * before they ever reach disk, and `inputsHash` is a stable fingerprint of the
 * *original* inputs so operations can still be deduplicated/matched without
 * storing secrets.
 */
export class SqliteLedger implements Ledger {
  constructor(private readonly db: Kysely<Schema>) {}

  async begin(rec: Omit<OperationRecord, "status" | "startedAt">): Promise<OperationRecord> {
    const startedAt = new Date().toISOString();
    const redactedInputs = redactValue(rec.inputsRedacted);
    const values = {
      operation_id: rec.operationId,
      shop_id: rec.shopId,
      credential_id: rec.credentialId,
      credential_label: rec.credentialLabel,
      tool: rec.tool,
      tier: rec.tier,
      risk: rec.risk,
      status: "pending",
      inputs_hash: rec.inputsHash,
      inputs_redacted_json: toJson(redactedInputs),
      resources_json: toJson(rec.resources ?? []),
      changes_json: toJson(rec.changes ?? []),
      evidence_json: toJson(rec.evidence ?? []),
      warnings_json: toJson(rec.warnings ?? []),
      approval_json: toJson(rec.approval),
      rollback_json: toJson(rec.rollback ?? { available: false, strategy: "none" }),
      error_json: toJson(rec.error),
      era: rec.era ?? null,
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
    };
    await this.db.insertInto("operations").values(values).execute();
    const row = await this.getRow(rec.operationId);
    if (!row) throw new Error("ledger: begin() failed to persist operation");
    return mapRow(row);
  }

  async finish(operationId: string, patch: Partial<OperationRecord>): Promise<OperationRecord> {
    const existing = await this.getRow(operationId);
    if (!existing) throw new Error(`ledger: no such operation ${operationId}`);

    const finishedAt = patch.finishedAt ?? new Date().toISOString();
    const startedAtMs = new Date(existing.started_at).getTime();
    const durationMs = patch.durationMs ?? Math.max(0, new Date(finishedAt).getTime() - startedAtMs);

    const set: Record<string, unknown> = { finished_at: finishedAt, duration_ms: durationMs };
    if (patch.status !== undefined) set["status"] = patch.status;
    if (patch.resources !== undefined) set["resources_json"] = toJson(patch.resources);
    if (patch.changes !== undefined) set["changes_json"] = toJson(patch.changes);
    if (patch.evidence !== undefined) set["evidence_json"] = toJson(patch.evidence);
    if (patch.warnings !== undefined) set["warnings_json"] = toJson(patch.warnings);
    if (patch.approval !== undefined) set["approval_json"] = toJson(patch.approval);
    if (patch.rollback !== undefined) set["rollback_json"] = toJson(patch.rollback);
    if (patch.error !== undefined) set["error_json"] = toJson(patch.error);
    if (patch.era !== undefined) set["era"] = patch.era;
    if (patch.credentialLabel !== undefined) set["credential_label"] = patch.credentialLabel;

    await this.db.updateTable("operations").set(set as any).where("operation_id", "=", operationId).execute();
    const row = await this.getRow(operationId);
    if (!row) throw new Error(`ledger: no such operation ${operationId}`);
    return mapRow(row);
  }

  async get(operationId: string): Promise<OperationRecord | null> {
    const row = await this.getRow(operationId);
    return row ? mapRow(row) : null;
  }

  async list(
    shopId: string,
    opts: { limit?: number; cursor?: string; tool?: string; status?: OperationRecord["status"] } = {},
  ): Promise<{ items: OperationRecord[]; nextCursor?: string }> {
    const limit = opts.limit ?? 50;
    let q = this.db.selectFrom("operations").selectAll().where("shop_id", "=", shopId);
    if (opts.tool) q = q.where("tool", "=", opts.tool);
    if (opts.status) q = q.where("status", "=", opts.status);

    if (opts.cursor) {
      const [startedAt, operationId] = decodeCursor(opts.cursor);
      q = q.where((eb) =>
        eb.or([
          eb("started_at", "<", startedAt),
          eb.and([eb("started_at", "=", startedAt), eb("operation_id", "<", operationId)]),
        ]),
      );
    }

    q = q.orderBy("started_at", "desc").orderBy("operation_id", "desc").limit(limit + 1);
    const rows = await q.execute();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map(mapRow);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.startedAt, last.operationId) : undefined;
    return { items, nextCursor };
  }

  private async getRow(operationId: string) {
    return this.db.selectFrom("operations").selectAll().where("operation_id", "=", operationId).executeTakeFirst();
  }
}

function encodeCursor(startedAt: string, operationId: string): string {
  return `${startedAt}|${operationId}`;
}
function decodeCursor(cursor: string): [string, string] {
  const idx = cursor.indexOf("|");
  if (idx < 0) return [cursor, ""];
  return [cursor.slice(0, idx), cursor.slice(idx + 1)];
}

/** Computes the ledger's stable inputs-hash the same way everywhere. */
export function inputsFingerprint(inputs: unknown): string {
  return fingerprint(inputs);
}
