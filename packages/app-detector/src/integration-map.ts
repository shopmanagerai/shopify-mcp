/**
 * Where detected apps are integrated (per template / section-group), a basic
 * preservation manifest for theme-write operations, and a before/after check
 * used as the Free-tier warning when a theme write might drop an app
 * integration (review finding G).
 */
import { isAppBlockType, type ThemeArchitecture } from "@shopmanagerai/theme-intelligence";
import { handleFromAppUri, type AppLocation, type DetectedApp, type IntegrationType } from "./detect.js";

export interface IntegrationMapAppBlock {
  appId: string;
  blockId: string;
  sectionId: string;
  type: string;
}
export interface IntegrationMapAppEmbed {
  appId: string;
  embedId: string;
  type: string;
}
export interface IntegrationMapEntry {
  location: string;
  appBlocks: IntegrationMapAppBlock[];
  appEmbeds: IntegrationMapAppEmbed[];
}

/** Per template/section-group: which apps are integrated where. */
export function buildIntegrationMap(architecture: ThemeArchitecture): IntegrationMapEntry[] {
  const entries: IntegrationMapEntry[] = [];

  for (const t of architecture.templates) {
    const appBlocks: IntegrationMapAppBlock[] = [];
    for (const s of t.sections) {
      for (const b of s.blocks) {
        const appId = handleFromAppUri(b.type);
        if (appId) appBlocks.push({ appId, blockId: b.id, sectionId: s.id, type: b.type });
      }
    }
    if (appBlocks.length > 0) entries.push({ location: t.key, appBlocks, appEmbeds: [] });
  }

  for (const g of architecture.sectionGroups) {
    const appBlocks: IntegrationMapAppBlock[] = [];
    for (const s of g.sections) {
      for (const b of s.blocks) {
        const appId = handleFromAppUri(b.type);
        if (appId) appBlocks.push({ appId, blockId: b.id, sectionId: s.id, type: b.type });
      }
    }
    if (appBlocks.length > 0) entries.push({ location: g.key, appBlocks, appEmbeds: [] });
  }

  const appEmbeds: IntegrationMapAppEmbed[] = architecture.config.settingsData.appEmbeds
    .map((e) => {
      const appId = handleFromAppUri(e.type);
      return appId ? { appId, embedId: e.id, type: e.type } : null;
    })
    .filter((x): x is IntegrationMapAppEmbed => x !== null);
  if (appEmbeds.length > 0) entries.push({ location: "config/settings_data.json", appBlocks: [], appEmbeds });

  return entries;
}

export type PreservationImportance = "critical" | "normal";

export interface PreservationEntry {
  app: string;
  type: IntegrationType;
  importance: PreservationImportance;
  action: "preserve";
  verification: "dom";
  location: AppLocation;
}

/** Categories where losing the integration is a purchase-flow / retention risk. */
const CRITICAL_CATEGORIES = new Set(["reviews", "subscriptions", "cart", "checkout", "loyalty"]);

function isCriticalCategory(category: string | undefined): boolean {
  return !!category && CRITICAL_CATEGORIES.has(category);
}

/** A basic (non-AI) preservation manifest: one entry per app x integration type, all marked preserve/dom. */
export function preservationManifestBasic(detected: DetectedApp[], architecture: ThemeArchitecture): PreservationEntry[] {
  void architecture; // reserved for future cross-checks against current architecture
  const entries: PreservationEntry[] = [];
  for (const app of detected) {
    for (const type of app.integrationTypes) {
      const location = app.locations[0] ?? { file: "unknown", detail: "" };
      entries.push({
        app: app.id,
        type,
        importance: isCriticalCategory(app.category) ? "critical" : "normal",
        action: "preserve",
        verification: "dom",
        location,
      });
    }
  }
  return entries;
}

export interface AppRef {
  app: string;
  type: "app_block" | "app_embed";
  location: string;
  detail: string;
}

function refKey(r: AppRef): string {
  return `${r.app}|${r.type}|${r.location}|${r.detail}`;
}

function collectAppRefs(architecture: ThemeArchitecture): AppRef[] {
  const refs: AppRef[] = [];
  for (const t of architecture.templates) {
    for (const s of t.sections) {
      for (const b of s.blocks) {
        if (!isAppBlockType(b.type)) continue;
        const app = handleFromAppUri(b.type);
        if (app) refs.push({ app, type: "app_block", location: t.key, detail: `${s.id}/${b.id}` });
      }
    }
  }
  for (const g of architecture.sectionGroups) {
    for (const s of g.sections) {
      for (const b of s.blocks) {
        if (!isAppBlockType(b.type)) continue;
        const app = handleFromAppUri(b.type);
        if (app) refs.push({ app, type: "app_block", location: g.key, detail: `${s.id}/${b.id}` });
      }
    }
  }
  for (const e of architecture.config.settingsData.appEmbeds) {
    const app = handleFromAppUri(e.type);
    if (app) refs.push({ app, type: "app_embed", location: "config/settings_data.json", detail: e.id });
  }
  return refs;
}

/** Diff app references between two architecture snapshots, the Free-tier theme-write warning. */
export function checkPreservation(
  before: ThemeArchitecture,
  after: ThemeArchitecture,
): { missing: AppRef[]; added: AppRef[] } {
  const beforeRefs = collectAppRefs(before);
  const afterRefs = collectAppRefs(after);
  const afterKeys = new Set(afterRefs.map(refKey));
  const beforeKeys = new Set(beforeRefs.map(refKey));
  return {
    missing: beforeRefs.filter((r) => !afterKeys.has(refKey(r))),
    added: afterRefs.filter((r) => !beforeKeys.has(refKey(r))),
  };
}
