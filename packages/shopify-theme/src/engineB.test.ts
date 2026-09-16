import { describe, expect, it } from "vitest";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { AdminClient, GraphqlResult } from "@shopmanagerai/shared";
import { AdminGraphqlThemeEngine } from "./engineB.js";

function fakeClient(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    apiVersion: "2026-07",
    query: async () => ({ data: {} }),
    mutate: async () => ({ data: {} }),
    ...overrides,
  };
}

describe("AdminGraphqlThemeEngine.probe", () => {
  it("returns true when the write and delete both succeed", async () => {
    const client = fakeClient({
      mutate: async (document: string): Promise<GraphqlResult> => {
        if (document.includes("ThemeFilesUpsert")) {
          return { data: { themeFilesUpsert: { upsertedThemeFiles: [{ filename: "snippets/shopmanagerai-probe.liquid" }], userErrors: [] } } };
        }
        return { data: { themeFilesDelete: { deletedThemeFiles: [{ filename: "snippets/shopmanagerai-probe.liquid" }], userErrors: [] } } };
      },
    });
    const engine = new AdminGraphqlThemeEngine(client);
    await expect(engine.probe("123")).resolves.toBe(true);
  });

  it("returns false when the upsert reports userErrors", async () => {
    const client = fakeClient({
      mutate: async (): Promise<GraphqlResult> => ({
        data: { themeFilesUpsert: { upsertedThemeFiles: [], userErrors: [{ field: ["files"], message: "no access" }] } },
      }),
    });
    const engine = new AdminGraphqlThemeEngine(client);
    await expect(engine.probe("123")).resolves.toBe(false);
  });

  it("returns false when the write throws ACCESS_DENIED_EXEMPTION", async () => {
    const client = fakeClient({
      mutate: async () => {
        throw new ShopManagerAIError("ACCESS_DENIED_EXEMPTION", "denied");
      },
    });
    const engine = new AdminGraphqlThemeEngine(client);
    await expect(engine.probe("123")).resolves.toBe(false);
  });

  it("propagates other errors", async () => {
    const client = fakeClient({
      mutate: async () => {
        throw new ShopManagerAIError("UPSTREAM_ERROR", "boom");
      },
    });
    const engine = new AdminGraphqlThemeEngine(client);
    await expect(engine.probe("123")).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("does not throw when the cleanup delete fails after a successful write", async () => {
    let calls = 0;
    const client = fakeClient({
      mutate: async (document: string): Promise<GraphqlResult> => {
        calls++;
        if (document.includes("ThemeFilesUpsert")) {
          return { data: { themeFilesUpsert: { upsertedThemeFiles: [{ filename: "snippets/shopmanagerai-probe.liquid" }], userErrors: [] } } };
        }
        throw new ShopManagerAIError("UPSTREAM_ERROR", "delete failed");
      },
    });
    const engine = new AdminGraphqlThemeEngine(client);
    await expect(engine.probe("123")).resolves.toBe(true);
    expect(calls).toBe(2);
  });
});

describe("AdminGraphqlThemeEngine delegation", () => {
  it("readFiles delegates to theme.files via the client", async () => {
    const client = fakeClient({
      query: async (): Promise<GraphqlResult> => ({
        data: { theme: { files: { nodes: [{ filename: "layout/theme.liquid", body: { content: "hi" } }] } } },
      }),
    });
    const engine = new AdminGraphqlThemeEngine(client);
    const files = await engine.readFiles("1", ["layout/theme.liquid"]);
    expect(files[0]).toMatchObject({ key: "layout/theme.liquid", content: "hi" });
  });

  it("listFiles returns an empty array (no prefix-listing query exists in Admin GraphQL)", async () => {
    const engine = new AdminGraphqlThemeEngine(fakeClient());
    expect(await engine.listFiles("1")).toEqual([]);
  });
});
