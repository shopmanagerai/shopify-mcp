/**
 * KV-backed VisualAuditService for @shopmanagerai/tools (`ctx.services.get("visualAudits")`).
 * Persists audit sessions per shop so visual.issue / score / plan_repair / verify and the
 * store orchestrators can reference a prior audit across requests and restarts.
 * Sessions hold issue metadata only. Never screenshot bytes.
 */
import { newId } from "@shopmanagerai/shared";
import type { KvRepo } from "@shopmanagerai/storage";
import type { VisualAuditService, VisualAuditSession, VisualIssueRecord } from "@shopmanagerai/tools";

const MAX_SESSIONS_PER_SHOP = 50;

export class KvVisualAuditService implements VisualAuditService {
  constructor(private readonly kv: KvRepo) {}

  private key(shopId: string, sessionId: string): string {
    return `visualaudit:${shopId}:${sessionId}`;
  }
  private latestKey(shopId: string): string {
    return `visualaudit-latest:${shopId}`;
  }

  async save(session: Omit<VisualAuditSession, "sessionId" | "createdAt">): Promise<VisualAuditSession> {
    const full: VisualAuditSession = { ...session, sessionId: newId("va"), createdAt: new Date().toISOString() };
    await this.kv.set(this.key(session.shopId, full.sessionId), full);
    await this.kv.set(this.latestKey(session.shopId), full.sessionId);
    // Bounded retention: drop the oldest sessions beyond the cap.
    const rows = await this.kv.listByPrefix<VisualAuditSession>(`visualaudit:${session.shopId}:`);
    if (rows.length > MAX_SESSIONS_PER_SHOP) {
      const oldest = rows.sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt)).slice(0, rows.length - MAX_SESSIONS_PER_SHOP);
      for (const r of oldest) await this.kv.delete(r.key);
    }
    return full;
  }

  async get(sessionId: string): Promise<VisualAuditSession | null> {
    // sessionId alone does not carry the shop; scan the (small, bounded) prefix space.
    const rows = await this.kv.listByPrefix<VisualAuditSession>("visualaudit:");
    return rows.find((r) => r.value?.sessionId === sessionId)?.value ?? null;
  }

  async latest(shopId: string): Promise<VisualAuditSession | null> {
    const id = await this.kv.get<string>(this.latestKey(shopId));
    if (!id) return null;
    return (await this.kv.get<VisualAuditSession>(this.key(shopId, id))) ?? null;
  }

  async findIssue(shopId: string, issueId: string): Promise<{ session: VisualAuditSession; issue: VisualIssueRecord } | null> {
    const rows = await this.kv.listByPrefix<VisualAuditSession>(`visualaudit:${shopId}:`);
    for (const r of rows.sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt))) {
      const issue = r.value.issues.find((i) => i.id === issueId);
      if (issue) return { session: r.value, issue };
    }
    return null;
  }
}
