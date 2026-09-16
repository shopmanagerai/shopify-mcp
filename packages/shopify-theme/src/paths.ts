/**
 * Theme file path sandbox (threat model T2; docs/THEME_ACCESS_STRATEGY.md §4.4).
 * Only a fixed set of top-level directories is writable/readable, filenames
 * are restricted to a conservative character set, traversal is rejected
 * outright, and extensions are checked per directory.
 */
import { ShopManagerAIError } from "@shopmanagerai/shared";

export const ALLOWED_TOP_LEVEL_DIRS = [
  "layout",
  "templates",
  "templates/customers",
  "sections",
  "blocks",
  "snippets",
  "assets",
  "config",
  "locales",
] as const;
export type AllowedTopLevelDir = (typeof ALLOWED_TOP_LEVEL_DIRS)[number];

const SEGMENT_RE = /^[A-Za-z0-9_\-.]+$/;
const MAX_LENGTH = 200;

/** Compound extensions checked before the simple single-extension fallback. */
const COMPOUND_EXTENSIONS = ["scss.liquid", "js.liquid", "css.liquid"];
const SIMPLE_EXTENSIONS = [
  "liquid",
  "json",
  "js",
  "css",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "ico",
  "map",
  "txt",
];
const ALL_EXTENSIONS = new Set([...COMPOUND_EXTENSIONS, ...SIMPLE_EXTENSIONS]);

/** Allowed extensions per top-level directory. Directories not listed fall back to ALL_EXTENSIONS. */
const DIR_EXTENSIONS: Partial<Record<AllowedTopLevelDir, string[]>> = {
  layout: ["liquid"],
  templates: ["liquid", "json"],
  "templates/customers": ["liquid", "json"],
  sections: ["liquid", "json"], // .json = Online Store 2.0 section groups (header-group.json, footer-group.json)
  blocks: ["liquid"],
  snippets: ["liquid"],
  assets: SIMPLE_EXTENSIONS.filter((e) => e !== "json").concat(COMPOUND_EXTENSIONS),
  config: ["json"],
  locales: ["json"],
};

function invalid(key: string, reason: string): never {
  throw new ShopManagerAIError("INVALID_PATH", `Invalid theme file path "${key}": ${reason}.`, {
    retryable: false,
    details: { key, reason },
  });
}

function matchExtension(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  for (const ext of COMPOUND_EXTENSIONS) {
    if (lower.endsWith(`.${ext}`)) return ext;
  }
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return undefined;
  return filename.slice(dotIndex + 1).toLowerCase();
}

function topLevelDirFor(key: string): AllowedTopLevelDir | undefined {
  // Check the two-segment dir first (templates/customers) before the single-segment one.
  const parts = key.split("/");
  const twoSegment = parts.slice(0, 2).join("/");
  if ((ALLOWED_TOP_LEVEL_DIRS as readonly string[]).includes(twoSegment) && parts.length > 2) {
    return twoSegment as AllowedTopLevelDir;
  }
  const first = parts[0]!;
  if ((ALLOWED_TOP_LEVEL_DIRS as readonly string[]).includes(first)) {
    return first as AllowedTopLevelDir;
  }
  return undefined;
}

/**
 * Validates a theme file key. Throws `INVALID_PATH` (ShopManagerAIError) on
 * any violation. Returns the validated key unchanged on success.
 */
export function validateThemeKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) invalid(String(key), "must be a non-empty string");
  if (key.length > MAX_LENGTH) invalid(key, `exceeds max length of ${MAX_LENGTH}`);
  if (key.includes("\0")) invalid(key, "contains a null byte");
  if (key.includes("\\")) invalid(key, "must not contain a backslash");
  if (key.startsWith("/")) invalid(key, "must not start with a leading slash");
  if (key.includes("..")) invalid(key, "must not contain path traversal (..)");

  const segments = key.split("/");
  if (segments.some((s) => s.length === 0)) invalid(key, "must not contain empty path segments (e.g. double slashes)");
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg)) invalid(key, `segment "${seg}" contains disallowed characters`);
  }
  if (segments.length < 2) invalid(key, "must include a top-level directory and a filename");

  const dir = topLevelDirFor(key);
  if (!dir) invalid(key, `top-level directory not allowed (must be one of: ${ALLOWED_TOP_LEVEL_DIRS.join(", ")})`);

  const filename = segments[segments.length - 1]!;
  const ext = matchExtension(filename);
  if (!ext || !ALL_EXTENSIONS.has(ext)) invalid(key, `disallowed file extension "${ext ?? ""}"`);

  const allowedForDir = DIR_EXTENSIONS[dir];
  if (allowedForDir && !allowedForDir.includes(ext)) {
    invalid(key, `extension "${ext}" is not allowed under "${dir}"`);
  }

  return key;
}

export function isValidThemeKey(key: string): boolean {
  try {
    validateThemeKey(key);
    return true;
  } catch {
    return false;
  }
}
