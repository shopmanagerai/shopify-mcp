import { describe, expect, it } from "vitest";
import type { AdminClient } from "@shopmanagerai/shared";
import { getCurrentBulkOperation, parseBulkJsonl, pollBulkOperation } from "./bulk.js";

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

describe("parseBulkJsonl", () => {
  it("parses one object per line, skipping blank lines", async () => {
    const body = '{"id":"1"}\n{"id":"2"}\n\n{"id":"3"}\n';
    const fetchImpl = (async () => new Response(streamFromString(body), { status: 200 })) as unknown as typeof fetch;
    const items: Record<string, unknown>[] = [];
    for await (const item of parseBulkJsonl("https://example.com/result.jsonl", fetchImpl)) {
      items.push(item);
    }
    expect(items).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  it("parses a trailing line without a final newline", async () => {
    const body = '{"id":"1"}\n{"id":"2"}';
    const fetchImpl = (async () => new Response(streamFromString(body), { status: 200 })) as unknown as typeof fetch;
    const items: Record<string, unknown>[] = [];
    for await (const item of parseBulkJsonl("https://example.com/result.jsonl", fetchImpl)) {
      items.push(item);
    }
    expect(items).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("throws with a line number on malformed JSON", async () => {
    const body = '{"id":"1"}\nnot json\n';
    const fetchImpl = (async () => new Response(streamFromString(body), { status: 200 })) as unknown as typeof fetch;
    await expect(async () => {
      for await (const _ of parseBulkJsonl("https://example.com/result.jsonl", fetchImpl)) {
        // drain
      }
    }).rejects.toThrow(/line 2/);
  });

  it("throws UPSTREAM_ERROR when the download fails", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(async () => {
      for await (const _ of parseBulkJsonl("https://example.com/missing.jsonl", fetchImpl)) {
        // drain
      }
    }).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});

describe("pollBulkOperation", () => {
  it("polls until a terminal status is reached", async () => {
    let call = 0;
    const client: AdminClient = {
      apiVersion: "2026-07",
      query: async () => {
        call++;
        const status = call < 3 ? "RUNNING" : "COMPLETED";
        return { data: { currentBulkOperation: { id: "1", status } } };
      },
      mutate: async () => ({ data: {} }),
    };
    const sleeps: number[] = [];
    const op = await pollBulkOperation(client, { intervalMs: 10, sleep: async (ms) => void sleeps.push(ms) });
    expect(op.status).toBe("COMPLETED");
    expect(call).toBe(3);
    expect(sleeps.length).toBe(2);
  });

  it("times out if the operation never reaches a terminal state", async () => {
    const client: AdminClient = {
      apiVersion: "2026-07",
      query: async () => ({ data: { currentBulkOperation: { id: "1", status: "RUNNING" } } }),
      mutate: async () => ({ data: {} }),
    };
    let now = 0;
    await expect(
      pollBulkOperation(client, {
        intervalMs: 10,
        timeoutMs: 25,
        sleep: async () => {
          now += 10;
        },
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("getCurrentBulkOperation", () => {
  it("returns null when no bulk operation has run", async () => {
    const client: AdminClient = {
      apiVersion: "2026-07",
      query: async () => ({ data: { currentBulkOperation: null } }),
      mutate: async () => ({ data: {} }),
    };
    expect(await getCurrentBulkOperation(client)).toBeNull();
  });
});
