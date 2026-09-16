/**
 * Design token extraction: colors, typography, spacing, radii, shadows,
 * breakpoints, from settings_schema/settings_data defaults+current values
 * and CSS custom properties in assets/*.css and {% style %} blocks. Pure,
 * synchronous, deliberately basic (see docs/STORE_DIGITAL_TWIN.md §2).
 */
import { parseThemeJson } from "@shopmanagerai/shared";
import type { Finding } from "@shopmanagerai/shared";
import type { ThemeFileSet } from "./fileset.js";

const HEX_COLOR_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB_COLOR_RE = /\brgba?\([^)]+\)/gi;
const HSL_COLOR_RE = /\bhsla?\([^)]+\)/gi;
const CUSTOM_PROP_RE = /(--[a-zA-Z0-9-_]+)\s*:\s*([^;]+);/g;
const SPACING_VALUE_RE = /\b(margin|padding|gap|row-gap|column-gap)[a-z-]*\s*:\s*([^;]+);/gi;
const RADIUS_VALUE_RE = /\bborder-radius\s*:\s*([^;]+);/gi;
const SHADOW_VALUE_RE = /\bbox-shadow\s*:\s*([^;]+);/gi;
const MEDIA_WIDTH_RE = /@media[^{]*\(\s*(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)\s*\)/gi;
const UNIT_VALUE_RE = /(-?\d+(?:\.\d+)?)(px|rem|em)\b/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;]+);/gi;

export interface ColorToken {
  value: string;
  sources: string[];
}
export interface TypographyToken {
  fontFamilies: string[];
  sizes: Array<{ value: string; count: number }>;
  lineHeights: Array<{ value: string; count: number }>;
}
export interface SpacingToken {
  value: string;
  count: number;
}
export interface DesignTokens {
  colors: ColorToken[];
  typography: TypographyToken;
  spacing: SpacingToken[];
  radii: SpacingToken[];
  shadows: Array<{ value: string; count: number }>;
  breakpoints: Array<{ value: string; count: number }>;
}

