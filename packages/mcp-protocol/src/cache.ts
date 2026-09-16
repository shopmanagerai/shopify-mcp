/**
 * List-identity cache hint for the modern revision.
 *
 * `tools/list`, `prompts/list`, and `resources/list` are deterministic for a
 * given (server version, credential, policy) tuple. When that tuple
 * changes (an entitlement flips, a store capability is revoked) the list
 * identity must change too, so a client that caches the previous list
 * re-fetches instead of acting on a stale surface.
 *
 * `io.modelcontextprotocol/listIdentity` is **not** a key the MCP
 * specification defines; it is ShopManager AI's own extension, namespaced
 * under our own reverse-DNS-style prefix. A client that does not recognize
 * it simply ignores the extra `_meta` field, harmless by construction.
 */
import { sha256 } from "@shopmanagerai/shared";

export const META_LIST_IDENTITY = "io.modelcontextprotocol/listIdentity";

/** Stable hash of the given parts, used as a list's cache-identity hint. */
export function listIdentity(parts: string[]): string {
  return sha256(parts.join("\u0000"));
}
