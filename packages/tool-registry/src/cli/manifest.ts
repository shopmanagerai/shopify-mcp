/**
 * CLI: writes `tools-manifest.json` and `docs/tools.md` at the repo root from
 * a module path that exports a `registry: ToolRegistry`. Never crashes when
 * that module does not exist yet (early in the project this is expected) --
 * it prints a clear message and exits cleanly instead.
 *
 * Usage: node dist/cli/manifest.js [modulePath]
 * Default modulePath: ../../../tools/dist/index.js (relative to this file).
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { generateManifest, generateToolsMarkdown } from "../manifest.js";
import type { ToolRegistry } from "../registry.js";

const DEFAULT_MODULE_PATH = "../../../tools/dist/index.js"; // from packages/tool-registry/dist/cli/

async function findRepoRoot(startDir: string): Promise<string> {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    try {
      await fs.access(path.join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return startDir;
}

async function resolveModuleUrl(modulePath: string, thisFileDir: string): Promise<URL> {
  if (/^[a-zA-Z]+:/.test(modulePath)) return new URL(modulePath); // already a URL (file:, etc.)
  if (path.isAbsolute(modulePath)) return pathToFileURL(modulePath);
  return new URL(modulePath, pathToFileURL(thisFileDir + path.sep));
}

async function main(): Promise<void> {
  const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
  const modulePathArg = process.argv[2] ?? DEFAULT_MODULE_PATH;
  const moduleUrl = await resolveModuleUrl(modulePathArg, thisFileDir);

  let mod: { registry?: ToolRegistry; createRegistry?: () => ToolRegistry };
  try {
    mod = await import(moduleUrl.href);
    if (!mod.registry && typeof mod.createRegistry === "function") mod = { ...mod, registry: mod.createRegistry() };
  } catch (err) {
    console.log(
      `[tool-registry] manifest: could not load "${modulePathArg}" (resolved: ${moduleUrl.href}). ` +
        `This is expected until the tools package is built. Skipping manifest generation.\n` +
        `  Reason: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (!mod.registry) {
    console.log(`[tool-registry] manifest: module "${modulePathArg}" does not export a "registry". Skipping.`);
    return;
  }

  const repoRoot = await findRepoRoot(thisFileDir);
  const manifestPath = path.join(repoRoot, "tools-manifest.json");
  const docsPath = path.join(repoRoot, "docs", "tools.md");

  const manifest = generateManifest(mod.registry);
  const markdown = generateToolsMarkdown(mod.registry);

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.writeFile(docsPath, markdown, "utf8");

  console.log(`[tool-registry] manifest: wrote ${manifest.tools.length} tools to ${manifestPath} and ${docsPath}.`);
}

main().catch((err) => {
  console.error("[tool-registry] manifest: unexpected error:", err);
  process.exitCode = 1;
});
