/**
 * Engine B: Admin GraphQL theme-file operations (docs/THEME_ACCESS_STRATEGY.md §3).
 * Exemption-gated, `probe()` writes and deletes a zero-byte snippet on an
 * unpublished theme to detect whether the protected-scope exemption is live
 * for this store, per store, without ever advertising engine B as available
 * until the probe passes.
 */
import { isShopManagerAIError } from "@shopmanagerai/shared";
import type { AdminClient, ThemeEngine, ThemeFile, ThemeFileWrite, ThemeRef } from "@shopmanagerai/shared";
import {
  listThemeFiles,
  getTheme,
  listThemes,
  readThemeFiles,
  themeCreate,
  themeDelete,
  themeDuplicate,
  themeFilesDelete,
  themeFilesUpsert,
  themePublish,
  themeUpdate,
} from "@shopmanagerai/shopify-admin";

const PROBE_KEY = "snippets/shopmanagerai-probe.liquid";

export class AdminGraphqlThemeEngine implements ThemeEngine {
  readonly kind = "admin_graphql" as const;

  constructor(private readonly client: AdminClient) {}

  async listThemes(): Promise<ThemeRef[]> {
    return listThemes(this.client);
  }

  async getTheme(themeId: string): Promise<ThemeRef | null> {
    return getTheme(this.client, themeId);
  }

  async listFiles(themeId: string, opts?: { prefix?: string }): Promise<ThemeFile[]> {
    // Admin GraphQL lists all theme files (metadata) via the paginated files connection.
    return listThemeFiles(this.client, themeId, { prefix: opts?.prefix });
  }

  async readFiles(themeId: string, keys: string[]): Promise<ThemeFile[]> {
    return readThemeFiles(this.client, themeId, keys);
  }

  async writeFiles(themeId: string, files: ThemeFileWrite[]): Promise<{ written: string[]; errors: Array<{ key: string; message: string }> }> {
    return themeFilesUpsert(this.client, themeId, files);
  }

  async deleteFiles(themeId: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
    return themeFilesDelete(this.client, themeId, keys);
  }

  async duplicateTheme(sourceThemeId: string, name: string): Promise<ThemeRef> {
    return themeDuplicate(this.client, sourceThemeId, name);
  }

  async publishTheme(themeId: string): Promise<ThemeRef> {
    return themePublish(this.client, themeId);
  }

  async deleteTheme(themeId: string): Promise<void> {
    await themeDelete(this.client, themeId);
  }

  async renameTheme(themeId: string, name: string): Promise<ThemeRef> {
    return themeUpdate(this.client, themeId, name);
  }

  /** Convenience: create a brand-new theme (not used by the ThemeEngine interface directly). */
  async createTheme(source: string, name?: string): Promise<ThemeRef> {
    return themeCreate(this.client, source, name);
  }

  /** ThemeEngine.createFromUrl: creates a new unpublished theme from a remote zip URL via `themeCreate`. */
  async createFromUrl(src: string, name: string): Promise<ThemeRef> {
    return themeCreate(this.client, src, name);
  }

  /**
   * Writes then deletes a zero-byte probe snippet on `themeId` (expected to
   * be unpublished). Returns true if the protected-scope exemption is
   * granted for this store, false if Shopify returns ACCESS_DENIED_EXEMPTION
   * - or any other userErrors, which get silently folded into the same
   * `false` result with no way for a caller to tell them apart. `onDenied`
   * is an optional escape hatch so a caller (shops.probe) can log the real
   * reason instead of it vanishing; it does not change the return value, so
   * existing callers and tests that omit it see identical behavior.
   */
  async probe(themeId: string, opts?: { onDenied?: (detail: string) => void }): Promise<boolean> {
    try {
      const upsertResult = await themeFilesUpsert(this.client, themeId, [{ key: PROBE_KEY, content: "" }]);
      if (upsertResult.errors.length > 0) {
        opts?.onDenied?.(`themeFilesUpsert userErrors: ${upsertResult.errors.map((e) => `${e.key}: ${e.message}`).join("; ")}`);
        return false;
      }
      await themeFilesDelete(this.client, themeId, [PROBE_KEY]).catch(() => undefined);
      return true;
    } catch (e) {
      if (isShopManagerAIError(e) && e.code === "ACCESS_DENIED_EXEMPTION") {
        opts?.onDenied?.(`ACCESS_DENIED_EXEMPTION: ${e.message}${e.technicalMessage ? ` - ${e.technicalMessage}` : ""}`);
        return false;
      }
      throw e;
    }
  }
}
