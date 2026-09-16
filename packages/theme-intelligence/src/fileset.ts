/**
 * ThemeFileSet: an in-memory, read-only index over a theme's ThemeFile[].
 * Pure, synchronous, no I/O, everything downstream (architecture, graph,
 * search, tokens, seo, conflicts) is built on top of this.
 */
import type { ThemeFile } from "@shopmanagerai/shared";

export type FileRole =
  | "layout"
  | "template_json"
  | "template_liquid"
  | "section"
  | "section_group"
  | "block"
  | "snippet"
  | "asset"
  | "config"
  | "locale"
  | "other";

/** Normalize a theme file key: forward slashes, no leading slash. */
export function normalizeKey(key: string): string {
  return key.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function roleOf(key: string): FileRole {
  const k = normalizeKey(key);
  if (k.startsWith("layout/")) return "layout";
  if (k.startsWith("templates/") && k.endsWith(".json")) return "template_json";
  if (k.startsWith("templates/") && k.endsWith(".liquid")) return "template_liquid";
  if (k.startsWith("sections/") && k.endsWith(".json")) return "section_group";
  if (k.startsWith("sections/") && k.endsWith(".liquid")) return "section";
  if (k.startsWith("blocks/") && k.endsWith(".liquid")) return "block";
  if (k.startsWith("snippets/")) return "snippet";
  if (k.startsWith("assets/")) return "asset";
  if (k.startsWith("config/")) return "config";
  if (k.startsWith("locales/")) return "locale";
  return "other";
}

const BINARY_CONTENT_TYPE_RE = /^(image|font|video|audio)\//i;

export class ThemeFileSet {
  private readonly filesByKey: Map<string, ThemeFile>;

  constructor(files: ThemeFile[]) {
    this.filesByKey = new Map();
    for (const f of files) {
      this.filesByKey.set(normalizeKey(f.key), { ...f, key: normalizeKey(f.key) });
    }
  }

  get size(): number {
    return this.filesByKey.size;
  }

  keys(): string[] {
    return [...this.filesByKey.keys()];
  }

  all(): ThemeFile[] {
    return [...this.filesByKey.values()];
  }

  has(key: string): boolean {
    return this.filesByKey.has(normalizeKey(key));
  }

  get(key: string): ThemeFile | undefined {
    return this.filesByKey.get(normalizeKey(key));
  }

  role(key: string): FileRole {
    return roleOf(key);
  }

  byDir(dir: string): ThemeFile[] {
    const prefix = normalizeKey(dir).replace(/\/$/, "") + "/";
    return this.all().filter((f) => f.key.startsWith(prefix));
  }

  byRole(role: FileRole): ThemeFile[] {
    return this.all().filter((f) => roleOf(f.key) === role);
  }

  isBinary(key: string): boolean {
    const f = this.get(key);
    if (!f) return false;
    if (f.content !== undefined) return false;
    if (f.contentBase64 !== undefined) return true;
    if (f.contentType && BINARY_CONTENT_TYPE_RE.test(f.contentType)) return true;
    return false;
  }

  /** Text content of a file, or undefined for binary/missing files. */
  text(key: string): string | undefined {
    const f = this.get(key);
    if (!f) return undefined;
    if (this.isBinary(key)) return undefined;
    return f.content;
  }

  countsByRole(): Record<FileRole, number> {
    const out: Record<FileRole, number> = {
      layout: 0,
      template_json: 0,
      template_liquid: 0,
      section: 0,
      section_group: 0,
      block: 0,
      snippet: 0,
      asset: 0,
      config: 0,
      locale: 0,
      other: 0,
    };
    for (const f of this.all()) out[roleOf(f.key)]++;
    return out;
  }
}
