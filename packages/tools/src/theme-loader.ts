/**
 * Shared helper: read a theme's files through ctx.theme into a
 * @shopmanagerai/theme-intelligence ThemeFileSet, redacting secrets and
 * skipping large binaries (returned as metadata only).
 *
 * Caching: a full read of a real theme is ~6 requests (274 files / 50 per query)
 * and every tool needs the file set, so results are cached per engine + theme and
 * validated with one cheap `listFiles` call: if every file's checksum (or
 * updatedAt) is unchanged the cached set is reused. Engines that expose neither
 * checksum nor updatedAt (e.g. the in-memory fake) bypass the cache, so tests
 * that mutate files never see stale data.
 */
import { ShopManagerAIError, fingerprint } from "@shopmanagerai/shared";
import type { ThemeEngine, ThemeFile } from "@shopmanagerai/shared";
import { ThemeFileSet, redactThemeFileSet } from "@shopmanagerai/theme-intelligence";

const MAX_BINARY_BYTES = 512 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  fp: string;
  at: number;
  fileSet: ThemeFileSet;
  maskedKeys: string[];
}
const cache = new WeakMap<ThemeEngine, Map<string, CacheEntry>>();

function requireThemeEngine(theme: ThemeEngine | undefined): ThemeEngine {
  if (!theme) {
    throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "No theme engine is configured for this store.", { retryable: false });
  }
  return theme;
}

function listingFingerprint(metas: ThemeFile[]): string | null {
  if (metas.length === 0) return null;
  const parts: Array<[string, string]> = [];
  for (const m of metas) {
    const stamp = m.checksum ?? m.updatedAt;
    if (!stamp) return null; // engine cannot prove freshness → do not cache
    parts.push([m.key, stamp]);
  }
  parts.sort((a, b) => a[0].localeCompare(b[0]));
  return fingerprint(parts);
}

/** Drop cached file sets for a theme (call after writes when the engine has no checksums). */
export function invalidateThemeCache(theme: ThemeEngine | undefined, themeId?: string): void {
  if (!theme) return;
  const byTheme = cache.get(theme);
  if (!byTheme) return;
  if (themeId) byTheme.delete(themeId);
  else byTheme.clear();
}

/** Lists a theme's files, reads text files (skipping large binaries), and redacts secrets. */
export async function loadThemeFileSet(theme: ThemeEngine | undefined, themeId: string): Promise<{ fileSet: ThemeFileSet; maskedKeys: string[] }> {
  const engine = requireThemeEngine(theme);
  let metas: ThemeFile[];
  try {
    metas = await engine.listFiles(themeId);
  } catch (e) {
    const err = e as { code?: string; technicalMessage?: string; message?: string };
    if (err?.code === "UPSTREAM_ERROR" && /does not exist|not found/i.test(err.technicalMessage ?? err.message ?? "")) {
      throw new ShopManagerAIError("NOT_FOUND", `Theme "${themeId}" does not exist on this store.`, { retryable: false });
    }
    throw e;
  }

  const fp = listingFingerprint(metas);
  if (fp) {
    const hit = cache.get(engine)?.get(themeId);
    if (hit && hit.fp === fp && Date.now() - hit.at < CACHE_TTL_MS) return { fileSet: hit.fileSet, maskedKeys: hit.maskedKeys };
  }

  const textKeys: string[] = [];
  const binaryMetas: ThemeFile[] = [];
  for (const m of metas) {
    if (isLikelyBinary(m)) {
      binaryMetas.push(m);
    } else {
      textKeys.push(m.key);
    }
  }
  const textFiles = textKeys.length > 0 ? await engine.readFiles(themeId, textKeys) : [];
  const combined: ThemeFile[] = [...textFiles, ...binaryMetas.map((m) => ({ ...m, content: undefined, contentBase64: undefined }))];

  const fileSet = new ThemeFileSet(combined);
  const { files, maskedKeys } = redactThemeFileSet(fileSet);
  const redactedFiles: ThemeFile[] = files.map((f) => ({ key: f.key, content: f.content, contentBase64: f.contentBase64 }));
  const result = { fileSet: new ThemeFileSet(redactedFiles), maskedKeys };

  if (fp) {
    let byTheme = cache.get(engine);
    if (!byTheme) {
      byTheme = new Map();
      cache.set(engine, byTheme);
    }
    byTheme.set(themeId, { fp, at: Date.now(), fileSet: result.fileSet, maskedKeys });
  }
  return result;
}

function isLikelyBinary(meta: ThemeFile): boolean {
  if (meta.contentType && /^(image|font|video|audio)\//i.test(meta.contentType)) return true;
  if (typeof meta.size === "number" && meta.size > MAX_BINARY_BYTES) return true;
  const ext = meta.key.split(".").pop()?.toLowerCase();
  return !!ext && ["png", "jpg", "jpeg", "gif", "webp", "woff", "woff2", "ttf", "otf", "ico"].includes(ext);
}

/** Reads a small, explicit set of theme files (used by write handlers for before-images). */
export async function readThemeFiles(theme: ThemeEngine | undefined, themeId: string, keys: string[]): Promise<ThemeFile[]> {
  const engine = requireThemeEngine(theme);
  return engine.readFiles(themeId, keys);
}

export function requireTheme(theme: ThemeEngine | undefined): ThemeEngine {
  return requireThemeEngine(theme);
}
