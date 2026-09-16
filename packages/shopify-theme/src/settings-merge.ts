/**
 * Structured merges for `config/settings_data.json` and JSON templates
 * (docs/THEME_ACCESS_STRATEGY.md §4.4; threat model T15). App blocks/embeds
 * (`shopify://apps/...`) are preserved through a merge unless the patch
 * explicitly targets that exact block id.
 */
import { ShopManagerAIError } from "@shopmanagerai/shared";

const APP_REF_PREFIX = "shopify://apps/";

export const MAX_SECTIONS_PER_TEMPLATE = 25;
export const MAX_BLOCKS_PER_SECTION = 50;

type JsonObject = Record<string, unknown>;

function isAppRefType(type: unknown): boolean {
  return typeof type === "string" && type.startsWith(APP_REF_PREFIX);
}

function isPlainObject(v: unknown): v is JsonObject {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: JsonObject = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base ? deepMerge((base as JsonObject)[k], v) : v;
  }
  return out;
}

export interface MergeSettingsDataOptions {
  /** Preserve every `current.blocks` entry whose type is an app reference unless the patch explicitly targets it. Default true. */
  preserveAppEmbeds?: boolean;
}

/**
 * Deep-merges `current.sections` and `current.settings`; merges
 * `current.blocks` while preserving every app-reference block from the
 * current file that the patch does not explicitly target by id.
 */
export function mergeSettingsData(currentJson: JsonObject, patch: JsonObject, opts: MergeSettingsDataOptions = {}): JsonObject {
  const preserveAppEmbeds = opts.preserveAppEmbeds ?? true;

  const currentRoot = isPlainObject(currentJson.current) ? (currentJson.current as JsonObject) : {};
  const patchRoot = isPlainObject(patch.current) ? (patch.current as JsonObject) : {};

  const mergedSettings = deepMerge(currentRoot.settings ?? {}, patchRoot.settings ?? {});
  const mergedSections = deepMerge(currentRoot.sections ?? {}, patchRoot.sections ?? {});

  const currentBlocks = isPlainObject(currentRoot.blocks) ? (currentRoot.blocks as JsonObject) : {};
  const patchBlocks = isPlainObject(patchRoot.blocks) ? (patchRoot.blocks as JsonObject) : {};

  const mergedBlocks: JsonObject = {};
  // Start from current blocks; app-ref blocks not explicitly targeted survive untouched.
  for (const [id, block] of Object.entries(currentBlocks)) {
    const targeted = id in patchBlocks;
    const isAppRef = isPlainObject(block) && isAppRefType((block as JsonObject).type);
    if (isAppRef && preserveAppEmbeds && !targeted) {
      mergedBlocks[id] = block;
    } else if (targeted) {
      mergedBlocks[id] = deepMerge(block, patchBlocks[id]);
    } else {
      mergedBlocks[id] = block;
    }
  }
  // Any new blocks introduced by the patch that don't exist in current.
  for (const [id, block] of Object.entries(patchBlocks)) {
    if (!(id in mergedBlocks)) mergedBlocks[id] = block;
  }

  return {
    ...currentJson,
    current: {
      ...currentRoot,
      ...patchRoot,
      settings: mergedSettings,
      sections: mergedSections,
      blocks: mergedBlocks,
    },
  };
}

/**
 * Merges a JSON template (e.g. `templates/product.json`) with a patch,
 * preserving app-block entries under each section's `blocks` unless the
 * patch explicitly targets that block id. Enforces the theme's structural
 * limits (25 sections / 50 blocks per section) on the merged result.
 */
