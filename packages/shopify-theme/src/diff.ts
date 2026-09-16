/**
 * Diffing helpers for theme previews and rollback evidence.
 */
import { createTwoFilesPatch } from "diff";
import type { ThemeFile } from "@shopmanagerai/shared";

/** Unified diff of two strings, formatted as a standard patch. */
export function diffStrings(before: string, after: string, opts: { fileNameBefore?: string; fileNameAfter?: string } = {}): string {
  const fileNameBefore = opts.fileNameBefore ?? "before";
  const fileNameAfter = opts.fileNameAfter ?? "after";
  return createTwoFilesPatch(fileNameBefore, fileNameAfter, before, after, undefined, undefined);
}

function fileText(f: ThemeFile | undefined): string {
  if (!f) return "";
  if (f.content !== undefined) return f.content;
  if (f.contentBase64 !== undefined) return `[binary: base64, ${Buffer.from(f.contentBase64, "base64").length} bytes]`;
  return "";
}

export interface FileSetDiffEntry {
  key: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  diff?: string;
  sizeBefore?: number;
  sizeAfter?: number;
}

/** Per-file unified diff between two theme file sets, keyed by file path. */
export function diffFileSets(before: ThemeFile[], after: ThemeFile[]): FileSetDiffEntry[] {
  const beforeMap = new Map(before.map((f) => [f.key, f]));
  const afterMap = new Map(after.map((f) => [f.key, f]));
  const keys = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);

  const out: FileSetDiffEntry[] = [];
  for (const key of Array.from(keys).sort()) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    if (b && !a) {
      out.push({ key, kind: "removed", diff: diffStrings(fileText(b), "", { fileNameBefore: key, fileNameAfter: key }), sizeBefore: b.size });
      continue;
    }
    if (!b && a) {
      out.push({ key, kind: "added", diff: diffStrings("", fileText(a), { fileNameBefore: key, fileNameAfter: key }), sizeAfter: a.size });
      continue;
    }
    if (b && a) {
      const bText = fileText(b);
      const aText = fileText(a);
      if (bText === aText) {
        out.push({ key, kind: "unchanged", sizeBefore: b.size, sizeAfter: a.size });
      } else {
        out.push({ key, kind: "changed", diff: diffStrings(bText, aText, { fileNameBefore: key, fileNameAfter: key }), sizeBefore: b.size, sizeAfter: a.size });
      }
    }
  }
  return out;
}

export interface FileSetDiffSummary {
  added: Array<{ key: string; size?: number }>;
  removed: Array<{ key: string; size?: number }>;
  changed: Array<{ key: string; sizeBefore?: number; sizeAfter?: number }>;
  unchangedCount: number;
}

/** Summarizes a file-set diff into added/removed/changed with sizes. */
export function summarizeFileSetDiff(before: ThemeFile[], after: ThemeFile[]): FileSetDiffSummary {
  const entries = diffFileSets(before, after);
  const summary: FileSetDiffSummary = { added: [], removed: [], changed: [], unchangedCount: 0 };
  for (const e of entries) {
    if (e.kind === "added") summary.added.push({ key: e.key, size: e.sizeAfter });
    else if (e.kind === "removed") summary.removed.push({ key: e.key, size: e.sizeBefore });
    else if (e.kind === "changed") summary.changed.push({ key: e.key, sizeBefore: e.sizeBefore, sizeAfter: e.sizeAfter });
    else summary.unchangedCount++;
  }
  return summary;
}
