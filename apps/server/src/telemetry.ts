/**
 * Opt-in telemetry emitter. Reads a shop's `settings_json.privacy.telemetry`
 * flag (default false, telemetry is off unless a merchant turns it on in
 * the Privacy admin page, docs/DATA_PRIVACY_MODEL.md §3); when enabled,
 * batches coarse per-call events and POSTs them to `TELEMETRY_ENDPOINT`
 * every `intervalMs` (default 60s). No-op when the env var is unset. Never
 * includes tool inputs/outputs or store domains, only a hashed shop id.
 */
import { sha256 } from "@shopmanagerai/shared";
import type { Logger } from "@shopmanagerai/shared";

export interface TelemetryEvent {
  tool: string;
  durationMs: number;
  ok: boolean;
  code?: string;
  tier: string;
  shopHash: string;
}

export interface TelemetryEmitterOptions {
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  log?: Logger;
  maxBatchSize?: number;
}

/** sha256 of the shop id, stable, non-reversible, never the domain. */
export function hashShopId(shopId: string): string {
  return sha256(shopId);
}

export class TelemetryEmitter {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly maxBatchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log?: Logger;

  constructor(private readonly endpoint: string | undefined, opts: TelemetryEmitterOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.maxBatchSize = opts.maxBatchSize ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log;
  }

  get enabled(): boolean {
    return !!this.endpoint;
  }

  /** Queues one event. No-op if TELEMETRY_ENDPOINT is unset. */
  enqueue(event: TelemetryEvent): void {
    if (!this.endpoint) return;
    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize) void this.flush();
  }

  /** Starts the periodic flush timer. Safe to call multiple times (idempotent). No-op if disabled. */
  start(): void {
    if (!this.endpoint || this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Flushes the current queue in one batch POST. Swallows network errors (best-effort). */
  async flush(): Promise<void> {
    if (!this.endpoint || this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
    } catch (e) {
      this.log?.warn("telemetry: flush failed", { error: e instanceof Error ? e.message : String(e), count: batch.length });
    }
  }

  /** Test/introspection helper: events not yet flushed. */
  get pending(): readonly TelemetryEvent[] {
    return this.queue;
  }
}

/**
 * Reads the shop's privacy.telemetry setting and, if enabled, enqueues one
 * event. Called from mcp/execute.ts after a tool call finishes.
 */
export async function recordToolTelemetry(
  emitter: TelemetryEmitter,
  getSettings: (shopId: string) => Promise<Record<string, unknown> | null | undefined>,
  input: { shopId: string; tool: string; durationMs: number; ok: boolean; code?: string; tier: string },
): Promise<void> {
  if (!emitter.enabled) return;
  let settings: Record<string, unknown> | null | undefined;
  try {
    settings = await getSettings(input.shopId);
  } catch {
    return;
  }
  const privacy = (settings?.privacy as { telemetry?: boolean } | undefined) ?? undefined;
  if (privacy?.telemetry !== true) return;
  emitter.enqueue({
    tool: input.tool,
    durationMs: input.durationMs,
    ok: input.ok,
    code: input.code,
    tier: input.tier,
    shopHash: hashShopId(input.shopId),
  });
}
