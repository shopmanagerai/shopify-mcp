/**
 * Small built-in table of well-known Shopify apps and the theme-level
 * fingerprints they tend to leave behind: snippet/asset names, CSS classes,
 * and script hosts. This is a heuristic aid, never authoritative, Shopify
 * exposes no API to list other installed apps (docs/CURRENT_SHOPIFY_RESEARCH.md
 * §4). Matches against this table produce confidence 0.6-0.8 "theme_reference"
 * evidence; script tags and rendered script hosts are matched against
 * `scriptHosts` too, at their own (higher) confidence tiers.
 */

export interface KnownAppDef {
  handle: string;
  name: string;
  category: string;
  patterns: {
    /** Regexes tested against snippet/section/block file basenames. */
    snippets?: RegExp[];
    /** Regexes tested against asset file basenames. */
    assetNames?: RegExp[];
    /** Regexes tested against CSS class names appearing anywhere in theme text. */
    cssClasses?: RegExp[];
    /** Regexes tested against script hostnames (script tags, rendered pages). */
    scriptHosts?: RegExp[];
    /** Regexes tested against metafield namespaces. */
    metafieldNamespaces?: RegExp[];
  };
}

export const KNOWN_APPS: KnownAppDef[] = [
  {
    handle: "judge-me-reviews",
    name: "Judge.me Product Reviews",
    category: "reviews",
    patterns: {
      snippets: [/judge[-_]?me/i, /jdgm/i],
      assetNames: [/judge[-_]?me/i, /jdgm/i],
      cssClasses: [/\bjdgm-/i],
      scriptHosts: [/judge\.me$/i, /cdn\.judgeme\.io$/i],
      metafieldNamespaces: [/^judgeme$/i],
    },
  },
  {
    handle: "loox-reviews",
    name: "Loox Product Reviews",
    category: "reviews",
    patterns: {
      snippets: [/loox/i],
      assetNames: [/loox/i],
      cssClasses: [/\bloox-/i],
      scriptHosts: [/loox\.io$/i, /loox\.app$/i],
      metafieldNamespaces: [/^loox$/i],
    },
  },
  {
    handle: "yotpo-reviews",
    name: "Yotpo Reviews",
    category: "reviews",
    patterns: {
      snippets: [/yotpo/i],
      assetNames: [/yotpo/i],
      cssClasses: [/\byotpo-/i],
      scriptHosts: [/yotpo\.com$/i],
      metafieldNamespaces: [/^yotpo$/i],
    },
  },
  {
    handle: "stamped-io",
    name: "Stamped.io Reviews & Loyalty",
    category: "reviews",
    patterns: {
      snippets: [/stamped/i],
      assetNames: [/stamped/i],
      cssClasses: [/\bstamped-/i],
      scriptHosts: [/stamped\.io$/i],
      metafieldNamespaces: [/^stamped$/i],
    },
  },
  {
    handle: "klaviyo",
    name: "Klaviyo Email Marketing",
    category: "marketing",
    patterns: {
      snippets: [/klaviyo/i],
      assetNames: [/klaviyo/i],
      cssClasses: [/\bklaviyo-/i],
      scriptHosts: [/klaviyo\.com$/i],
    },
  },
  {
    handle: "recharge",
    name: "Recharge Subscriptions",
    category: "subscriptions",
    patterns: {
      snippets: [/recharge/i],
      assetNames: [/recharge/i],
      cssClasses: [/\brecharge-/i],
      scriptHosts: [/rechargeapps\.com$/i, /rechargepayments\.com$/i],
    },
  },
  {
    handle: "bold-subscriptions",
    name: "Bold Subscriptions",
    category: "subscriptions",
    patterns: {
      snippets: [/bold[-_]?(subscription|recurring)/i],
      assetNames: [/bold[-_]?(subscription|recurring)/i],
      cssClasses: [/\bbold-subscri/i],
      scriptHosts: [/boldapps\.net$/i],
    },
  },
  {
    handle: "appstle-subscriptions",
    name: "Appstle Subscriptions",
    category: "subscriptions",
    patterns: {
      snippets: [/appstle/i],
      assetNames: [/appstle/i],
      cssClasses: [/\bappstle-/i],
      scriptHosts: [/appstle\.com$/i],
    },
  },
  {
    handle: "wishlist-plus",
    name: "Wishlist Plus",
    category: "wishlist",
    patterns: {
      snippets: [/wishlist[-_]?plus/i, /swym/i],
      assetNames: [/wishlist[-_]?plus/i, /swym/i],
      cssClasses: [/\bswym-/i],
      scriptHosts: [/swymrelay\.com$/i],
    },
  },
  {
    handle: "wishlist-hero",
    name: "Wishlist Hero",
    category: "wishlist",
    patterns: {
      snippets: [/wishlist[-_]?hero/i],
      assetNames: [/wishlist[-_]?hero/i],
      cssClasses: [/\bwishlist-hero-/i],
      scriptHosts: [/wishlisthero\.com$/i],
    },
  },
  {
    handle: "smile-io",
    name: "Smile.io Loyalty & Rewards",
    category: "loyalty",
    patterns: {
      snippets: [/smile[-_]?io/i, /\bsmile\b/i],
      assetNames: [/smile[-_]?io/i],
      cssClasses: [/\bsmile-/i],
      scriptHosts: [/sweettooth\.io$/i, /smile\.io$/i],
    },
  },
  {
    handle: "loyaltylion",
    name: "LoyaltyLion",
    category: "loyalty",
    patterns: {
      snippets: [/loyaltylion/i],
      assetNames: [/loyaltylion/i],
      cssClasses: [/\blion-/i],
      scriptHosts: [/loyaltylion\.com$/i, /loyaltylion\.net$/i],
    },
  },
  {
    handle: "searchanise",
    name: "Searchanise Search & Filter",
    category: "search",
    patterns: {
      snippets: [/searchanise/i],
      assetNames: [/searchanise/i],
      cssClasses: [/\bsearchanise-/i],
      scriptHosts: [/searchanise\.com$/i],
    },
  },
  {
    handle: "boost-ai-search",
    name: "Boost AI Search & Filter",
    category: "search",
    patterns: {
      snippets: [/boost[-_]?(ai|pfs|sd)/i],
      assetNames: [/boost[-_]?(ai|pfs|sd)/i],
      cssClasses: [/\bboost-pfs-/i, /\bboost-sd-/i],
      scriptHosts: [/boostcommerce\.net$/i],
    },
  },
  {
    handle: "rebuy",
    name: "Rebuy Personalization Engine",
    category: "upsell",
    patterns: {
      snippets: [/rebuy/i],
      assetNames: [/rebuy/i],
      cssClasses: [/\brebuy-/i],
      scriptHosts: [/rebuyengine\.com$/i],
    },
  },
  {
    handle: "privy",
    name: "Privy Popups & Email",
    category: "marketing",
    patterns: {
      snippets: [/privy/i],
      assetNames: [/privy/i],
      cssClasses: [/\bprivy-/i],
      scriptHosts: [/privy\.com$/i],
    },
  },
  {
    handle: "gorgias",
    name: "Gorgias Helpdesk",
    category: "support",
    patterns: {
      snippets: [/gorgias/i],
      assetNames: [/gorgias/i],
      cssClasses: [/\bgorgias-/i],
      scriptHosts: [/gorgias\.chat$/i, /gorgias\.com$/i],
    },
  },
  {
    handle: "tidio",
    name: "Tidio Live Chat",
    category: "support",
    patterns: {
      snippets: [/tidio/i],
      assetNames: [/tidio/i],
      cssClasses: [/\btidio-/i],
      scriptHosts: [/tidio\.co$/i, /tidiochat\.com$/i],
    },
  },
  {
    handle: "hotjar",
    name: "Hotjar Analytics",
    category: "analytics",
    patterns: {
      snippets: [/hotjar/i],
      assetNames: [/hotjar/i],
      scriptHosts: [/hotjar\.com$/i],
    },
  },
  {
    handle: "google-analytics",
    name: "Google Analytics (gtag)",
    category: "analytics",
    patterns: {
      snippets: [/gtag|google[-_]?analytics|\bga4\b/i],
      assetNames: [/gtag|google[-_]?analytics/i],
      scriptHosts: [/googletagmanager\.com$/i, /google-analytics\.com$/i],
    },
  },
  {
    handle: "meta-pixel",
    name: "Meta (Facebook) Pixel",
    category: "analytics",
    patterns: {
      snippets: [/facebook[-_]?pixel|meta[-_]?pixel|fbevents/i],
      assetNames: [/fbevents|facebook[-_]?pixel/i],
      scriptHosts: [/connect\.facebook\.net$/i],
    },
  },
  {
    handle: "pagefly",
    name: "PageFly Landing Page Builder",
    category: "page_builder",
    patterns: {
      snippets: [/pagefly/i],
      assetNames: [/pagefly/i],
      cssClasses: [/\bpf-/i, /\bpagefly-/i],
      scriptHosts: [/pagefly\.io$/i],
    },
  },
  {
    handle: "gempages",
    name: "GemPages Landing Page Builder",
    category: "page_builder",
    patterns: {
      snippets: [/gempages|gem[-_]?page/i],
      assetNames: [/gempages/i],
      cssClasses: [/\bgem-page/i],
      scriptHosts: [/gempages\.net$/i],
    },
  },
  {
    handle: "shogun",
    name: "Shogun Page Builder",
    category: "page_builder",
    patterns: {
      snippets: [/shogun/i],
      assetNames: [/shogun/i],
      cssClasses: [/\bshogun-/i],
      scriptHosts: [/getshogun\.com$/i],
    },
  },
  {
    handle: "vitals",
    name: "Vitals (All-in-one marketing)",
    category: "marketing",
    patterns: {
      snippets: [/vitals/i],
      assetNames: [/vitals/i],
      cssClasses: [/\bvitals-/i],
      scriptHosts: [/vitals\.co$/i, /vitals\.market$/i],
    },
  },
  {
    handle: "bundle-builder",
    name: "Bundle Builder",
    category: "merchandising",
    patterns: {
      snippets: [/bundle[-_]?builder/i],
      assetNames: [/bundle[-_]?builder/i],
      cssClasses: [/\bbundleb-/i],
      scriptHosts: [/bundleb\.com$/i],
    },
  },
];

export function findKnownAppByHandle(handle: string): KnownAppDef | undefined {
  return KNOWN_APPS.find((a) => a.handle === handle);
}

/** Loose match: does this app's known handle/name relate to a `shopify://apps/{handle}/...` handle string? */
export function findKnownAppByAppUriHandle(handle: string): KnownAppDef | undefined {
  const normalized = handle.toLowerCase();
  return KNOWN_APPS.find((a) => a.handle === normalized || normalized.includes(a.handle) || a.handle.includes(normalized));
}
