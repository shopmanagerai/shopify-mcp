import { describe, expect, it } from "vitest";
import type { AdminClient, GraphqlResult } from "@shopmanagerai/shared";
import { guardedQuery } from "./dev-graphql.js";

function fakeClient(result: GraphqlResult): AdminClient {
  return {
    apiVersion: "2026-07",
    query: async () => result,
    mutate: async () => result,
  };
}

describe("guardedQuery", () => {
  it("rejects mutations", async () => {
    const client = fakeClient({ data: {} });
    await expect(guardedQuery(client, "mutation { productDelete(input: {}) { deletedProductId } }")).rejects.toMatchObject({ code: "MUTATION_DENIED" });
  });

  it("rejects root fields not on the allow-list", async () => {
    const client = fakeClient({ data: {} });
    await expect(guardedQuery(client, "query { customers(first: 10) { edges { node { id } } } }")).rejects.toMatchObject({ code: "GRAPHQL_ROOT_DENIED" });
  });

  it("rejects shop.email style sensitive roots when not allow-listed", async () => {
    const client = fakeClient({ data: {} });
    await expect(guardedQuery(client, "query { orders(first: 1) { edges { node { id } } } }")).rejects.toMatchObject({ code: "GRAPHQL_ROOT_DENIED" });
  });

  it("allows a query using only allow-listed roots", async () => {
    const client = fakeClient({ data: { shop: { name: "Test" } } });
    const result = await guardedQuery(client, "query { shop { name } }");
    expect(result.data).toEqual({ shop: { name: "Test" } });
  });

  it("rejects queries deeper than the depth cap", async () => {
    const client = fakeClient({ data: {} });
    const deep = "query { products(first:1) { edges { node { collections(first:1) { edges { node { products(first:1) { edges { node { title } } } } } } } } } }";
    await expect(guardedQuery(client, deep, undefined, { maxDepth: 3 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("throws GRAPHQL_COST_EXCEEDED when requestedQueryCost exceeds maxCost", async () => {
    const client = fakeClient({ data: { shop: {} }, extensions: { cost: { requestedQueryCost: 600, actualQueryCost: 600, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 1000, restoreRate: 50 } } } });
    await expect(guardedQuery(client, "query { shop { name } }", undefined, { maxCost: 500 })).rejects.toMatchObject({ code: "GRAPHQL_COST_EXCEEDED" });
  });

  it("redacts values under sensitive keys in the result", async () => {
    const client = fakeClient({ data: { shop: { email: "owner@example.com", name: "Test" } } });
    const result = await guardedQuery(client, "query { shop { name email } }");
    expect((result.data as any).shop.email).toBe("[REDACTED]");
    expect((result.data as any).shop.name).toBe("Test");
  });

  it("rejects invalid GraphQL syntax", async () => {
    const client = fakeClient({ data: {} });
    await expect(guardedQuery(client, "query { shop {")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("honors a custom allow-list", async () => {
    const client = fakeClient({ data: { widgets: [] } });
    const result = await guardedQuery(client, "query { widgets { id } }", undefined, { allowedRoots: ["widgets"] });
    expect(result.data).toEqual({ widgets: [] });
  });
});
