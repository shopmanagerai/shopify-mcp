/**
 * Bulk operations (docs/CURRENT_SHOPIFY_RESEARCH.md §5 "Bulk" row). Bulk
 * queries bypass the cost bucket; the result is a JSONL file at a signed URL
 * that we stream and parse line by line.
 */
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { AdminClient } from "@shopmanagerai/shared";

export const BULK_OPERATION_RUN_QUERY_MUTATION = /* GraphQL */ `
  mutation BulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CURRENT_BULK_OPERATION_QUERY = /* GraphQL */ `
  query CurrentBulkOperation {
    currentBulkOperation {
      id
      status
      errorCode
      objectCount
      fileSize
      url
      partialDataUrl
      createdAt
      completedAt
    }
  }
`;

export type BulkOperationStatus = "CREATED" | "RUNNING" | "COMPLETED" | "CANCELING" | "CANCELED" | "FAILED" | "EXPIRED";

export interface BulkOperation {
  id: string;
  status: BulkOperationStatus;
  errorCode?: string | null;
  objectCount?: number;
  fileSize?: number;
  url?: string;
  partialDataUrl?: string;
  createdAt?: string;
  completedAt?: string;
}

export async function bulkOperationRunQuery(client: AdminClient, query: string): Promise<BulkOperation> {
  const result = await client.mutate<{
    bulkOperationRunQuery: { bulkOperation: { id: string; status: BulkOperationStatus } | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(BULK_OPERATION_RUN_QUERY_MUTATION, { query }, { cost: 10 });
  const payload = result.data.bulkOperationRunQuery;
  if (payload.userErrors.length > 0) {
    if (/already in progress|BULK_OP_IN_PROGRESS/i.test(payload.userErrors.map((e) => e.message).join(" "))) {
      throw new ShopManagerAIError("BULK_OP_IN_PROGRESS", "A bulk operation is already in progress for this shop.", { retryable: true });
    }
    throw new ShopManagerAIError("INVALID_INPUT", payload.userErrors.map((e) => e.message).join("; "), { retryable: false });
  }
  if (!payload.bulkOperation) throw new ShopManagerAIError("UPSTREAM_ERROR", "bulkOperationRunQuery returned no operation.");
  return payload.bulkOperation;
}

export const BULK_OPERATION_RUN_MUTATION_MUTATION = /* GraphQL */ `
  mutation BulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Runs a mutation against every JSONL line previously uploaded (via
 * `stagedUploadsCreate`) at `stagedUploadPath` (the `key` upload parameter,
 * not the full URL). Used by `BulkRunner` for the above-threshold bulk path.
 */
export async function bulkOperationRunMutation(client: AdminClient, mutation: string, stagedUploadPath: string): Promise<BulkOperation> {
  const result = await client.mutate<{
    bulkOperationRunMutation: { bulkOperation: { id: string; status: BulkOperationStatus } | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(BULK_OPERATION_RUN_MUTATION_MUTATION, { mutation, stagedUploadPath }, { cost: 10 });
  const payload = result.data.bulkOperationRunMutation;
  if (payload.userErrors.length > 0) {
    if (/already in progress|BULK_OP_IN_PROGRESS/i.test(payload.userErrors.map((e) => e.message).join(" "))) {
      throw new ShopManagerAIError("BULK_OP_IN_PROGRESS", "A bulk operation is already in progress for this shop.", { retryable: true });
    }
    throw new ShopManagerAIError("INVALID_INPUT", payload.userErrors.map((e) => e.message).join("; "), { retryable: false });
  }
  if (!payload.bulkOperation) throw new ShopManagerAIError("UPSTREAM_ERROR", "bulkOperationRunMutation returned no operation.");
  return payload.bulkOperation;
}

export async function getCurrentBulkOperation(client: AdminClient): Promise<BulkOperation | null> {
  const result = await client.query<{ currentBulkOperation: BulkOperation | null }>(CURRENT_BULK_OPERATION_QUERY, undefined, { cost: 1 });
  return result.data.currentBulkOperation;
}

const TERMINAL_STATUSES: BulkOperationStatus[] = ["COMPLETED", "FAILED", "CANCELED", "EXPIRED"];

export interface PollBulkOperationOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Polls `currentBulkOperation` until it reaches a terminal status or times out. */
export async function pollBulkOperation(client: AdminClient, opts: PollBulkOperationOptions = {}): Promise<BulkOperation> {
  const intervalMs = opts.intervalMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + timeoutMs;

  for (;;) {
    const op = await getCurrentBulkOperation(client);
    if (op && TERMINAL_STATUSES.includes(op.status)) return op;
    if (now() >= deadline) {
      throw new ShopManagerAIError("TIMEOUT", "Timed out waiting for bulk operation to complete.", { retryable: true });
    }
    await sleep(intervalMs);
  }
}

/**
 * Streams the bulk operation's JSONL result and yields one parsed object per
 * line. Blank lines are skipped; malformed lines throw with the line number.
 */
export async function* parseBulkJsonl(url: string, fetchImpl: typeof fetch = fetch): AsyncGenerator<Record<string, unknown>, void, unknown> {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) {
    throw new ShopManagerAIError("UPSTREAM_ERROR", `Failed to download bulk operation result (HTTP ${res.status}).`, { retryable: true });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lineNo = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        lineNo++;
        const trimmed = line.trim();
        if (!trimmed) continue;
        yield parseLine(trimmed, lineNo);
      }
    }
    const trimmedTail = buffer.trim();
    if (trimmedTail) {
      lineNo++;
      yield parseLine(trimmedTail, lineNo);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string, lineNo: number): Record<string, unknown> {
  try {
    return JSON.parse(line);
  } catch (e) {
    throw new ShopManagerAIError("UPSTREAM_ERROR", `Malformed JSONL at line ${lineNo}.`, {
      technicalMessage: e instanceof Error ? e.message : String(e),
      retryable: false,
    });
  }
}
