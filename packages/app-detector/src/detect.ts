/**
 * App detection reconstructs "installed apps" from evidence, theme app
 * blocks/embeds, legacy script tags, theme-file references, public metafield
 * namespaces, rendered-page script hosts. Never as an authoritative list
 * (docs/CURRENT_SHOPIFY_RESEARCH.md §4). Pure, synchronous.
 */
import type { Evidence } from "@shopmanagerai/shared";
import { APP_BLOCK_PREFIX, isAppBlockType, type ThemeArchitecture } from "@shopmanagerai/theme-intelligence";
import type { ThemeFileSet } from "@shopmanagerai/theme-intelligence";
import { KNOWN_APPS, findKnownAppByAppUriHandle, type KnownAppDef } from "./known-apps.js";

export type IntegrationType =
  | "app_block"
  | "app_embed"
  | "script_tag"
  | "theme_reference"
  | "metafield_namespace"
  | "rendered_script";

export interface AppLocation {
  file: string;
  line?: number;
  detail: string;
}

export interface DetectedApp {
  id: string;
  name?: string;
  category?: string;
  evidence: Evidence[];
  confidence: number;
  integrationTypes: IntegrationType[];
  locations: AppLocation[];
}

export interface ScriptTagInput {
  id: string;
  src: string;
  displayScope?: string;
}

export interface DetectAppsInput {
  fileSet: ThemeFileSet;
  architecture: ThemeArchitecture;
  scriptTags?: ScriptTagInput[];
  renderedScriptHosts?: string[];
  metafieldNamespaces?: string[];
}

/** Script tags stop running entirely on this date (docs/CURRENT_SHOPIFY_RESEARCH.md §4). */
export const SCRIPT_TAG_SUNSET_DATE = "2027-03-01";

export function handleFromAppUri(uri: string): string | null {
  if (!isAppBlockType(uri)) return null;
  const rest = uri.slice(APP_BLOCK_PREFIX.length);
  const handle = rest.split("/")[0];
  return handle && handle.length > 0 ? handle : null;
}

function hostOf(src: string): string | null {
  try {
    return new URL(src).hostname;
  } catch {
    const m = src.match(/^(?:https?:)?\/\/([^/]+)/i);
    return m ? (m[1] as string) : null;
  }
}

class AppAccumulator {
  private readonly byId = new Map<string, DetectedApp>();

  ensure(id: string, known?: KnownAppDef): DetectedApp {
    let app = this.byId.get(id);
    if (!app) {
      app = {
        id,
        name: known?.name,
        category: known?.category,
        evidence: [],
        confidence: 0,
        integrationTypes: [],
        locations: [],
      };
      this.byId.set(id, app);
    } else if (known && !app.name) {
      app.name = known.name;
      app.category = known.category;
    }
    return app;
  }

  record(id: string, opts: { type: IntegrationType; confidence: number; location: AppLocation; evidence: Evidence; known?: KnownAppDef }) {
    const app = this.ensure(id, opts.known);
    if (!app.integrationTypes.includes(opts.type)) app.integrationTypes.push(opts.type);
    app.locations.push(opts.location);
    app.evidence.push(opts.evidence);
    app.confidence = Math.max(app.confidence, opts.confidence);
  }

  all(): DetectedApp[] {
    return [...this.byId.values()];
  }
}

