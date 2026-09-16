/**
 * Static text search over a theme's files. Pure, synchronous, context-budget
 * aware (maxResults caps output, see threat model T9, oversized responses).
 */
import type { ThemeFileSet } from "./fileset.js";

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
  context?: { before: string[]; after: string[] };
}

export interface SearchOptions {
  query: string;
  regex?: boolean;
  dirs?: string[];
  maxResults?: number;
  contextLines?: number;
  caseSensitive?: boolean;
}

export function searchFiles(fileSet: ThemeFileSet, opts: SearchOptions): SearchMatch[] {
  const maxResults = opts.maxResults ?? 100;
  const contextLines = opts.contextLines ?? 0;
  const dirs = opts.dirs?.map((d) => d.replace(/\/$/, "") + "/");

  let matcher: (line: string) => boolean;
  if (opts.regex) {
    const re = new RegExp(opts.query, opts.caseSensitive ? "" : "i");
    matcher = (line) => re.test(line);
  } else {
    const needle = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
    matcher = (line) => (opts.caseSensitive ? line : line.toLowerCase()).includes(needle);
  }

  const results: SearchMatch[] = [];
  for (const f of fileSet.all()) {
    if (results.length >= maxResults) break;
    if (dirs && !dirs.some((d) => f.key.startsWith(d))) continue;
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break;
      const line = lines[i] as string;
      if (!matcher(line)) continue;
      const match: SearchMatch = { file: f.key, line: i + 1, text: line };
      if (contextLines > 0) {
        match.context = {
          before: lines.slice(Math.max(0, i - contextLines), i),
          after: lines.slice(i + 1, i + 1 + contextLines),
        };
      }
      results.push(match);
    }
  }
  return results;
}

export interface SymbolMatch extends SearchMatch {
  kind: "settings_id" | "section_type" | "snippet_name" | "css_class" | "js_id" | "text";
}

/** Best-effort search for a symbol as a settings id, section/snippet name, CSS class, or JS id. */
export function findReference(fileSet: ThemeFileSet, symbol: string): SymbolMatch[] {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: Array<{ kind: SymbolMatch["kind"]; re: RegExp }> = [
    { kind: "settings_id", re: new RegExp(`"id"\\s*:\\s*"${escaped}"`) },
    { kind: "section_type", re: new RegExp(`"type"\\s*:\\s*"${escaped}"`) },
    { kind: "snippet_name", re: new RegExp(`(render|include)\\s+['"]${escaped}['"]`) },
    { kind: "css_class", re: new RegExp(`\\.${escaped}(?![\\w-])`) },
    { kind: "js_id", re: new RegExp(`(#${escaped}(?![\\w-])|id=["']${escaped}["'])`) },
  ];

  const out: SymbolMatch[] = [];
  for (const f of fileSet.all()) {
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      for (const p of patterns) {
        if (p.re.test(line)) {
          out.push({ file: f.key, line: i + 1, text: line, kind: p.kind });
        }
      }
    }
  }
  return out;
}
