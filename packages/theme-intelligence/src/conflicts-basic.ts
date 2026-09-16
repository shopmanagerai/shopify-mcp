/**
 * Static conflict/quality detectors: duplicate script includes, duplicate
 * schema ids, global CSS rules inside section-scoped style blocks, orphan
 * references (via the dependency graph), inline script count, !important
 * density. Pure, synchronous.
 */
import type { Finding } from "@shopmanagerai/shared";
import type { ThemeFileSet } from "./fileset.js";
import { inspectLiquid } from "./liquid.js";
import type { DependencyGraph } from "./graph.js";

let counter = 0;
function nextId(cat: string): string {
  return `conflicts:${cat}:${++counter}`;
}

function liquidishFiles(fileSet: ThemeFileSet): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  for (const f of fileSet.all()) {
    if (!f.key.endsWith(".liquid")) continue;
    const text = fileSet.text(f.key);
    if (text !== undefined) out.push({ key: f.key, text });
  }
  return out;
}

/** Same asset or same external <script src> included more than once across layout+sections. */
export function findDuplicateScriptIncludes(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  const sources = new Map<string, string[]>();
  const roles = new Set(["layout", "section", "snippet", "block"]);

  for (const f of fileSet.all()) {
    if (!roles.has(fileSet.role(f.key))) continue;
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    const scriptSrcRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptSrcRe.exec(text))) {
      const src = m[1] as string;
      if (!sources.has(src)) sources.set(src, []);
      sources.get(src)!.push(f.key);
    }
    const insp = inspectLiquid(f.key, text);
    for (const a of insp.assetReferences) {
      if (!a.name.endsWith(".js")) continue;
      if (!sources.has(a.name)) sources.set(a.name, []);
      sources.get(a.name)!.push(f.key);
    }
  }

  for (const [src, files] of sources) {
    if (files.length > 1) {
      findings.push({
        id: nextId("dup_script"),
        severity: "LOW",
        category: "conflicts_scripts",
        title: "Script included more than once",
        detail: `"${src}" is included in ${files.length} places: ${files.join(", ")}.`,
        evidence: [],
        confidence: 0.6,
      });
    }
  }
  return findings;
}

/** Duplicate setting ids within a single section/block schema. */
export function findDuplicateSchemaIds(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  for (const f of [...fileSet.byRole("section"), ...fileSet.byRole("block")]) {
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    const insp = inspectLiquid(f.key, text);
    const settings = (insp.schema?.json as any)?.settings;
    if (!Array.isArray(settings)) continue;
    const seen = new Map<string, number>();
    for (const s of settings) {
      if (typeof s?.id !== "string") continue;
      seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    }
    for (const [id, count] of seen) {
      if (count > 1) {
        findings.push({
          id: nextId("dup_schema_id"),
          severity: "HIGH",
          category: "conflicts_schema",
          title: "Duplicate setting id in schema",
          detail: `Setting id "${id}" appears ${count} times in the {% schema %} of ${f.key}.`,
          evidence: [],
          confidence: 0.95,
          location: { file: f.key, line: insp.schema?.line },
        });
      }
    }
  }
  return findings;
}

/** `* {`, `body {`, `html {` inside {% stylesheet %}/{% style %} blocks (leaks past section scope). */
export function findGlobalCssInScopedStyles(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  const styleTagRe = /\{%-?\s*(style|stylesheet)\s*-?%\}([\s\S]*?)\{%-?\s*end(?:style|stylesheet)\s*-?%\}/g;
  const globalRuleRe = /(^|\})\s*(\*|body|html)\s*\{/gm;

  for (const f of [...fileSet.byRole("section"), ...fileSet.byRole("block")]) {
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    let m: RegExpExecArray | null;
    styleTagRe.lastIndex = 0;
    while ((m = styleTagRe.exec(text))) {
      const css = m[2] as string;
      globalRuleRe.lastIndex = 0;
      let gm: RegExpExecArray | null;
      while ((gm = globalRuleRe.exec(css))) {
        findings.push({
          id: nextId("global_css"),
          severity: "MEDIUM",
          category: "conflicts_css",
          title: "Global CSS selector inside section-scoped style block",
          detail: `Selector "${(gm[2] as string)}" in a {% ${m[1]} %} block of ${f.key} affects the whole page, not just this section.`,
          evidence: [],
          confidence: 0.7,
          location: { file: f.key },
        });
      }
    }
  }
  return findings;
}

/** Reuses the dependency graph's orphan detection, reformatted as Findings. */
export function findOrphanReferences(graph: DependencyGraph): Finding[] {
  return graph.orphanReferences().map((e) => ({
    id: nextId("orphan"),
    severity: "MEDIUM" as const,
    category: "conflicts_orphan",
    title: "Reference to a missing file",
    detail: `${e.from} references "${e.to}" via ${e.via}, but no such file exists in the theme.`,
    evidence: [],
    confidence: 0.85,
    location: { file: e.from },
  }));
}

/** Count of <script> tags with no src attribute (inline). */
export function countInlineScripts(fileSet: ThemeFileSet): number {
  let count = 0;
  for (const { text } of liquidishFiles(fileSet)) {
    const re = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi;
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

/** `!important` occurrences per 100 lines of CSS-ish content (assets/*.css + scoped style blocks). */
export function importantDensity(fileSet: ThemeFileSet): { total: number; perHundredLines: number } {
  let total = 0;
  let lines = 0;
  for (const f of fileSet.byRole("asset")) {
    if (!f.key.endsWith(".css")) continue;
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    total += (text.match(/!important/gi) ?? []).length;
    lines += text.split("\n").length;
  }
  const styleTagRe = /\{%-?\s*(?:style|stylesheet)\s*-?%\}([\s\S]*?)\{%-?\s*end(?:style|stylesheet)\s*-?%\}/g;
  for (const { text } of liquidishFiles(fileSet)) {
    let m: RegExpExecArray | null;
    styleTagRe.lastIndex = 0;
    while ((m = styleTagRe.exec(text))) {
      const css = m[1] as string;
      total += (css.match(/!important/gi) ?? []).length;
      lines += css.split("\n").length;
    }
  }
  return { total, perHundredLines: lines === 0 ? 0 : Math.round((total / lines) * 10000) / 100 };
}

export function conflictsBasic(fileSet: ThemeFileSet, graph: DependencyGraph): Finding[] {
  const findings: Finding[] = [
    ...findDuplicateScriptIncludes(fileSet),
    ...findDuplicateSchemaIds(fileSet),
    ...findGlobalCssInScopedStyles(fileSet),
    ...findOrphanReferences(graph),
  ];

  const inlineScripts = countInlineScripts(fileSet);
  if (inlineScripts > 5) {
    findings.push({
      id: nextId("inline_scripts"),
      severity: "OPPORTUNITY",
      category: "conflicts_scripts",
      title: "Many inline <script> blocks",
      detail: `${inlineScripts} inline <script> blocks (no src) found across the theme. Consider consolidating into assets for cacheability.`,
      evidence: [],
      confidence: 0.4,
    });
  }

  const density = importantDensity(fileSet);
  if (density.total > 10) {
    findings.push({
      id: nextId("important_density"),
      severity: "OPPORTUNITY",
      category: "conflicts_css",
      title: "High !important usage",
      detail: `${density.total} !important declarations (${density.perHundredLines} per 100 lines). Often a sign of specificity conflicts, possibly with app-injected CSS.`,
      evidence: [],
      confidence: 0.4,
    });
  }

  return findings;
}
