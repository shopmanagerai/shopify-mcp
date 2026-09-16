/**
 * BulkRunner: applies the same mutation to many resources, choosing between
 * two execution modes:
 *
 *  - "sequential": throttled, concurrency-limited calls through `AdminClient`
 *    (respects the client's own cost-bucket backoff), with per-item error
 *    isolation, transient-error retries, and checkpoint/resume support. Used
 *    at or below `useShopifyBulkAbove` items.
 *  - "bulk_operation": Shopify's Bulk Operations API, stage-upload a JSONL
 *    file of per-item mutation variables, run it with
 *    `bulkOperationRunMutation`, poll `currentBulkOperation` to completion,
 *    then download and parse the result JSONL. Used above the threshold,
 *    where per-request round trips would be too slow/expensive.
 *
 * Callers (e.g. `shopify.seo.bulk_optimize`) supply `buildMutation` to turn
 * one item into a `{document, variables}` pair. The bulk-operation path
 * assumes every item shares the same mutation `document` (only `variables`
 * differ per line), group items by mutation shape before calling this when
 * that is not already true.
 */
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { AdminClient } from "@shopmanagerai/shared";
import { bulkOperationRunMutation, getCurrentBulkOperation, parseBulkJsonl, pollBulkOperation } from "./operations/bulk.js";
import { stagedUploadsCreate } from "./operations/media.js";

export interface BulkItem {
  id: string;
}

export interface BuiltMutation {
  document: string;
  variables: Record<string, unknown>;
}

export interface BulkRunnerCheckpoint<TItem = unknown> {
  /** ids of items already processed (succeeded or failed) in a prior run. */
  processedIds: string[];
  succeeded: Array<{ id: string; result: unknown }>;
  failed: Array<{ id: string; message: string }>;
}

export interface BulkCheckpointStore<TItem = unknown> {
  get(): Promise<BulkRunnerCheckpoint<TItem> | null>;
  set(checkpoint: BulkRunnerCheckpoint<TItem>): Promise<void>;
}

export interface BulkRunnerProgress {
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
}

export interface BulkRunnerOptions<TItem extends BulkItem> {
  /** Max in-flight sequential-path calls. Default 2. */
  concurrency?: number;
  checkpoint?: BulkCheckpointStore<TItem>;
  onProgress?: (progress: BulkRunnerProgress) => void;
  /** Item count above which the Shopify Bulk Operations path is used instead of sequential calls. Default 100. */
  useShopifyBulkAbove?: number;
  /** Max attempts per item for transient (retryable) errors on the sequential path. Default 3. */
  maxAttemptsPerItem?: number;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Poll interval / timeout passed through to `pollBulkOperation`. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Injectable fetch for the real (non-fake) staged-upload PUT and result download. */
  fetchImpl?: typeof fetch;
}

export interface BulkRunnerResult<TItem extends BulkItem> {
  succeeded: Array<{ id: string; result: unknown }>;
  failed: Array<{ id: string; message: string }>;
  skipped: number;
  mode: "sequential" | "bulk_operation";
  checkpoint: BulkRunnerCheckpoint<TItem>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(e: unknown): boolean {
  if (e instanceof ShopManagerAIError) return e.retryable;
  return false;
}

/** Extracts `{userErrors}` (if present) from any field of a mutation payload's `data` object. */
function findMutationPayload(data: Record<string, unknown> | undefined): { field: string; payload: Record<string, unknown> } | null {
  if (!data) return null;
  for (const [field, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "userErrors" in (value as Record<string, unknown>)) {
      return { field, payload: value as Record<string, unknown> };
    }
  }
  const [first] = Object.entries(data);
  return first ? { field: first[0], payload: first[1] as Record<string, unknown> } : null;
}

export class BulkRunner {
  constructor(private readonly admin: AdminClient) {}

