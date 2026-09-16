/**
 * Working-theme lifecycle (docs/THEME_ACCESS_STRATEGY.md §5, invariant #1;
 * threat model T14). Tools never write to the live theme by default; they
 * write to a per-store "working" theme, created by duplicating live on first
 * use and reused thereafter.
 */
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { ThemeEngine, ThemeRef } from "@shopmanagerai/shared";

export const WORKING_THEME_PREFIX = "ShopManager working:";

/**
 * Themes created before the rename. Still recognised so an existing working
 * theme is reused rather than orphaned and duplicated alongside a new one.
 */
export const LEGACY_WORKING_THEME_PREFIXES = ["ShopManagerAI working:"] as const;

/** True for a working theme created under the current or any previous name. */
export function isWorkingThemeName(name: string): boolean {
  return (
    name.startsWith(WORKING_THEME_PREFIX) ||
    LEGACY_WORKING_THEME_PREFIXES.some((p) => name.startsWith(p))
  );
}
const SHOPIFY_UNPUBLISHED_THEME_CAP = 20;

export interface WorkingThemeServiceOptions {
  now?: () => Date;
}

export class WorkingThemeService {
  private readonly engine: ThemeEngine;
  private readonly now: () => Date;

  constructor(engine: ThemeEngine, opts: WorkingThemeServiceOptions = {}) {
    this.engine = engine;
    this.now = opts.now ?? (() => new Date());
  }

  /** The published (role "main") theme. */
  async live(): Promise<ThemeRef> {
    const themes = await this.engine.listThemes();
    const main = themes.find((t) => t.role === "main");
    if (!main) {
      throw new ShopManagerAIError("NOT_FOUND", "No published (live) theme found for this store.");
    }
    return main;
  }

  /**
   * The most recently updated unpublished theme whose name starts with the
   * working-theme prefix, or null if none exists yet.
   */
  async current(): Promise<ThemeRef | null> {
    const themes = await this.engine.listThemes();
    const candidates = themes.filter((t) => t.role === "unpublished" && isWorkingThemeName(t.name));
    if (candidates.length === 0) return null;
    return candidates.slice().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0]!;
  }

  /**
   * Returns the existing working theme, or creates one by duplicating live.
   * Throws THEME_ENGINE_UNAVAILABLE if the store is already at Shopify's
   * 20-unpublished-theme cap and no working theme exists to reuse.
   */
  async ensure(): Promise<ThemeRef> {
    const existing = await this.current();
    if (existing) return existing;

    const themes = await this.engine.listThemes();
    const unpublishedCount = themes.filter((t) => t.role !== "main").length;
    if (unpublishedCount >= SHOPIFY_UNPUBLISHED_THEME_CAP) {
      const stale = themes.filter((t) => t.role === "unpublished" && isWorkingThemeName(t.name)).map((t) => `${t.name} (id ${t.id})`);
      const staleList = stale.length > 0 ? ` Stale working themes: ${stale.join(", ")}.` : "";
      throw new ShopManagerAIError(
        "THEME_ENGINE_UNAVAILABLE",
        `This store already has ${unpublishedCount} unpublished themes, at or above Shopify's cap of ${SHOPIFY_UNPUBLISHED_THEME_CAP}. Delete an unused theme before creating a working theme.${staleList}`,
        { retryable: false, details: { unpublishedCount, cap: SHOPIFY_UNPUBLISHED_THEME_CAP, staleWorkingThemes: stale } },
      );
    }

    const liveTheme = await this.live();
    const dateStr = this.now().toISOString().slice(0, 10);
    const name = `${WORKING_THEME_PREFIX} ${liveTheme.name} ${dateStr}`;
    return this.engine.duplicateTheme(liveTheme.id, name);
  }

  /**
   * Throws LIVE_THEME_WRITE_REFUSED if `themeId` is the live theme, unless
   * `options.allowLiveWrite` is set (callers must still enforce profile and
   * approval-token requirements before passing that flag).
   */
  async assertWritable(themeId: string, options: { allowLiveWrite?: boolean } = {}): Promise<void> {
    if (options.allowLiveWrite) return;
    const live = await this.live().catch(() => null);
    if (live && live.id === themeId) {
      throw new ShopManagerAIError("LIVE_THEME_WRITE_REFUSED", "Refusing to write to the live (published) theme. Use the working theme instead, or pass allowLiveWrite with an approval token.", {
        retryable: false,
        details: { themeId },
      });
    }
  }
}
