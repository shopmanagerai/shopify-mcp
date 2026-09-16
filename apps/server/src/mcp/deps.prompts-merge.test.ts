/**
 * Tests the built-in/DB skill merge in makeMcpDeps' listPrompts/getPrompt
 * (mcp/deps.ts) in isolation from the rest of the server container. This
 * repo's server-wide container.ts currently pulls in
 * @shopmanagerai/entitlement-freemius (another in-progress package), so
 * building a full Container here would entangle this test with that work.
 * Only the pieces listPrompts/getPrompt actually touch (skills, skillRepo,
 * log) are real; everything else is a minimal stand-in.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, SkillRepo } from "@shopmanagerai/storage";
import { makeMcpDeps } from "./deps.js";
import type { Container } from "../container.js";
import type { McpRequestCtx } from "./execute.js";

let close: () => void;
let skillRepo: SkillRepo;
let container: Container;

beforeEach(async () => {
  const opened = await openDatabase({ path: ":memory:" });
  close = opened.close;
  skillRepo = new SkillRepo(opened.db);
  container = {
    skills: [
      { name: "audit-store", title: "Audit my store", description: "Runs a health audit.", tier: "free", body: "Run the audit tools." } as any,
      { name: "fix-theme-check", title: "Fix Theme Check", description: "Fixes offenses.", tier: "free", body: "Run theme check, then fix." } as any,
    ],
    skillRepo,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as Container;
});

afterEach(() => {
  close();
});

const ctx = { shop: { shopId: "shop_1", domain: "shop1.myshopify.com" } } as unknown as McpRequestCtx;

describe("makeMcpDeps prompts merge", () => {
  it("listPrompts returns the built-in skills when there are no DB overrides", async () => {
    const deps = makeMcpDeps(container, () => "meta");
    const prompts = await deps.listPrompts!(ctx);
    expect(prompts.map((p) => p.name).sort()).toEqual(["audit-store", "fix-theme-check"]);
  });

  it("getPrompt returns a built-in skill's body", async () => {
    const deps = makeMcpDeps(container, () => "meta");
    const prompt = await deps.getPrompt!(ctx, "audit-store");
    expect(prompt.messages[0]?.content).toEqual({ type: "text", text: "Run the audit tools." });
  });

  it("a same-name DB skill overrides the built-in one", async () => {
    await skillRepo.upsert({ shopId: "shop_1", name: "audit-store", title: "Custom Audit", description: "My custom audit.", body: "Custom body.", source: "custom" });
    const deps = makeMcpDeps(container, () => "meta");
    const prompts = await deps.listPrompts!(ctx);
    const audit = prompts.find((p) => p.name === "audit-store");
    expect(audit?.title).toBe("Custom Audit");
    const prompt = await deps.getPrompt!(ctx, "audit-store");
    expect(prompt.messages[0]?.content).toEqual({ type: "text", text: "Custom body." });
  });

  it("a disabled skill is hidden from listPrompts and getPrompt throws NOT_FOUND", async () => {
    await skillRepo.upsert({ shopId: "shop_1", name: "audit-store", title: "Audit my store", description: "Runs a health audit.", body: "Run the audit tools.", source: "builtin", enabled: false });
    const deps = makeMcpDeps(container, () => "meta");
    const prompts = await deps.listPrompts!(ctx);
    expect(prompts.find((p) => p.name === "audit-store")).toBeUndefined();
    await expect(deps.getPrompt!(ctx, "audit-store")).rejects.toThrow();
  });

  it("a wholly new custom skill (no built-in of that name) also appears", async () => {
    await skillRepo.upsert({ shopId: "shop_1", name: "brand-new", title: "Brand New", description: "A new custom skill.", body: "New body.", source: "custom" });
    const deps = makeMcpDeps(container, () => "meta");
    const prompts = await deps.listPrompts!(ctx);
    expect(prompts.map((p) => p.name)).toContain("brand-new");
  });

  it("skills are scoped per shop, a DB override for one shop does not leak to another", async () => {
    await skillRepo.upsert({ shopId: "shop_1", name: "audit-store", title: "Custom Audit", description: "d", body: "custom body", source: "custom" });
    const deps = makeMcpDeps(container, () => "meta");
    const otherCtx = { shop: { shopId: "shop_2", domain: "shop2.myshopify.com" } } as unknown as McpRequestCtx;
    const prompt = await deps.getPrompt!(otherCtx, "audit-store");
    expect(prompt.messages[0]?.content).toEqual({ type: "text", text: "Run the audit tools." });
  });
});