  async runMutations<TItem extends BulkItem>(
    items: TItem[],
    buildMutation: (item: TItem) => BuiltMutation,
    opts: BulkRunnerOptions<TItem> = {},
  ): Promise<BulkRunnerResult<TItem>> {
    const threshold = opts.useShopifyBulkAbove ?? 100;

    const priorCheckpoint = opts.checkpoint ? await opts.checkpoint.get() : null;
    const alreadyProcessed = new Set(priorCheckpoint?.processedIds ?? []);
    const pending = items.filter((i) => !alreadyProcessed.has(i.id));

    const checkpoint: BulkRunnerCheckpoint<TItem> = {
      processedIds: [...(priorCheckpoint?.processedIds ?? [])],
      succeeded: [...(priorCheckpoint?.succeeded ?? [])],
      failed: [...(priorCheckpoint?.failed ?? [])],
    };
    const skipped = items.length - pending.length;

    if (pending.length === 0) {
      return { succeeded: checkpoint.succeeded, failed: checkpoint.failed, skipped, mode: "sequential", checkpoint };
    }

    if (items.length > threshold) {
      await this.runBulkOperation(pending, buildMutation, opts, checkpoint);
      return { succeeded: checkpoint.succeeded, failed: checkpoint.failed, skipped, mode: "bulk_operation", checkpoint };
    }

    await this.runSequential(pending, buildMutation, opts, checkpoint, items.length);
    return { succeeded: checkpoint.succeeded, failed: checkpoint.failed, skipped, mode: "sequential", checkpoint };
  }

  // -------------------------------------------------------------------------
  // Sequential / concurrency-limited path
  // -------------------------------------------------------------------------
  private async runSequential<TItem extends BulkItem>(
    pending: TItem[],
    buildMutation: (item: TItem) => BuiltMutation,
    opts: BulkRunnerOptions<TItem>,
    checkpoint: BulkRunnerCheckpoint<TItem>,
    total: number,
  ): Promise<void> {
    const concurrency = Math.max(1, opts.concurrency ?? 2);
    const maxAttempts = Math.max(1, opts.maxAttemptsPerItem ?? 3);
    const sleep = opts.sleep ?? defaultSleep;

    let cursor = 0;
    const runOne = async (item: TItem): Promise<void> => {
      const { document, variables } = buildMutation(item);
      let attempt = 0;
      let lastMessage = "Unknown error";
      for (;;) {
        attempt++;
        try {
          const result = await this.admin.mutate<Record<string, unknown>>(document, variables);
          const payload = findMutationPayload(result.data as Record<string, unknown> | undefined);
          const userErrors = (payload?.payload?.["userErrors"] as Array<{ message: string }> | undefined) ?? [];
          if (userErrors.length > 0) {
            checkpoint.failed.push({ id: item.id, message: userErrors.map((e) => e.message).join("; ") });
          } else {
            checkpoint.succeeded.push({ id: item.id, result: payload?.payload ?? result.data });
          }
          checkpoint.processedIds.push(item.id);
          break;
        } catch (e) {
          lastMessage = e instanceof Error ? e.message : String(e);
          if (isRetryable(e) && attempt < maxAttempts) {
            await sleep(50 * attempt);
            continue;
          }
          checkpoint.failed.push({ id: item.id, message: lastMessage });
          checkpoint.processedIds.push(item.id);
          break;
        }
      }
      if (opts.checkpoint) await opts.checkpoint.set(structuredCloneCheckpoint(checkpoint));
      opts.onProgress?.({
        processed: checkpoint.processedIds.length,
        total,
        succeeded: checkpoint.succeeded.length,
        failed: checkpoint.failed.length,
      });
    };

    async function worker(items: TItem[]): Promise<void> {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) return;
        await runOne(items[idx]!);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker(pending));
    await Promise.all(workers);
  }

