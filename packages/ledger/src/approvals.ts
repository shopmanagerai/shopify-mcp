import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { Schema } from "@shopmanagerai/storage";
import { sha256 } from "@shopmanagerai/shared";
import type { ApprovalService } from "@shopmanagerai/shared";

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes, per docs/AUTHENTICATION_ARCHITECTURE.md §5

function newApprovalToken(): string {
  return "apv_" + randomBytes(32).toString("base64url");
}

/**
 * SQLite-backed `ApprovalService`. Tokens are shown once by the caller and
 * stored only as a sha256 hash (same convention as credential/oauth tokens).
 * `consume` is a single atomic UPDATE ... WHERE (guarded by the token's still
 * being unconsumed and unexpired) so two concurrent consumers can't both
 * succeed for the same token.
 */
export class SqliteApprovalService implements ApprovalService {
  constructor(private readonly db: Kysely<Schema>) {}

  async issue(input: {
    shopId: string;
    credentialId: string;
    tool: string;
    planHash: string;
    ttlMs?: number;
    issuedBy: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const token = newApprovalToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString();
    await this.db
      .insertInto("approvals")
      .values({
        token_hash: tokenHash,
        shop_id: input.shopId,
        credential_id: input.credentialId,
        tool: input.tool,
        plan_hash: input.planHash,
        issued_by: input.issuedBy,
        expires_at: expiresAt,
        consumed_at: null,
      })
      .execute();
    return { token, expiresAt };
  }

  async consume(input: {
    token: string;
    shopId: string;
    tool: string;
    planHash: string;
  }): Promise<{ ok: true; approvedBy: string } | { ok: false; reason: "invalid" | "expired" | "consumed" | "mismatch" }> {
    const tokenHash = sha256(input.token);
    const row = await this.db.selectFrom("approvals").selectAll().where("token_hash", "=", tokenHash).executeTakeFirst();
    if (!row) return { ok: false, reason: "invalid" };

    if (row.consumed_at) return { ok: false, reason: "consumed" };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
    if (row.shop_id !== input.shopId || row.tool !== input.tool || row.plan_hash !== input.planHash) {
      return { ok: false, reason: "mismatch" };
    }

    // Atomic consume: only succeeds if it's still unconsumed at the moment of the write.
    const result = await this.db
      .updateTable("approvals")
      .set({ consumed_at: new Date().toISOString() })
      .where("token_hash", "=", tokenHash)
      .where("consumed_at", "is", null)
      .executeTakeFirst();

    const numChanged = Number(result.numUpdatedRows ?? 0n);
    if (numChanged === 0) return { ok: false, reason: "consumed" };

    return { ok: true, approvedBy: row.issued_by };
  }
}
