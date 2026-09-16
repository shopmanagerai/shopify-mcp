/**
 * Complexity metrics, per-file and theme-level. Pure, synchronous, no
 * external heuristics beyond simple counting, deliberately explainable.
 */
import type { ThemeFileSet } from "./fileset.js";
import { inspectLiquid } from "./liquid.js";

export interface FileComplexity {
  key: string;
  lines: number;
  tags: number;
  maxNestingDepth: number;
  loops: number;
  renders: number;
  schemaSize: number;
  parseErrors: number;
}

export interface ThemeComplexity {
  score: number;
  explanation: string[];
  files: FileComplexity[];
}

const LOOP_TAGS = new Set(["for", "tablerow"]);

export function fileComplexity(key: string, content: string): FileComplexity {
  const insp = inspectLiquid(key, content);
  const loops = insp.tagsUsed.filter((t) => LOOP_TAGS.has(t)).length;
  return {
    key,
    lines: insp.lineCount,
    tags: insp.tagsUsed.length,
    maxNestingDepth: insp.maxNestingDepth,
    loops,
    renders: insp.renders.length,
    schemaSize: insp.schema?.raw ? insp.schema.raw.length : 0,
    parseErrors: insp.errors.length,
  };
}

const LIQUID_EXT = /\.(liquid|json)$/;

/** Per-file metrics plus a theme-level score with a plain-language explanation. */
export function themeComplexity(fileSet: ThemeFileSet): ThemeComplexity {
  const files: FileComplexity[] = [];
  for (const f of fileSet.all()) {
    if (!f.key.endsWith(".liquid")) continue;
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    files.push(fileComplexity(f.key, text));
  }

  const totalLines = files.reduce((n, f) => n + f.lines, 0);
  const totalTags = files.reduce((n, f) => n + f.tags, 0);
  const maxDepth = files.reduce((n, f) => Math.max(n, f.maxNestingDepth), 0);
  const totalErrors = files.reduce((n, f) => n + f.parseErrors, 0);
  const deepFiles = files.filter((f) => f.maxNestingDepth >= 6).length;

  // Deliberately simple, explainable weighting, not a research-backed model.
  const score = Math.round(
    totalLines * 0.02 + totalTags * 0.1 + deepFiles * 5 + totalErrors * 10 + Math.max(0, maxDepth - 5) * 3,
  );

  const explanation = [
    `${files.length} liquid files, ${totalLines} total lines, ${totalTags} total tags.`,
    `Max nesting depth observed: ${maxDepth}.`,
    `${deepFiles} file(s) with nesting depth >= 6 (readability risk).`,
    `${totalErrors} liquid parse error(s) across the theme.`,
  ];

  return { score, explanation, files };
}
