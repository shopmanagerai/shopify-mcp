/**
 * Shopify quarterly API version scheme (docs/CURRENT_SHOPIFY_RESEARCH.md §7).
 * Versions are named "YYYY-{01,04,07,10}", released on the first day of that
 * quarter, and supported for at least 12 months. We treat "release + 12
 * months" as the end-of-support date (Shopify guarantees at least that much).
 */

const VERSION_RE = /^\d{4}-(01|04|07|10)$/;

const DEFAULT_VERSION = "2026-07";

export interface SupportedWindow {
  version: string;
  releaseDate: Date;
  endOfSupport: Date;
}

export class ShopifyApiVersionService {
  private readonly configured: string;

  constructor(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
    const fromEnv = env.SHOPIFY_API_VERSION;
    this.configured = fromEnv && this.isValid(fromEnv) ? fromEnv : DEFAULT_VERSION;
  }

  /** Currently configured API version (env `SHOPIFY_API_VERSION`, default "2026-07"). */
  current(): string {
    return this.configured;
  }

  isValid(version: string): boolean {
    return VERSION_RE.test(version);
  }

  /** Release date and end-of-support date (release + 12 months) for a version. */
  supportedWindow(version: string): SupportedWindow {
    if (!this.isValid(version)) {
      throw new Error(`Invalid Shopify API version: ${version}`);
    }
    const year = Number(version.slice(0, 4));
    const quarterMonth = Number(version.slice(5, 7)); // 01, 04, 07, 10
    const releaseDate = new Date(Date.UTC(year, quarterMonth - 1, 1));
    const endOfSupport = new Date(Date.UTC(year + 1, quarterMonth - 1, 1));
    return { version, releaseDate, endOfSupport };
  }

  /**
   * Returns a warning string if the configured version's support window ends
   * within `days` of `now`, otherwise null.
   */
  warnIfExpiring(now: Date, days = 90): string | null {
    const { endOfSupport } = this.supportedWindow(this.configured);
    const msRemaining = endOfSupport.getTime() - now.getTime();
    const msWindow = days * 24 * 60 * 60 * 1000;
    if (msRemaining <= msWindow) {
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      return `Shopify API version ${this.configured} leaves support on ${endOfSupport.toISOString().slice(0, 10)} (${daysRemaining} day(s) remaining). Bump SHOPIFY_API_VERSION.`;
    }
    return null;
  }
}
