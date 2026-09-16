/**
 * Admin GraphQL client (docs/CURRENT_SHOPIFY_RESEARCH.md §6, §7).
 * Cost-aware: reads `extensions.cost.throttleStatus`, pre-waits before a
 * request likely to exceed the available bucket, and retries 429/5xx with
 * backoff. Never logs or echoes the access token (threat model T5).
 */
import { ShopManagerAIError, redactString } from "@shopmanagerai/shared";
import type { AdminClient, GraphqlResult } from "@shopmanagerai/shared";

export interface ThrottleState {
  currentlyAvailable: number;
  maximumAvailable: number;
  restoreRate: number;
  lastSeenAt: number; // epoch ms
}

export type AccessTokenProvider = string | (() => string | Promise<string>);

export interface AdminGraphqlClientOptions {
  shopDomain: string;
  accessToken: AccessTokenProvider;
  apiVersion: string;
  fetch?: typeof fetch;
  throttle?: ThrottleState;
  /** Max retry attempts for 429/5xx responses. Default 5. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default 250. */
  baseDelayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_MAX_AVAILABLE = 1000;
const DEFAULT_RESTORE_RATE = 50;
const DEFAULT_COST = 50;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AdminGraphqlClient implements AdminClient {
  readonly apiVersion: string;
  private readonly shopDomain: string;
  private readonly accessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly nowImpl: () => number;
  private throttle: ThrottleState;

  constructor(opts: AdminGraphqlClientOptions) {
    this.shopDomain = opts.shopDomain;
    this.accessToken = opts.accessToken;
    this.apiVersion = opts.apiVersion;
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 250;
    this.sleepImpl = opts.sleep ?? defaultSleep;
    this.nowImpl = opts.now ?? (() => Date.now());
    this.throttle = opts.throttle ?? {
      currentlyAvailable: DEFAULT_MAX_AVAILABLE,
      maximumAvailable: DEFAULT_MAX_AVAILABLE,
      restoreRate: DEFAULT_RESTORE_RATE,
      lastSeenAt: this.nowImpl(),
    };
  }

  getThrottleState(): ThrottleState {
    return { ...this.throttle };
  }

  query<T = any>(document: string, variables?: Record<string, unknown>, opts?: { cost?: number }): Promise<GraphqlResult<T>> {
    return this.execute<T>(document, variables, opts);
  }

  mutate<T = any>(document: string, variables?: Record<string, unknown>, opts?: { cost?: number }): Promise<GraphqlResult<T>> {
    return this.execute<T>(document, variables, opts);
  }

  private projectedAvailable(): number {
    const elapsedSec = Math.max(0, (this.nowImpl() - this.throttle.lastSeenAt) / 1000);
    return Math.min(this.throttle.maximumAvailable, this.throttle.currentlyAvailable + elapsedSec * this.throttle.restoreRate);
  }

  private async preWait(estimatedCost: number): Promise<void> {
    const projected = this.projectedAvailable();
    if (projected >= estimatedCost) return;
    const deficit = estimatedCost - projected;
    const restoreRate = this.throttle.restoreRate || DEFAULT_RESTORE_RATE;
    const waitMs = Math.ceil((deficit / restoreRate) * 1000);
    if (waitMs > 0) await this.sleepImpl(waitMs);
  }

  private async resolveToken(): Promise<string> {
    return typeof this.accessToken === "function" ? await this.accessToken() : this.accessToken;
  }

  private async execute<T>(document: string, variables?: Record<string, unknown>, opts?: { cost?: number }): Promise<GraphqlResult<T>> {
    const estimatedCost = opts?.cost ?? DEFAULT_COST;
    // A mutation that reached Shopify must never be replayed on an ambiguous failure
    // (5xx / dropped connection): a second productCreate or discount would duplicate a
    // commercial action. 429 is safe to retry because the request was not executed.
    const isMutation = /^\s*(?:#[^\n]*\n\s*)*mutation\b/i.test(document);
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.maxRetries) {
      await this.preWait(estimatedCost);
      const token = await this.resolveToken();
      const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query: document, variables: variables ?? {} }),
        });
      } catch (e) {
        lastError = e;
        if (isMutation || attempt >= this.maxRetries) break;
        await this.backoff(attempt);
        attempt++;
        continue;
      }

      const deprecationHeader = res.headers.get("X-Shopify-API-Deprecated-Reason") ?? res.headers.get("x-shopify-api-deprecated-reason");

      if (res.status === 429 || res.status >= 500) {
        lastError = new ShopManagerAIError(res.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR", `Shopify Admin API returned ${res.status}.`, {
          retryable: true,
          httpStatus: res.status,
        });
        if (attempt >= this.maxRetries || (isMutation && res.status >= 500)) break;
        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
        await this.backoff(attempt, retryAfterMs);
        attempt++;
        continue;
      }

      let body: any;
      try {
        body = await res.json();
      } catch (e) {
        throw new ShopManagerAIError("UPSTREAM_ERROR", "Shopify Admin API returned a non-JSON response.", {
          technicalMessage: redactString(e instanceof Error ? e.message : String(e)),
          httpStatus: res.status,
        });
      }

      if (!res.ok) {
        throw this.mapGraphqlErrors(body, res.status, document);
      }

      // GraphQL-level errors (200 OK but `errors` present).
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        const hasUserErrors = this.hasUserErrors(body?.data);
        if (!hasUserErrors) {
          throw this.mapGraphqlErrors(body, res.status, document);
        }
        // userErrors are business-logic validation results the caller must
        // handle; do not throw or retry, just fall through and return them.
      }

      this.updateThrottle(body?.extensions);

      const result: GraphqlResult<T> = { data: body?.data as T };
      if (body?.extensions) result.extensions = body.extensions;
      const deprecations: string[] = [];
      if (deprecationHeader) deprecations.push(deprecationHeader);
      if (Array.isArray(body?.extensions?.deprecations)) {
        for (const d of body.extensions.deprecations) {
          if (typeof d === "string") deprecations.push(d);
          else if (d?.message) deprecations.push(String(d.message));
        }
      }
      if (deprecations.length > 0) result.deprecations = deprecations;

      return result;
    }

    if (lastError instanceof ShopManagerAIError) throw lastError;
    throw new ShopManagerAIError("UPSTREAM_ERROR", "Shopify Admin API request failed after retries.", {
      retryable: false,
      technicalMessage: redactString(lastError instanceof Error ? lastError.message : String(lastError)),
    });
  }

  private hasUserErrors(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (value && typeof value === "object" && Array.isArray((value as any).userErrors) && (value as any).userErrors.length > 0) {
        return true;
      }
    }
    return false;
  }

  private mapGraphqlErrors(body: any, httpStatus: number, document?: string): ShopManagerAIError {
    // Two shapes come back as "errors": the GraphQL execution-time array ([{message, extensions}])
    // and, for top-level auth/authz failures (bad token, uninstalled app, deprecated token type),
    // a plain string (e.g. `{"errors":"[API] Invalid API key or access token"}`). Reading only the
    // array form silently discarded every one of these string errors as "Shopify Admin API returned
    // an error.", with no way to tell an expired token from a scopes problem from a deprecated one.
    const errors: Array<{ message?: string; extensions?: { code?: string } }> = Array.isArray(body?.errors)
      ? body.errors
      : typeof body?.errors === "string" && body.errors
        ? [{ message: body.errors }]
        : [];
    const operation = document?.match(/\b(query|mutation)\s+(\w+)/)?.[2];
    const combinedMessage = redactString(errors.map((e) => e.message ?? "").join("; ") || "Shopify Admin API returned an error.") + (operation ? ` [operation: ${operation}]` : "");

    const accessDenied = errors.find((e) => e.extensions?.code === "ACCESS_DENIED");
    if (accessDenied) {
      const msg = accessDenied.message ?? "";
      if (/theme.*file|file.*theme/i.test(msg) || /themeFiles(Upsert|Copy|Delete)/i.test(JSON.stringify(body))) {
        return new ShopManagerAIError("ACCESS_DENIED_EXEMPTION", "Access denied for theme file mutation (protected-scope exemption required).", {
          technicalMessage: combinedMessage,
          retryable: false,
        });
      }
      if (/scope/i.test(msg)) {
        return new ShopManagerAIError("SCOPE_MISSING", "Access denied: missing required scope.", {
          technicalMessage: combinedMessage,
          retryable: false,
        });
      }
      return new ShopManagerAIError("ACCESS_DENIED_EXEMPTION", "Access denied by Shopify Admin API.", {
        technicalMessage: combinedMessage,
        retryable: false,
      });
    }

    if (httpStatus === 429) {
      return new ShopManagerAIError("RATE_LIMITED", "Rate limited by Shopify Admin API.", { technicalMessage: combinedMessage, retryable: true });
    }
    // Caller mistakes Shopify reports as top-level GraphQL errors (not userErrors): surface them as INVALID_INPUT / NOT_FOUND so clients can act.
    if (/invalid id|invalid value|cannot exceed|must include the following argument|Field is not defined|Variable \$/i.test(combinedMessage)) {
      return new ShopManagerAIError("INVALID_INPUT", `Shopify rejected the request: ${combinedMessage}`, { technicalMessage: combinedMessage, retryable: false, httpStatus });
    }
    if (/does not exist|not found|no web pixel|no extension found/i.test(combinedMessage)) {
      return new ShopManagerAIError("NOT_FOUND", `Shopify: ${combinedMessage}`, { technicalMessage: combinedMessage, retryable: false, httpStatus });
    }

    return new ShopManagerAIError("UPSTREAM_ERROR", "Shopify Admin API returned an error.", {
      technicalMessage: combinedMessage,
      retryable: httpStatus >= 500,
      httpStatus,
    });
  }

  private updateThrottle(extensions: any): void {
    const status = extensions?.cost?.throttleStatus;
    if (!status) return;
    this.throttle = {
      currentlyAvailable: status.currentlyAvailable,
      maximumAvailable: status.maximumAvailable,
      restoreRate: status.restoreRate,
      lastSeenAt: this.nowImpl(),
    };
  }

  private async backoff(attempt: number, retryAfterMs?: number): Promise<void> {
    if (retryAfterMs && retryAfterMs > 0) {
      await this.sleepImpl(retryAfterMs);
      return;
    }
    const exp = this.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.baseDelayMs;
    await this.sleepImpl(exp + jitter);
  }
}