function bump<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function collectFromSettingsValue(value: unknown, path: string, colors: Map<string, Set<string>>) {
  if (typeof value === "string") {
    const s = value.trim();
    if (/^#(?:[0-9a-f]{3,8})$/i.test(s) || /^rgba?\(/i.test(s) || /^hsla?\(/i.test(s)) {
      if (!colors.has(s)) colors.set(s, new Set());
      colors.get(s)!.add(path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectFromSettingsValue(v, `${path}[${i}]`, colors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectFromSettingsValue(v, path ? `${path}.${k}` : k, colors);
    }
  }
}

function cssBlocks(fileSet: ThemeFileSet): Array<{ key: string; css: string }> {
  const out: Array<{ key: string; css: string }> = [];
  for (const f of fileSet.byRole("asset")) {
    if (!f.key.endsWith(".css") && !f.key.endsWith(".css.liquid")) continue;
    const text = fileSet.text(f.key);
    if (text !== undefined) out.push({ key: f.key, css: text });
  }
  const styleTagRe = /\{%-?\s*(?:style|stylesheet)\s*-?%\}([\s\S]*?)\{%-?\s*end(?:style|stylesheet)\s*-?%\}/g;
  for (const f of [...fileSet.byRole("section"), ...fileSet.byRole("block"), ...fileSet.byRole("layout")]) {
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    let m: RegExpExecArray | null;
    styleTagRe.lastIndex = 0;
    while ((m = styleTagRe.exec(text))) {
      out.push({ key: f.key, css: m[1] as string });
    }
  }
  return out;
}

export function extractDesignTokens(fileSet: ThemeFileSet): DesignTokens {
  const colorSources = new Map<string, Set<string>>();

  const settingsSchemaText = fileSet.text("config/settings_schema.json");
  if (settingsSchemaText) {
    try {
      const groups = parseThemeJson(settingsSchemaText);
      if (Array.isArray(groups)) {
        for (const g of groups) {
          if (Array.isArray(g?.settings)) {
            for (const s of g.settings) {
              collectFromSettingsValue(s?.default, `settings_schema:${s?.id ?? "?"}`, colorSources);
            }
          }
        }
      }
    } catch {
      // ignored, architecture.ts surfaces schema parse errors as warnings
    }
  }

  const settingsDataText = fileSet.text("config/settings_data.json");
  if (settingsDataText) {
    try {
      const data = parseThemeJson(settingsDataText);
      collectFromSettingsValue(data?.current, "settings_data:current", colorSources);
    } catch {
      // ignored
    }
  }

  const fontFamilies = new Set<string>();
  const sizeCounts = new Map<string, number>();
  const lineHeightCounts = new Map<string, number>();
  const spacingCounts = new Map<string, number>();
  const radiusCounts = new Map<string, number>();
  const shadowCounts = new Map<string, number>();
  const breakpointCounts = new Map<string, number>();

  for (const { key, css } of cssBlocks(fileSet)) {
    let m: RegExpExecArray | null;

    HEX_COLOR_RE.lastIndex = 0;
    while ((m = HEX_COLOR_RE.exec(css))) {
      const v = (m[0] as string).toLowerCase();
      if (!colorSources.has(v)) colorSources.set(v, new Set());
      colorSources.get(v)!.add(key);
    }
    RGB_COLOR_RE.lastIndex = 0;
    while ((m = RGB_COLOR_RE.exec(css))) {
      const v = m[0] as string;
      if (/var\(/i.test(v)) continue; // rgb(var(--x)) is a token reference, not a colour
      if (!colorSources.has(v)) colorSources.set(v, new Set());
      colorSources.get(v)!.add(key);
    }
    HSL_COLOR_RE.lastIndex = 0;
    while ((m = HSL_COLOR_RE.exec(css))) {
      const v = m[0] as string;
      if (/var\(/i.test(v)) continue;
      if (!colorSources.has(v)) colorSources.set(v, new Set());
      colorSources.get(v)!.add(key);
    }
    CUSTOM_PROP_RE.lastIndex = 0;
    while ((m = CUSTOM_PROP_RE.exec(css))) {
      const val = (m[2] as string).trim();
      if ((/^#(?:[0-9a-f]{3,8})$/i.test(val) || /^rgba?\(/i.test(val) || /^hsla?\(/i.test(val)) && !/var\(/i.test(val)) {
        if (!colorSources.has(val)) colorSources.set(val, new Set());
        colorSources.get(val)!.add(`${key} (${m[1]})`);
      }
    }

    FONT_FAMILY_RE.lastIndex = 0;
    while ((m = FONT_FAMILY_RE.exec(css))) {
      const first = (m[1] as string).split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
      if (first) fontFamilies.add(first);
    }

    SPACING_VALUE_RE.lastIndex = 0;
    while ((m = SPACING_VALUE_RE.exec(css))) {
      const val = m[2] as string;
      UNIT_VALUE_RE.lastIndex = 0;
      let um: RegExpExecArray | null;
      while ((um = UNIT_VALUE_RE.exec(val))) bump(spacingCounts, `${um[1]}${um[2]}`);
    }

    RADIUS_VALUE_RE.lastIndex = 0;
    while ((m = RADIUS_VALUE_RE.exec(css))) bump(radiusCounts, (m[1] as string).trim());

    SHADOW_VALUE_RE.lastIndex = 0;
    while ((m = SHADOW_VALUE_RE.exec(css))) bump(shadowCounts, (m[1] as string).trim());

    MEDIA_WIDTH_RE.lastIndex = 0;
    while ((m = MEDIA_WIDTH_RE.exec(css))) bump(breakpointCounts, `${m[1]}${m[2]}`);

    // font-size / line-height, scanned loosely across declarations
    const declRe = /(font-size|line-height)\s*:\s*([^;]+);/gi;
    let dm: RegExpExecArray | null;
    while ((dm = declRe.exec(css))) {
      const target = dm[1]?.toLowerCase() === "font-size" ? sizeCounts : lineHeightCounts;
      bump(target, (dm[2] as string).trim());
    }
  }

  const colors: ColorToken[] = [...colorSources.entries()].map(([value, sources]) => ({
    value,
    sources: [...sources],
  }));

  return {
    colors,
    typography: {
      fontFamilies: [...fontFamilies],
      sizes: [...sizeCounts.entries()].map(([value, count]) => ({ value, count })),
      lineHeights: [...lineHeightCounts.entries()].map(([value, count]) => ({ value, count })),
    },
    spacing: [...spacingCounts.entries()].map(([value, count]) => ({ value, count })),
    radii: [...radiusCounts.entries()].map(([value, count]) => ({ value, count })),
    shadows: [...shadowCounts.entries()].map(([value, count]) => ({ value, count })),
    breakpoints: [...breakpointCounts.entries()].map(([value, count]) => ({ value, count })),
  };
}

const ON_SCALE_PX = new Set([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128]);

function isOffScalePx(value: string): boolean {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (!m) return false;
  const n = Math.abs(Number(m[1]));
  return !ON_SCALE_PX.has(n);
}

/** Basic, deterministic consistency checks over extracted tokens. No visual/AI judgement. */
export function consistencyBasic(tokens: DesignTokens): Finding[] {
  const findings: Finding[] = [];
  let n = 0;
  const nextId = (cat: string) => `design_tokens:${cat}:${++n}`;

  const greys = tokens.colors.filter((c) => {
    const v = c.value.toLowerCase();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
    if (!hex) return /^rgba?\(\s*(\d+)\s*,\s*\1\s*,\s*\1/i.test(v);
    const h = hex[1] as string;
    const full = h.length === 3 ? h.split("").map((c2) => c2 + c2).join("") : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && Math.abs(r - b) < 8;
  });
  if (greys.length > 6) {
    findings.push({
      id: nextId("greys"),
      severity: "LOW",
      category: "design_tokens",
      title: "Too many distinct grey tones",
      detail: `Found ${greys.length} distinct grey-ish colors (${greys.slice(0, 10).map((g) => g.value).join(", ")}${greys.length > 10 ? ", ..." : ""}). Consider consolidating to a smaller grey scale.`,
      evidence: [],
      confidence: 0.6,
    });
  }

  const offScale = tokens.spacing.filter((s) => isOffScalePx(s.value));
  if (offScale.length > 0) {
    findings.push({
      id: nextId("spacing"),
      severity: "OPPORTUNITY",
      category: "design_tokens",
      title: "Off-scale spacing values",
      detail: `${offScale.length} spacing value(s) don't fall on a common 4/8px scale: ${offScale.map((s) => s.value).join(", ")}.`,
      evidence: [],
      confidence: 0.5,
    });
  }

  if (tokens.typography.fontFamilies.length > 3) {
    findings.push({
      id: nextId("fonts"),
      severity: "LOW",
      category: "design_tokens",
      title: "Many font families in use",
      detail: `${tokens.typography.fontFamilies.length} distinct font families found: ${tokens.typography.fontFamilies.join(", ")}.`,
      evidence: [],
      confidence: 0.6,
    });
  }

  if (tokens.colors.length > 20) {
    findings.push({
      id: nextId("palette"),
      severity: "OPPORTUNITY",
      category: "design_tokens",
      title: "Large color palette",
      detail: `${tokens.colors.length} distinct colors found across settings and CSS. A tighter palette usually reads as more intentional.`,
      evidence: [],
      confidence: 0.4,
    });
  }

  return findings;
}
