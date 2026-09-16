import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "@shopmanagerai/storage";
import { fingerprint, newId } from "@shopmanagerai/shared";
import type { SnapshotStore } from "@shopmanagerai/shared";
import { FakeAdminClient, seedDemoCatalog, listProducts, getProduct, updateProduct } from "@shopmanagerai/shopify-admin";
import { SqliteLedger } from "./ledger.js";
import { RollbackService } from "./rollback.js";

const noopSnapshots: SnapshotStore = {
  createThemeSnapshot: async () => {
    throw new Error("not used in this test");
  },
  createResourceSnapshot: async () => {
    throw new Error("not used in this test");
  },
  get: async () => null,
  list: async () => [],
  readThemeFiles: async () => [],
  readResources: async () => [],
  delete: async () => {},
};

describe("rollback: inverse_operation (product, via FakeAdminClient)", () => {
  let opened: OpenedDatabase;
  let ledger: SqliteLedger;
  let admin: FakeAdminClient;

  beforeEach(async () => {
    opened = await openDatabase({ path: ":memory:" });
    ledger = new SqliteLedger(opened.db);
    admin = new FakeAdminClient(seedDemoCatalog());
  });
  afterEach(() => opened.close());

  it("restores a product's title after update + rollback", async () => {
    const page = await listProducts(admin, { first: 1 });
    const productId = page.items[0]!.id;
    const before = await getProduct(admin, productId);
    const beforeFields = { title: before!.title };

    const { product: after } = await updateProduct(admin, { id: productId, title: "Rolled Back Later" });
    expect(after?.title).toBe("Rolled Back Later");
    const afterFields = { title: after!.title };

    const opId = newId("op");
    await ledger.begin({
      operationId: opId,
      shopId: "shop_test",
      credentialId: "cred_test",
      credentialLabel: "Test credential",
      tool: "shopify.product.update_basic",
      tier: "free",
      risk: "write",
      inputsHash: fingerprint({ productId }),
      inputsRedacted: { productId },
      resources: [`product:${productId}`],
      changes: [
        {
          resource: `product:${productId}`,
          kind: "update",
          before: beforeFields,
          after: afterFields,
          fingerprintBefore: fingerprint(beforeFields),
          fingerprintAfter: fingerprint(afterFields),
        },
      ],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "inverse_operation" },
    });
    await ledger.finish(opId, { status: "succeeded" });

    const service = new RollbackService(ledger, noopSnapshots);

    const plan = await service.plan(opId);
    expect(plan.strategy).toBe("inverse_operation");
    expect(plan.available).toBe(true);
    expect(plan.steps[0]?.action).toBe("restore");

    const record = await service.execute(opId, { admin, verifyFingerprints: true });
    expect(record.status).toBe("succeeded");

    const restored = await getProduct(admin, productId);
    expect(restored!.title).toBe(before!.title);

    const original = await ledger.get(opId);
    expect(original?.status).toBe("rolled_back");
  });

  it("refuses to roll back when the live value has changed and force is not set", async () => {
    const page = await listProducts(admin, { first: 2 });
    const productId = page.items[1]!.id;
    const before = await getProduct(admin, productId);
    const beforeFields = { title: before!.title };
    const { product: after } = await updateProduct(admin, { id: productId, title: "First Change" });
    const afterFields = { title: after!.title };

    const opId = newId("op");
    await ledger.begin({
      operationId: opId,
      shopId: "shop_test",
      credentialId: "cred_test",
      credentialLabel: "Test credential",
      tool: "shopify.product.update_basic",
      tier: "free",
      risk: "write",
      inputsHash: fingerprint({ productId }),
      inputsRedacted: { productId },
      resources: [`product:${productId}`],
      changes: [
        { resource: `product:${productId}`, kind: "update", before: beforeFields, after: afterFields, fingerprintBefore: fingerprint(beforeFields), fingerprintAfter: fingerprint(afterFields) },
      ],
      evidence: [],
      warnings: [],
      rollback: { available: true, strategy: "inverse_operation" },
    });
    await ledger.finish(opId, { status: "succeeded" });

    // Someone else changes the title again before rollback runs.
    await updateProduct(admin, { id: productId, title: "Someone Else Changed This" });

    const service = new RollbackService(ledger, noopSnapshots);
    await expect(service.execute(opId, { admin, verifyFingerprints: true })).rejects.toMatchObject({ code: "FINGERPRINT_MISMATCH" });
  });
});
