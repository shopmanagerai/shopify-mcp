/**
 * Static theme architecture extraction (docs/STORE_DIGITAL_TWIN.md §2,
 * docs/CURRENT_SHOPIFY_RESEARCH.md §3). Pure, synchronous.
 */
import { parseThemeJson } from "@shopmanagerai/shared";
import type { ThemeFileSet } from "./fileset.js";
import { inspectLiquid, type ParseIssue } from "./liquid.js";

export const APP_BLOCK_PREFIX = "shopify://apps/";

export function isAppBlockType(type: unknown): boolean {
  return typeof type === "string" && type.startsWith(APP_BLOCK_PREFIX);
}

function tryParseJson(text: string | undefined): { json: unknown; error?: ParseIssue } {
  if (text === undefined) return { json: null, error: { message: "binary or missing file", line: 0, col: 0 } };
  try {
    return { json: parseThemeJson(text) };
  } catch (err) {
    return { json: null, error: { message: err instanceof Error ? err.message : String(err), line: 0, col: 0 } };
  }
}

export interface ArchBlock {
  id: string;
  type: string;
  isAppBlock: boolean;
  disabled?: boolean;
}

export interface ArchSectionInstance {
  id: string;
  type: string;
  blocks: ArchBlock[];
  disabled?: boolean;
}

export interface ArchTemplate {
  key: string;
  kind: "json" | "liquid";
  sections: ArchSectionInstance[];
  order: string[];
  appBlocks: number;
}

export interface ArchSectionGroup {
  key: string;
  sections: ArchSectionInstance[];
}

export interface ArchSectionSchema {
  key: string;
  name: string | null;
  schemaErrors: ParseIssue[];
  settingsCount: number;
  blockTypes: string[];
  acceptsAppBlocks: boolean;
  presets: unknown[];
  enabledOn: unknown;
  disabledOn: unknown;
  limit?: number;
}

export interface ArchBlockSchema {
  key: string;
  name: string | null;
  schemaErrors: ParseIssue[];
}

export interface SettingsSchemaGroup {
  name: string | null;
  settings: Array<{ id?: string; type: string; default?: unknown }>;
}

export interface ThemeArchitecture {
  layouts: string[];
  templates: ArchTemplate[];
  sectionGroups: ArchSectionGroup[];
  sections: ArchSectionSchema[];
  blocks: ArchBlockSchema[];
  snippets: string[];
  assets: Array<{ key: string; size: number }>;
  config: {
    settingsSchema: SettingsSchemaGroup[];
    settingsData: { preset: unknown; appEmbeds: Array<{ id: string; type: string; disabled: boolean }> };
  };
  locales: string[];
  counts: Record<string, number>;
  warnings: string[];
}

function blocksFromJson(blocksObj: unknown): ArchBlock[] {
  if (!blocksObj || typeof blocksObj !== "object") return [];
  return Object.entries(blocksObj as Record<string, any>).map(([id, b]) => ({
    id,
    type: typeof b?.type === "string" ? b.type : "",
    isAppBlock: isAppBlockType(b?.type),
    disabled: !!b?.disabled,
  }));
}

function sectionInstancesFromJson(sectionsObj: unknown): { instances: Map<string, ArchSectionInstance>; order: string[] } {
  const instances = new Map<string, ArchSectionInstance>();
  if (sectionsObj && typeof sectionsObj === "object") {
    for (const [id, s] of Object.entries(sectionsObj as Record<string, any>)) {
      instances.set(id, {
        id,
        type: typeof s?.type === "string" ? s.type : "",
        blocks: blocksFromJson(s?.blocks),
        disabled: !!s?.disabled,
      });
    }
  }
  return { instances, order: [...instances.keys()] };
}

