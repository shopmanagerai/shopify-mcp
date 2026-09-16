/**
 * Import boundary for @shopmanagerai/tools (task brief: "if packages/tools is
 * not yet present when you start, create thin local stubs behind an import()
 * boundary so the server compiles, and wire the real package as soon as it
 * exists"). @shopmanagerai/tools is being built concurrently; this module
 * probes its actual exports at startup and only falls back to the local
 * stub registry (tools-fallback.ts) for whichever pieces are missing.
 */
import type { ToolRegistry } from "@shopmanagerai/tool-registry";
import type { ToolContext } from "@shopmanagerai/shared";
import { createFallbackRegistry, listResourcesFallback, loadSkillsFallback, readResourceFallback } from "./tools-fallback.js";

export interface SkillDescriptor {
  name: string;
  title: string;
  description: string;
  tier: string;
}

export interface ToolsPackageApi {
  createRegistry(): ToolRegistry;
  loadSkills(dir: string): Promise<SkillDescriptor[]>;
  listResources(ctx: ToolContext): Promise<Array<{ uri: string; name: string; description?: string; mimeType?: string }>> | Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  readResource(ctx: ToolContext, uri: string): Promise<Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> | { uri: string; mimeType?: string; text?: string; blob?: string }>;
  usingFallback: boolean;
}

let cached: ToolsPackageApi | undefined;

export async function loadToolsPackage(): Promise<ToolsPackageApi> {
  if (cached) return cached;

  let real: any = undefined;
  try {
    real = await import("@shopmanagerai/tools");
  } catch {
    real = undefined;
  }

  const hasRegistry = typeof real?.createRegistry === "function";
  cached = {
    createRegistry: hasRegistry ? real.createRegistry : createFallbackRegistry,
    loadSkills: typeof real?.loadSkills === "function" ? real.loadSkills : loadSkillsFallback,
    listResources: typeof real?.listResources === "function" ? real.listResources : listResourcesFallback,
    readResource: typeof real?.readResource === "function" ? real.readResource : readResourceFallback,
    usingFallback: !hasRegistry,
  };
  return cached;
}
