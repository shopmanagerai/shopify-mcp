/**
 * App Bridge v4 is a global script (see index.html), not an npm package: the
 * CDN script exposes `window.shopify`. We only use `idToken()` for session
 * tokens and `window.shopify.toast` for native toasts when embedded.
 *
 * The script is injected asynchronously, so the first API calls can race it.
 * `getSessionToken` therefore waits (bounded) for the global to appear.
 */

export interface ShopifyGlobal {
  idToken: () => Promise<string>;
  toast?: { show: (message: string, opts?: { isError?: boolean; duration?: number }) => void };
  config?: { shop?: string; host?: string };
  environment?: { embedded?: boolean };
}

declare global {
  interface Window {
    shopify?: ShopifyGlobal;
  }
}

/** True when we were loaded inside Shopify admin (a `host` query param is present). */
export function isEmbedded(): boolean {
  const params = new URLSearchParams(window.location.search);
  let framed = false;
  try {
    framed = window.top !== window.self;
  } catch {
    framed = true;
  }
  return framed || params.has("host") || params.has("id_token") || params.get("embedded") === "1";
}

export function getAppBridge(): ShopifyGlobal | undefined {
  return window.shopify;
}

const APP_BRIDGE_WAIT_MS = 8000;

async function waitForAppBridge(): Promise<ShopifyGlobal | undefined> {
  const started = Date.now();
  while (Date.now() - started < APP_BRIDGE_WAIT_MS) {
    if (window.shopify?.idToken) return window.shopify;
    await new Promise((r) => setTimeout(r, 100));
  }
  return window.shopify;
}

let tokenPromise: Promise<string | undefined> | undefined;

/** Drop any in-flight/cached token so the next call mints a fresh one (used after a 401). */
export function invalidateSessionToken(): void {
  tokenPromise = undefined;
}

export async function getSessionToken(): Promise<string | undefined> {
  // Coalesce concurrent callers onto one in-flight fetch; tokens are short-lived
  // (~1 min) so we do not cache the result beyond the in-flight promise.
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const shopify = await waitForAppBridge();
      if (shopify?.idToken) {
        try {
          return await shopify.idToken();
        } catch (e) {
          console.warn("[shopmanagerai] App Bridge idToken() failed", e);
        }
      } else {
        console.warn("[shopmanagerai] App Bridge not available after wait; falling back to id_token from the URL", {
          requested: (window as unknown as { __cpAppBridgeRequested?: boolean }).__cpAppBridgeRequested ?? false,
          hasShopifyGlobal: !!window.shopify,
        });
      }
      // Shopify includes a fresh session token as the id_token query param on the initial embedded load.
      const fromUrl = new URLSearchParams(window.location.search).get("id_token");
      return fromUrl ?? undefined;
    })().finally(() => {
      setTimeout(() => {
        tokenPromise = undefined;
      }, 0);
    });
  }
  return tokenPromise;
}

/** The `?shop=` query param, preserved across navigation for demo/standalone mode. */
export function getDemoShop(): string | undefined {
  return new URLSearchParams(window.location.search).get("shop") ?? undefined;
}