export function detectApps(input: DetectAppsInput): DetectedApp[] {
  const acc = new AppAccumulator();
  const { fileSet, architecture } = input;

  // 1. App blocks in JSON templates and section groups, confidence 1.0, unambiguous.
  const recordAppBlock = (fileKey: string, sectionId: string, blockId: string, type: string) => {
    const handle = handleFromAppUri(type);
    if (!handle) return;
    acc.record(handle, {
      type: "app_block",
      confidence: 1.0,
      known: findKnownAppByAppUriHandle(handle),
      location: { file: fileKey, detail: `block "${blockId}" (${type}) in section "${sectionId}"` },
      evidence: { type: "json", label: "app block reference", value: { file: fileKey, sectionId, blockId, type } },
    });
  };
  for (const t of architecture.templates) {
    for (const s of t.sections) {
      for (const b of s.blocks) {
        if (isAppBlockType(b.type)) recordAppBlock(t.key, s.id, b.id, b.type);
      }
    }
  }
  for (const g of architecture.sectionGroups) {
    for (const s of g.sections) {
      for (const b of s.blocks) {
        if (isAppBlockType(b.type)) recordAppBlock(g.key, s.id, b.id, b.type);
      }
    }
  }

  // 2. App embed blocks in config/settings_data.json, confidence 1.0.
  for (const embed of architecture.config.settingsData.appEmbeds) {
    const handle = handleFromAppUri(embed.type);
    if (!handle) continue;
    acc.record(handle, {
      type: "app_embed",
      confidence: 1.0,
      known: findKnownAppByAppUriHandle(handle),
      location: {
        file: "config/settings_data.json",
        detail: `app embed "${embed.id}" (${embed.type}), disabled=${embed.disabled}`,
      },
      evidence: { type: "json", label: "app embed reference", value: embed },
    });
  }

  // 3. Legacy script tags, confidence 0.9, with a sunset warning (deprecated, stop 2027-03-01).
  for (const tag of input.scriptTags ?? []) {
    const host = hostOf(tag.src);
    const known = host ? KNOWN_APPS.find((a) => a.patterns.scriptHosts?.some((re) => re.test(host))) : undefined;
    const id = known?.handle ?? `script:${host ?? tag.src}`;
    acc.record(id, {
      type: "script_tag",
      confidence: 0.9,
      known,
      location: { file: "script_tags", detail: `scriptTag ${tag.id}: ${tag.src} (scope: ${tag.displayScope ?? "unknown"})` },
      evidence: {
        type: "text",
        label: "legacy script tag",
        value: `${tag.src}, Script Tags are deprecated and stop running on ${SCRIPT_TAG_SUNSET_DATE}; migrate to a theme app extension or web pixel.`,
      },
    });
  }

  // 4. Theme references, scan file names and text for known-app fingerprints. confidence 0.6-0.8.
  for (const known of KNOWN_APPS) {
    for (const f of fileSet.all()) {
      const basename = f.key.split("/").pop() ?? f.key;
      if (known.patterns.snippets?.some((re) => re.test(basename)) && (f.key.startsWith("snippets/") || f.key.startsWith("sections/") || f.key.startsWith("blocks/"))) {
        acc.record(known.handle, {
          type: "theme_reference",
          confidence: 0.8,
          known,
          location: { file: f.key, detail: `file name matches known snippet/section pattern for ${known.name}` },
          evidence: { type: "text", label: "theme file reference", value: f.key },
        });
      }
      if (known.patterns.assetNames?.some((re) => re.test(basename)) && f.key.startsWith("assets/")) {
        acc.record(known.handle, {
          type: "theme_reference",
          confidence: 0.7,
          known,
          location: { file: f.key, detail: `asset name matches known pattern for ${known.name}` },
          evidence: { type: "text", label: "theme asset reference", value: f.key },
        });
      }
    }
    if (known.patterns.cssClasses) {
      for (const f of fileSet.all()) {
        const text = fileSet.text(f.key);
        if (text === undefined) continue;
        if (!f.key.endsWith(".liquid") && !f.key.endsWith(".css")) continue;
        for (const re of known.patterns.cssClasses) {
          if (re.test(text)) {
            acc.record(known.handle, {
              type: "theme_reference",
              confidence: 0.6,
              known,
              location: { file: f.key, detail: `CSS class matches known pattern for ${known.name}` },
              evidence: { type: "text", label: "theme css class reference", value: re.source },
            });
            break;
          }
        }
      }
    }
  }

  // 5. Metafield namespaces, confidence 0.5.
  for (const ns of input.metafieldNamespaces ?? []) {
    const known = KNOWN_APPS.find((a) => a.patterns.metafieldNamespaces?.some((re) => re.test(ns)));
    const id = known?.handle ?? `metafield:${ns}`;
    acc.record(id, {
      type: "metafield_namespace",
      confidence: 0.5,
      known,
      location: { file: "metafields", detail: `namespace "${ns}"` },
      evidence: { type: "text", label: "metafield namespace", value: ns },
    });
  }

  // 6. Rendered script hosts (from a live page capture), confidence 0.7.
  for (const host of input.renderedScriptHosts ?? []) {
    const known = KNOWN_APPS.find((a) => a.patterns.scriptHosts?.some((re) => re.test(host)));
    const id = known?.handle ?? `script:${host}`;
    acc.record(id, {
      type: "rendered_script",
      confidence: 0.7,
      known,
      location: { file: "rendered_page", detail: `script host "${host}" observed on a live page render` },
      evidence: { type: "text", label: "rendered script host", value: host },
    });
  }

  return acc.all();
}