  // -------------------------------------------------------------------------
  // Shopify Bulk Operations path
  // -------------------------------------------------------------------------
  private async runBulkOperation<TItem extends BulkItem>(
    pending: TItem[],
    buildMutation: (item: TItem) => BuiltMutation,
    opts: BulkRunnerOptions<TItem>,
    checkpoint: BulkRunnerCheckpoint<TItem>,
  ): Promise<void> {
    if (pending.length === 0) return;
    const document = buildMutation(pending[0]!).document;
    const lines = pending.map((item) => JSON.stringify(buildMutation(item).variables));
    const jsonl = lines.join("\n");

    const { target, userErrors: stagedErrors } = await stagedUploadsCreate(this.admin, {
      filename: "bulk-mutation-variables.jsonl",
      mimeType: "text/jsonl",
      fileSize: String(Buffer.byteLength(jsonl, "utf8")),
      resource: "BULK_MUTATION_VARIABLES",
    });
    if (stagedErrors.length > 0 || !target) {
      const message = stagedErrors.map((e) => e.message).join("; ") || "stagedUploadsCreate failed.";
      for (const item of pending) {
        checkpoint.failed.push({ id: item.id, message });
        checkpoint.processedIds.push(item.id);
      }
      return;
    }
    const pathKey = target.parameters.find((p) => p.name === "key")?.value ?? target.url;

    await this.uploadJsonl(target.url, pathKey, jsonl, opts.fetchImpl);

    const started = await bulkOperationRunMutation(this.admin, document, pathKey);
    if (started.status !== "COMPLETED" && started.status !== "FAILED") {
      await pollBulkOperation(this.admin, { intervalMs: opts.pollIntervalMs ?? 1000, timeoutMs: opts.pollTimeoutMs ?? 5 * 60 * 1000, sleep: opts.sleep });
    }
    const finalOp = (await getCurrentBulkOperation(this.admin)) ?? started;

    if (finalOp.status !== "COMPLETED" || !finalOp.url) {
      const message = `Bulk operation ended with status ${finalOp.status}${finalOp.errorCode ? ` (${finalOp.errorCode})` : ""}.`;
      for (const item of pending) {
        checkpoint.failed.push({ id: item.id, message });
        checkpoint.processedIds.push(item.id);
      }
      return;
    }

    const resultLines = await this.downloadResults(finalOp.url, opts.fetchImpl);
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      const line = resultLines[i];
      if (!line) {
        checkpoint.failed.push({ id: item.id, message: "No result line returned for this item." });
        checkpoint.processedIds.push(item.id);
        continue;
      }
      const payload = findMutationPayload(line);
      const userErrorsField = payload?.payload?.["userErrors"];
      const userErrors = Array.isArray(userErrorsField) ? (userErrorsField as Array<{ message: string }>) : [];
      if (userErrors.length > 0) {
        checkpoint.failed.push({ id: item.id, message: userErrors.map((e) => e.message).join("; ") });
      } else {
        checkpoint.succeeded.push({ id: item.id, result: payload?.payload ?? line });
      }
      checkpoint.processedIds.push(item.id);
    }
    if (opts.checkpoint) await opts.checkpoint.set(structuredCloneCheckpoint(checkpoint));
    opts.onProgress?.({
      processed: checkpoint.processedIds.length,
      total: checkpoint.processedIds.length,
      succeeded: checkpoint.succeeded.length,
      failed: checkpoint.failed.length,
    });
  }

  private async uploadJsonl(url: string, pathKey: string, content: string, fetchImpl?: typeof fetch): Promise<void> {
    const fakeIngest = (this.admin as unknown as { ingestStagedUpload?: (pathKey: string, content: string) => void }).ingestStagedUpload;
    if (url.startsWith("https://fake-cdn.") && typeof fakeIngest === "function") {
      fakeIngest.call(this.admin, pathKey, content);
      return;
    }
    const f = fetchImpl ?? fetch;
    const res = await f(url, { method: "PUT", headers: { "Content-Type": "text/jsonl" }, body: content });
    if (!res.ok) {
      throw new ShopManagerAIError("UPSTREAM_ERROR", `Staged JSONL upload failed: ${res.status} ${res.statusText}`, { retryable: true });
    }
  }

  private async downloadResults(url: string, fetchImpl?: typeof fetch): Promise<Array<Record<string, unknown>>> {
    const fakeDownload = (this.admin as unknown as { downloadBulkResult?: (url: string) => string | undefined }).downloadBulkResult;
    if (url.startsWith("https://fake-cdn.") && typeof fakeDownload === "function") {
      const content = fakeDownload.call(this.admin, url) ?? "";
      return content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
    }
    const out: Array<Record<string, unknown>> = [];
    for await (const line of parseBulkJsonl(url, fetchImpl)) out.push(line);
    return out;
  }
}

function structuredCloneCheckpoint<TItem>(c: BulkRunnerCheckpoint<TItem>): BulkRunnerCheckpoint<TItem> {
  return { processedIds: [...c.processedIds], succeeded: [...c.succeeded], failed: [...c.failed] };
}
