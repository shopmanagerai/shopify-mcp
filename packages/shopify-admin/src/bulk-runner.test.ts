import { describe, expect, it } from "vitest";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { AdminClient } from "@shopmanagerai/shared";
import { BulkRunner, type BulkCheckpointStore, type BulkRunnerCheckpoint } from "./bulk-runner.js";
import { FakeAdminClient, seedDemoCatalog, updateProduct, getProduct } from "./index.js";

function memoryCheckpoint(): BulkCheckpointStore & { saved: BulkRunnerCheckpoint[] } {
  let current: BulkRunnerCheckpoint | null = null;
  const saved: BulkRunnerCheckpoint[] = [];
  return {
    saved,
    async get() {
      return current;
    },
    async set(c: BulkRunnerCheckpoint) {
      current = c;
      saved.push(c);
    },
  };
}

describe("BulkRunner sequential path", () => {
  it("isolates a failing item while others succeed", async () => {
    const admin = new FakeAdminClient(seedDemoCatalog());
    const runner = new BulkRunner(admin);
    const items = ["gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Product/999999"].map((id) => ({ id }));
    const result = await runner.runMutations(
      items,
      (item) => ({
        document: `mutation ProductUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }`,
        variables: { input: { id: item.id, title: "Updated Title" } },
      }),
      { useShopifyBulkAbove: 100 },
    );
    expect(result.mode).toBe("sequential");
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.id).toBe("gid://shopify/Product/999999");
  });

  it("resumes from a checkpoint, skipping already-processed items", async () => {
    const admin = new FakeAdminClient(seedDemoCatalog());
    const items = [{ id: "gid://shopify/Product/1" }, { id: "gid://shopify/Product/2" }];
    const checkpoint = memoryCheckpoint();
    await checkpoint.set({ processedIds: ["gid://shopify/Product/1"], succeeded: [{ id: "gid://shopify/Product/1", result: { id: "gid://shopify/Product/1" } }], failed: [] });

    const runner = new BulkRunner(admin);
    let calls = 0;
    const result = await runner.runMutations(
      items,
      (item) => {
        calls++;
        return {
          document: `mutation ProductUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }`,
          variables: { input: { id: item.id, title: "Resumed" } },
        };
      },
      { checkpoint },
    );
    expect(calls).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.succeeded).toHaveLength(2);
    expect(result.succeeded.map((s) => s.id).sort()).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/2"].sort());
  });

  it("retries a transient error and eventually succeeds", async () => {
    let attempts = 0;
    const admin: AdminClient = {
      apiVersion: "2026-07",
      query: async () => ({ data: {} }),
      mutate: async () => {
        attempts++;
        if (attempts < 2) throw new ShopManagerAIError("RATE_LIMITED", "slow down", { retryable: true });
        return { data: { productUpdate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } } };
      },
    };
    const runner = new BulkRunner(admin);
    const result = await runner.runMutations(
      [{ id: "gid://shopify/Product/1" }],
      () => ({ document: "mutation X { x }", variables: {} }),
      { sleep: async () => {} },
    );
    expect(attempts).toBe(2);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });
});

describe("BulkRunner bulk-operation path", () => {
  it("switches to bulk_operation mode above the threshold and applies mutations via the fake bulk pipeline", async () => {
    const admin = new FakeAdminClient(seedDemoCatalog());
    const ids = ["gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Product/3", "gid://shopify/Product/4", "gid://shopify/Product/5"];
    const runner = new BulkRunner(admin);
    const result = await runner.runMutations(
      ids.map((id) => ({ id })),
      (item) => ({
        document: `mutation ProductUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }`,
        variables: { input: { id: item.id, title: `Bulk Title ${item.id}` } },
      }),
      { useShopifyBulkAbove: 3 },
    );
    expect(result.mode).toBe("bulk_operation");
    expect(result.succeeded).toHaveLength(5);
    expect(result.failed).toHaveLength(0);
    const p1 = await getProduct(admin, "gid://shopify/Product/1");
    expect(p1?.title).toBe("Bulk Title gid://shopify/Product/1");
  });

  it("stays on the sequential path at or below the threshold", async () => {
    const admin = new FakeAdminClient(seedDemoCatalog());
    const ids = ["gid://shopify/Product/1", "gid://shopify/Product/2"];
    const runner = new BulkRunner(admin);
    const result = await runner.runMutations(
      ids.map((id) => ({ id })),
      (item) => ({
        document: `mutation ProductUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }`,
        variables: { input: { id: item.id, title: "Sequential Title" } },
      }),
      { useShopifyBulkAbove: 100 },
    );
    expect(result.mode).toBe("sequential");
    expect(result.succeeded).toHaveLength(2);
  });
});
