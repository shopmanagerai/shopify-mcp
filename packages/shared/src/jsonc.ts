/**
 * Shopify theme JSON (templates/*.json, sections/*.json, config/*.json) may start with
 * a `/* … *\/` licence/comment block (Dawn does) and may contain `//` line comments.
 * `JSON.parse` rejects those, so every theme-JSON read goes through this parser,
 * which strips comments outside string literals and then parses strictly.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i + 2);
      i = end === -1 ? text.length : end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Parses theme JSON, tolerating comments. Throws the underlying SyntaxError for genuinely invalid JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseThemeJson<T = any>(text: string): T {
  const trimmed = text.replace(/^\uFEFF/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return JSON.parse(stripJsonComments(trimmed)) as T;
  }
}