export function mergeJsonTemplate(currentJson: JsonObject, patch: JsonObject): JsonObject {
  const currentSections = isPlainObject(currentJson.sections) ? (currentJson.sections as JsonObject) : {};
  const patchSections = isPlainObject(patch.sections) ? (patch.sections as JsonObject) : {};

  const mergedSections: JsonObject = {};
  for (const [sectionId, section] of Object.entries(currentSections)) {
    if (sectionId in patchSections) {
      mergedSections[sectionId] = mergeSection(section, patchSections[sectionId]);
    } else {
      mergedSections[sectionId] = section;
    }
  }
  for (const [sectionId, section] of Object.entries(patchSections)) {
    if (!(sectionId in mergedSections)) mergedSections[sectionId] = section;
  }

  const sectionCount = Object.keys(mergedSections).length;
  if (sectionCount > MAX_SECTIONS_PER_TEMPLATE) {
    throw new ShopManagerAIError("INVALID_INPUT", `Merged template would have ${sectionCount} sections, exceeding the limit of ${MAX_SECTIONS_PER_TEMPLATE}.`, {
      retryable: false,
      details: { sectionCount, limit: MAX_SECTIONS_PER_TEMPLATE },
    });
  }
  for (const [sectionId, section] of Object.entries(mergedSections)) {
    const blocks = isPlainObject(section) && isPlainObject((section as JsonObject).blocks) ? ((section as JsonObject).blocks as JsonObject) : {};
    const blockCount = Object.keys(blocks).length;
    if (blockCount > MAX_BLOCKS_PER_SECTION) {
      throw new ShopManagerAIError("INVALID_INPUT", `Section "${sectionId}" would have ${blockCount} blocks, exceeding the limit of ${MAX_BLOCKS_PER_SECTION}.`, {
        retryable: false,
        details: { sectionId, blockCount, limit: MAX_BLOCKS_PER_SECTION },
      });
    }
  }

  const merged: JsonObject = { ...currentJson, ...patch, sections: mergedSections };
  if ("order" in patch) merged.order = patch.order;
  else if ("order" in currentJson) merged.order = currentJson.order;
  return merged;
}

function mergeSection(current: unknown, patch: unknown): unknown {
  if (!isPlainObject(current) || !isPlainObject(patch)) return patch ?? current;

  const currentBlocks = isPlainObject(current.blocks) ? (current.blocks as JsonObject) : {};
  const patchBlocks = isPlainObject(patch.blocks) ? (patch.blocks as JsonObject) : {};

  const mergedBlocks: JsonObject = {};
  for (const [id, block] of Object.entries(currentBlocks)) {
    const targeted = id in patchBlocks;
    const isAppRef = isPlainObject(block) && isAppRefType((block as JsonObject).type);
    if (isAppRef && !targeted) {
      mergedBlocks[id] = block;
    } else if (targeted) {
      mergedBlocks[id] = deepMerge(block, patchBlocks[id]);
    } else {
      mergedBlocks[id] = block;
    }
  }
  for (const [id, block] of Object.entries(patchBlocks)) {
    if (!(id in mergedBlocks)) mergedBlocks[id] = block;
  }

  const merged = deepMerge(
    { ...current, blocks: undefined },
    { ...patch, blocks: undefined },
  ) as JsonObject;
  merged.blocks = mergedBlocks;
  if ("block_order" in patch) merged.block_order = (patch as JsonObject).block_order;
  else if ("block_order" in current) merged.block_order = (current as JsonObject).block_order;
  return merged;
}

export interface AppReference {
  /** Where the reference was found: "settings_data.blocks" or "template.sections.<id>.blocks". */
  location: string;
  blockId: string;
  type: string;
  disabled?: boolean;
}

/**
 * Scans a settings_data.json or JSON-template object for
 * `shopify://apps/...` block references (app blocks and app embeds).
 */
export function listAppReferences(json: JsonObject): AppReference[] {
  const out: AppReference[] = [];

  const currentRoot = isPlainObject(json.current) ? (json.current as JsonObject) : undefined;
  if (currentRoot && isPlainObject(currentRoot.blocks)) {
    for (const [id, block] of Object.entries(currentRoot.blocks as JsonObject)) {
      if (isPlainObject(block) && isAppRefType(block.type)) {
        out.push({ location: "settings_data.blocks", blockId: id, type: block.type as string, disabled: typeof block.disabled === "boolean" ? block.disabled : undefined });
      }
    }
  }

  if (isPlainObject(json.sections)) {
    for (const [sectionId, section] of Object.entries(json.sections as JsonObject)) {
      if (!isPlainObject(section) || !isPlainObject(section.blocks)) continue;
      for (const [blockId, block] of Object.entries(section.blocks as JsonObject)) {
        if (isPlainObject(block) && isAppRefType(block.type)) {
          out.push({ location: `template.sections.${sectionId}.blocks`, blockId, type: block.type as string });
        }
      }
    }
  }

  return out;
}