export function buildArchitecture(fileSet: ThemeFileSet): ThemeArchitecture {
  const warnings: string[] = [];

  const layouts = fileSet.byRole("layout").map((f) => f.key);

  const templates: ArchTemplate[] = [];
  for (const f of fileSet.byRole("template_json")) {
    const text = fileSet.text(f.key);
    const { json, error } = tryParseJson(text);
    if (error) {
      warnings.push(`${f.key}: ${error.message}`);
      templates.push({ key: f.key, kind: "json", sections: [], order: [], appBlocks: 0 });
      continue;
    }
    const obj = json as Record<string, any>;
    const { instances, order: sectionKeys } = sectionInstancesFromJson(obj.sections);
    const order: string[] = Array.isArray(obj.order) ? obj.order : sectionKeys;
    const sections = order.filter((id) => instances.has(id)).map((id) => instances.get(id) as ArchSectionInstance);
    const appBlocks = sections.reduce((n, s) => n + s.blocks.filter((b) => b.isAppBlock).length, 0);
    templates.push({ key: f.key, kind: "json", sections, order, appBlocks });
  }
  for (const f of fileSet.byRole("template_liquid")) {
    const text = fileSet.text(f.key) ?? "";
    const insp = inspectLiquid(f.key, text);
    const sections: ArchSectionInstance[] = insp.sections.map((s) => ({ id: s.target, type: s.target, blocks: [] }));
    templates.push({ key: f.key, kind: "liquid", sections, order: sections.map((s) => s.id), appBlocks: 0 });
  }

  const sectionGroups: ArchSectionGroup[] = [];
  for (const f of fileSet.byRole("section_group")) {
    const text = fileSet.text(f.key);
    const { json, error } = tryParseJson(text);
    if (error) {
      warnings.push(`${f.key}: ${error.message}`);
      sectionGroups.push({ key: f.key, sections: [] });
      continue;
    }
    const obj = json as Record<string, any>;
    const { instances, order: sectionKeys } = sectionInstancesFromJson(obj.sections);
    const order: string[] = Array.isArray(obj.order) ? obj.order : sectionKeys;
    const sections = order.filter((id) => instances.has(id)).map((id) => instances.get(id) as ArchSectionInstance);
    sectionGroups.push({ key: f.key, sections });
  }

  const sections: ArchSectionSchema[] = [];
  for (const f of fileSet.byRole("section")) {
    const text = fileSet.text(f.key) ?? "";
    const insp = inspectLiquid(f.key, text);
    const schemaJson = (insp.schema?.json ?? {}) as Record<string, any>;
    const blockTypes: string[] = Array.isArray(schemaJson.blocks)
      ? schemaJson.blocks.map((b: any) => (typeof b?.type === "string" ? b.type : "")).filter(Boolean)
      : [];
    if (insp.schema) {
      for (const e of insp.schema.errors) warnings.push(`${f.key}: schema ${e.message}`);
    }
    sections.push({
      key: f.key,
      name: typeof schemaJson.name === "string" ? schemaJson.name : null,
      schemaErrors: insp.schema?.errors ?? [],
      settingsCount: Array.isArray(schemaJson.settings) ? schemaJson.settings.length : 0,
      blockTypes,
      acceptsAppBlocks: blockTypes.includes("@app"),
      presets: Array.isArray(schemaJson.presets) ? schemaJson.presets : [],
      enabledOn: schemaJson.enabled_on ?? null,
      disabledOn: schemaJson.disabled_on ?? null,
      limit: typeof schemaJson.blocks_limit === "number" ? schemaJson.blocks_limit : undefined,
    });
  }

  const blocks: ArchBlockSchema[] = [];
  for (const f of fileSet.byRole("block")) {
    const text = fileSet.text(f.key) ?? "";
    const insp = inspectLiquid(f.key, text);
    const schemaJson = (insp.schema?.json ?? {}) as Record<string, any>;
    blocks.push({
      key: f.key,
      name: typeof schemaJson.name === "string" ? schemaJson.name : null,
      schemaErrors: insp.schema?.errors ?? [],
    });
  }

  const snippets = fileSet.byRole("snippet").map((f) => f.key);
  const assets = fileSet.byRole("asset").map((f) => ({ key: f.key, size: f.size ?? fileSet.text(f.key)?.length ?? 0 }));
  const locales = fileSet.byRole("locale").map((f) => f.key);

  const settingsSchemaFile = fileSet.get("config/settings_schema.json");
  let settingsSchema: SettingsSchemaGroup[] = [];
  if (settingsSchemaFile) {
    const { json, error } = tryParseJson(fileSet.text("config/settings_schema.json"));
    if (error) warnings.push(`config/settings_schema.json: ${error.message}`);
    else if (Array.isArray(json)) {
      settingsSchema = json.map((group: any) => ({
        name: typeof group?.name === "string" ? group.name : null,
        settings: Array.isArray(group?.settings)
          ? group.settings
              .filter((s: any) => s && typeof s === "object")
              .map((s: any) => ({ id: s.id, type: s.type, default: s.default }))
          : [],
      }));
    }
  } else {
    warnings.push("config/settings_schema.json missing");
  }

  const settingsDataFile = fileSet.get("config/settings_data.json");
  let preset: unknown = null;
  let appEmbeds: Array<{ id: string; type: string; disabled: boolean }> = [];
  if (settingsDataFile) {
    const { json, error } = tryParseJson(fileSet.text("config/settings_data.json"));
    if (error) warnings.push(`config/settings_data.json: ${error.message}`);
    else {
      const obj = (json ?? {}) as Record<string, any>;
      preset = obj.current ?? null;
      const currentBlocks = typeof obj.current === "object" && obj.current !== null ? obj.current.blocks : undefined;
      if (currentBlocks && typeof currentBlocks === "object") {
        appEmbeds = Object.entries(currentBlocks as Record<string, any>)
          .filter(([, b]) => isAppBlockType(b?.type))
          .map(([id, b]) => ({ id, type: b.type, disabled: !!b.disabled }));
      }
    }
  } else {
    warnings.push("config/settings_data.json missing");
  }

  const counts: Record<string, number> = {
    layouts: layouts.length,
    templates: templates.length,
    sectionGroups: sectionGroups.length,
    sections: sections.length,
    blocks: blocks.length,
    snippets: snippets.length,
    assets: assets.length,
    locales: locales.length,
    total: fileSet.size,
  };

  return {
    layouts,
    templates,
    sectionGroups,
    sections,
    blocks,
    snippets,
    assets,
    config: { settingsSchema, settingsData: { preset, appEmbeds } },
    locales,
    counts,
    warnings,
  };
}
