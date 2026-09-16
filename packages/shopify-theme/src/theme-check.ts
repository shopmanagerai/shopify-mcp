/**
 * Theme Check runner (docs/CURRENT_SHOPIFY_RESEARCH.md §2; docs/THEME_ACCESS_STRATEGY.md
 * §4.5). Writes a theme's files to a temp directory and runs
 * `@shopify/theme-check-node`'s `check(root)` over it, mapping offenses to a
 * transport-friendly shape. The temp directory is always cleaned up. If the
 * native dependency fails to load or run in this environment, this throws
 * THEME_ENGINE_UNAVAILABLE instead of crashing the caller.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { ThemeFile } from "@shopmanagerai/shared";

export type ThemeCheckSeverity = "error" | "warning" | "info";

export interface ThemeCheckOffense {
  check: string;
  severity: ThemeCheckSeverity;
  message: string;
  file: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
}

export interface ThemeCheckResult {
  offenses: ThemeCheckOffense[];
  counts: { error: number; warning: number; info: number };
}

export interface RunThemeCheckOptions {
  /** Optional `.theme-check.yml` content; written into the temp theme root when provided. */
  configYaml?: string;
}

function mapSeverity(severity: number): ThemeCheckSeverity {
  // @shopify/theme-check-common Severity enum: ERROR = 0, WARNING = 1, INFO = 2
  if (severity === 0) return "error";
  if (severity === 1) return "warning";
  return "info";
}

async function writeThemeFiles(root: string, files: ThemeFile[]): Promise<void> {
  for (const file of files) {
    const dest = join(root, ...file.key.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    if (file.contentBase64 !== undefined) {
      await writeFile(dest, Buffer.from(file.contentBase64, "base64"));
    } else {
      await writeFile(dest, file.content ?? "", "utf8");
    }
  }
}

/**
 * Runs Theme Check against an in-memory set of theme files. Always cleans up
 * its temp directory, even on failure. Returns THEME_ENGINE_UNAVAILABLE
 * (thrown) rather than crashing if `@shopify/theme-check-node` cannot be
 * loaded or fails unexpectedly.
 */
export async function runThemeCheck(files: ThemeFile[], opts: RunThemeCheckOptions = {}): Promise<ThemeCheckResult> {
  let themeCheckModule: typeof import("@shopify/theme-check-node");
  try {
    themeCheckModule = await import("@shopify/theme-check-node");
  } catch (e) {
    throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "Theme Check is unavailable: @shopify/theme-check-node failed to load in this environment.", {
      technicalMessage: e instanceof Error ? e.message : String(e),
      retryable: false,
    });
  }

  const dir = await mkdtemp(join(tmpdir(), `shopmanagerai-tc-${randomBytes(6).toString("hex")}-`));
  try {
    // Theme Check scans the standard theme directories (e.g. `locales/` for the
    // translation-key check) and throws ENOENT when one is absent. Subsets of a
    // theme are common here (a single changed section), so create them all.
    for (const d of ["layout", "templates", "sections", "blocks", "snippets", "assets", "config", "locales"]) {
      await mkdir(join(dir, d), { recursive: true });
    }
    await writeThemeFiles(dir, files);
    let configPath: string | undefined;
    if (opts.configYaml) {
      configPath = join(dir, ".theme-check.yml");
      await writeFile(configPath, opts.configYaml, "utf8");
    }

    let offenses: Array<{ check: string; message: string; uri: string; severity: number; start: { line: number; character: number }; end: { line: number; character: number } }>;
    try {
      offenses = (await themeCheckModule.check(dir, configPath)) as typeof offenses;
    } catch (e) {
      throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "Theme Check failed to run in this environment.", {
        technicalMessage: e instanceof Error ? e.message : String(e),
        retryable: false,
      });
    }

    // Map the offense URI back to a theme key. Compare case-insensitively: on Windows,
    // Theme Check lower-cases the drive letter in its file:// URIs while pathToFileURL does not.
    const rootUri = pathToFileURL(dir + "/").toString();
    const rootLower = rootUri.toLowerCase();
    const toThemeKey = (uri: string): string => {
      if (uri.toLowerCase().startsWith(rootLower)) return decodeURIComponent(uri.slice(rootUri.length)).replace(/\\/g, "/");
      // Fallback: keep only the path under a known theme directory.
      const m = uri.match(/\/(layout|templates|sections|blocks|snippets|assets|config|locales)\/[^?#]*$/);
      return m ? decodeURIComponent(m[0].slice(1)) : uri;
    };
    // ValidJSON validates against JSON schemas it downloads from raw.githubusercontent.com. When that
    // download fails (offline, rate-limited, HTML error page) Theme Check reports "Unable to parse
    // content from 'https://…'" as an *error on the theme file*, which is not a theme problem and must
    // never fail a quality gate. Downgrade those to info with an explicit note (observed 2026-09-12).
    const remoteSchemaFailure = (o: { check: string; message: string }) =>
      /Unable to parse content from 'https?:\/\//i.test(o.message) ||
      (/^Valid(JSON|Schema|SettingsSchema|LocalKeys)$/.test(o.check) && /raw\.githubusercontent\.com|shopify\.dev|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|timed out|status code 5\d\d/i.test(o.message));
    const mapped: ThemeCheckOffense[] = offenses.map((o) => ({
      check: o.check,
      severity: remoteSchemaFailure(o) ? "info" : mapSeverity(o.severity),
      message: remoteSchemaFailure(o) ? `${o.message} (remote JSON schema unavailable; not a theme error)` : o.message,
      file: toThemeKey(o.uri),
      start: { line: o.start.line, col: o.start.character },
      end: { line: o.end.line, col: o.end.character },
    }));

    const counts = { error: 0, warning: 0, info: 0 };
    for (const o of mapped) counts[o.severity]++;

    return { offenses: mapped, counts };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
