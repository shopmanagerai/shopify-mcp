/**
 * Shared helpers for catalog/content tools (0.2): resolve the AdminClient,
 * build Change records, and diff before/after field objects consistently.
 */
import { ShopManagerAIError, fingerprint } from "@shopmanagerai/shared";
import type { AdminClient, Change } from "@shopmanagerai/shared";

export function requireAdmin(admin: AdminClient | undefined): AdminClient {
  if (!admin) {
    throw new ShopManagerAIError("ADMIN_CLIENT_UNAVAILABLE", "No Shopify Admin API client is configured for this store.", { retryable: false });
  }
  return admin;
}

/** JSON diff of the keys present in `after` (or `before` when a key was removed). */
export function diffFields(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = { before: b, after: a };
  }
  return JSON.stringify(out, null, 2);
}

export function fieldChange(resource: string, kind: Change["kind"], before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): Change {
  return {
    resource,
    kind,
    before,
    after,
    diff: diffFields(before, after),
    fingerprintBefore: before !== undefined ? fingerprint(before) : undefined,
    fingerprintAfter: after !== undefined ? fingerprint(after) : undefined,
  };
}

/** Refuse writes to app-owned metafield namespaces (`$app:...` and `app--*`). */
export function isAppOwnedNamespace(namespace: string): boolean {
  return namespace.startsWith("$app:") || namespace.startsWith("app--");
}

export function pick<T extends Record<string, unknown>>(obj: T, keys: Array<keyof T>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k as string] = obj[k];
  return out;
}
