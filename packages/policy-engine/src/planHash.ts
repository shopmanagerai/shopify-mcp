/**
 * Fingerprint of an operation plan. Approval tokens are bound to
 * `(tool, shop, planHash)` (docs/PRODUCT_ARCHITECTURE.md §5): if the input
 * changes after a token was issued, the token no longer matches and consuming
 * it fails as a mismatch.
 */
import { fingerprint } from "@shopmanagerai/shared";

export function planHash(toolName: string, shopId: string, input: unknown): string {
  return fingerprint({ toolName, shopId, input });
}
