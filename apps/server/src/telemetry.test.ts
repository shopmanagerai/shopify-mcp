import { describe, expect, it, vi } from "vitest";
import { TelemetryEmitter, hashShopId, recordToolTelemetry } from "./telemetry.js";

describe("TelemetryEmitter", () => {
  it("is a no-op when no endpoint is configured", async () => {
    const fetchImpl = vi.fn();
    const emitter = new TelemetryEmitter(undefined, { fetchImpl: fetchImpl as any });
    emitter.enqueue({ tool: "commerce.version", durationMs: 10, ok: true, tier: "free", shopHash: hashShopId("shop_1") });
    expect(emitter.pending).toHaveLength(0);
    await emitter.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("batches queued events into a single POST on flush", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const emitter = new TelemetryEmitter("https://telemetry.example.com/ingest", { fetchImpl: fetchImpl as any });
    emitter.enqueue({ tool: "commerce.version", durationMs: 10, ok: true, tier: "free", shopHash: hashShopId("shop_1") });
    emitter.enqueue({ tool: "shopify.theme.list_remote", durationMs: 22, ok: true, tier: "free", shopHash: hashShopId("shop_1") });
    emitter.enqueue({ tool: "shopify.product.update_basic", durationMs: 5, ok: false, code: "NOT_FOUND", tier: "free", shopHash: hashShopId("shop_1") });
    expect(emitter.pending).toHaveLength(3);

    await emitter.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://telemetry.example.com/ingest");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.events).toHaveLength(3);
    expect(body.events[2].code).toBe("NOT_FOUND");
    // Never includes tool inputs/outputs or the raw shop id.
    expect(JSON.stringify(body)).not.toContain("shop_1");
    expect(emitter.pending).toHaveLength(0);
  });

  it("swallows fetch failures without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const emitter = new TelemetryEmitter("https://telemetry.example.com/ingest", { fetchImpl: fetchImpl as any });
    emitter.enqueue({ tool: "commerce.version", durationMs: 1, ok: true, tier: "free", shopHash: hashShopId("shop_1") });
    await expect(emitter.flush()).resolves.toBeUndefined();
  });

  it("flushes automatically once the batch hits maxBatchSize", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const emitter = new TelemetryEmitter("https://telemetry.example.com/ingest", { fetchImpl: fetchImpl as any, maxBatchSize: 2 });
    emitter.enqueue({ tool: "a", durationMs: 1, ok: true, tier: "free", shopHash: "h" });
    emitter.enqueue({ tool: "b", durationMs: 1, ok: true, tier: "free", shopHash: "h" });
    // enqueue triggers an async flush; give it a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("recordToolTelemetry", () => {
  it("does nothing when the emitter has no endpoint (never reads settings)", async () => {
    const emitter = new TelemetryEmitter(undefined);
    const getSettings = vi.fn();
    await recordToolTelemetry(emitter, getSettings, { shopId: "s1", tool: "commerce.version", durationMs: 1, ok: true, tier: "free" });
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("skips enqueuing when the shop has not opted in (privacy.telemetry !== true)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const emitter = new TelemetryEmitter("https://telemetry.example.com/ingest", { fetchImpl: fetchImpl as any });
    await recordToolTelemetry(emitter, async () => ({ privacy: { telemetry: false } }), { shopId: "s1", tool: "commerce.version", durationMs: 1, ok: true, tier: "free" });
    expect(emitter.pending).toHaveLength(0);
  });

  it("enqueues an event when privacy.telemetry is true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const emitter = new TelemetryEmitter("https://telemetry.example.com/ingest", { fetchImpl: fetchImpl as any });
    await recordToolTelemetry(emitter, async () => ({ privacy: { telemetry: true } }), { shopId: "s1", tool: "commerce.version", durationMs: 42, ok: true, tier: "free" });
    expect(emitter.pending).toHaveLength(1);
    expect(emitter.pending[0]?.durationMs).toBe(42);
    expect(emitter.pending[0]?.shopHash).toBe(hashShopId("s1"));
  });
});
