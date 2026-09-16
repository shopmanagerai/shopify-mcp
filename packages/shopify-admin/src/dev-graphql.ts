/**
 * Guarded passthrough for `shopify.dev.graphql` (threat model T4). Only
 * reachable under the DEVELOPER profile per the master prompt; this module
 * enforces the mechanical guards (no mutations, root allow-list, depth cap,
 * cost cap, redaction), profile/entitlement checks happen in the tool layer.
 */
import {
  DocumentNode,
  FieldNode,
  Kind,
  OperationDefinitionNode,
  parse,
} from "graphql";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { AdminClient, GraphqlResult } from "@shopmanagerai/shared";

export const DEFAULT_ALLOWED_ROOTS = [
  "shop",
  "themes",
  "theme",
  "products",
  "product",
  "collections",
  "collection",
  "pages",
  "page",
  "blogs",
  "articles",
  "menus",
  "metafieldDefinitions",
  "metaobjects",
  "metaobjectDefinitions",
  "urlRedirects",
  "publications",
  "files",
  "currentBulkOperation",
  "currentAppInstallation",
  "__schema",
  "__type",
] as const;

const REDACT_KEY_RE = /token|secret|password|email|phone/i;
const DEFAULT_MAX_DEPTH = 8;

export interface GuardedQueryOptions {
  allowedRoots?: readonly string[];
  maxCost?: number;
  maxDepth?: number;
}

function selectionDepth(node: FieldNode | OperationDefinitionNode, current = 0): number {
  const selectionSet = node.selectionSet;
  if (!selectionSet || selectionSet.selections.length === 0) return current;
  let max = current;
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      max = Math.max(max, selectionDepth(sel, current + 1));
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, selectionDepth({ selectionSet: sel.selectionSet } as unknown as FieldNode, current));
    }
    // Fragment spreads are not resolved here; document should be self-contained for the guard's purposes.
  }
  return max;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 20) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY_RE.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function validateDocument(document: DocumentNode, allowedRoots: readonly string[], maxDepth: number): void {
  for (const def of document.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    const opDef = def as OperationDefinitionNode;
    if (opDef.operation === "mutation" || opDef.operation === "subscription") {
      throw new ShopManagerAIError("MUTATION_DENIED", "Mutations are not permitted through the guarded GraphQL passthrough.", { retryable: false });
    }

    const depth = selectionDepth(opDef);
    if (depth > maxDepth) {
      throw new ShopManagerAIError("INVALID_INPUT", `Query depth ${depth} exceeds the maximum of ${maxDepth}.`, { retryable: false });
    }

    for (const sel of opDef.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;
      const name = sel.name.value;
      if (!allowedRoots.includes(name)) {
        throw new ShopManagerAIError("GRAPHQL_ROOT_DENIED", `Root field "${name}" is not on the allow-list for the guarded GraphQL passthrough.`, {
          retryable: false,
          details: { field: name },
        });
      }
    }
  }
}

/**
 * Parses and validates `document`, then runs it through `client.query` with a
 * cost cap, rejecting mutations and non-allow-listed root fields. Result
 * values under keys matching `/token|secret|password|email|phone/i` are
 * redacted before being returned.
 */
export async function guardedQuery<T = any>(
  client: AdminClient,
  document: string,
  variables: Record<string, unknown> | undefined,
  opts: GuardedQueryOptions = {},
): Promise<GraphqlResult<T>> {
  const allowedRoots = opts.allowedRoots ?? DEFAULT_ALLOWED_ROOTS;
  const maxCost = opts.maxCost ?? 500;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  let parsed: DocumentNode;
  try {
    parsed = parse(document);
  } catch (e) {
    throw new ShopManagerAIError("INVALID_INPUT", "Query is not valid GraphQL.", {
      technicalMessage: e instanceof Error ? e.message : String(e),
      retryable: false,
    });
  }

  validateDocument(parsed, allowedRoots, maxDepth);

  const result = await client.query<T>(document, variables, { cost: maxCost });

  const requestedCost = result.extensions?.cost?.requestedQueryCost;
  if (typeof requestedCost === "number" && requestedCost > maxCost) {
    throw new ShopManagerAIError("GRAPHQL_COST_EXCEEDED", `Query cost ${requestedCost} exceeds the cap of ${maxCost}.`, {
      retryable: false,
      details: { requestedQueryCost: requestedCost, maxCost },
    });
  }

  return { ...result, data: redact(result.data) as T };
}
