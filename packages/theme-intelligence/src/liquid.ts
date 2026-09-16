/**
 * Liquid inspection built on @shopify/liquid-html-parser. Pure, static, no I/O.
 *
 * Threat T1 (prompt injection via store content): comments extracted from
 * {% comment %}/{% # %} tags are returned as `untrustedComments` so callers
 * must wrap them as untrusted_content and never merge them into prompts.
 */
import { parseThemeJson } from "@shopmanagerai/shared";
import {
  toLiquidHtmlAST,
  walk,
  LiquidHTMLASTParsingError,
  type LiquidHtmlNode,
  type DocumentNode,
} from "@shopify/liquid-html-parser";

export interface ParseIssue {
  message: string;
  line: number;
  col: number;
}

export interface RenderRef {
  target: string;
  kind: "render" | "include";
  line: number;
  dynamic?: boolean;
  withVariable?: string;
  alias?: string;
}

export interface SimpleRef {
  target: string;
  line: number;
  dynamic?: boolean;
}

export interface AssetRef {
  name: string;
  filter: "asset_url" | "asset_img_url";
  line: number;
  dynamic?: boolean;
}

export interface SchemaInfo {
  raw: string;
  json: unknown | null;
  errors: ParseIssue[];
  line: number;
}

export interface UntrustedComment {
  text: string;
  line: number;
}

export interface LiquidInspection {
  key: string;
  errors: ParseIssue[];
  renders: RenderRef[];
  sections: SimpleRef[];
  sectionGroups: SimpleRef[];
  contentFor: SimpleRef[];
  assetReferences: AssetRef[];
  schema: SchemaInfo | null;
  hasJavascript: boolean;
  hasStylesheet: boolean;
  variablesReferenced: string[];
  tagsUsed: string[];
  filtersUsed: string[];
  maxNestingDepth: number;
  lineCount: number;
  untrustedComments: UntrustedComment[];
}

/** Convert a 0-indexed character offset into a 1-indexed {line, col}. */
export function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < clamped; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  const col = clamped - lastNewline;
  return { line, col };
}

function isStringLiteral(node: unknown): node is { type: "String"; value: string } {
  return !!node && typeof node === "object" && (node as any).type === "String";
}

function textOf(source: string, position: { start: number; end: number } | undefined): string {
  if (!position) return "";
  return source.slice(position.start, position.end);
}

function maxChildDepth(node: any, depth: number): number {
  let best = depth;
  const children: any[] | undefined = node?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      best = Math.max(best, maxChildDepth(child, depth + 1));
    }
  }
  // {% liquid %} tags hold a flat statement list in `markup` rather than `children`.
  if (Array.isArray(node?.markup)) {
    for (const stmt of node.markup) {
      best = Math.max(best, maxChildDepth(stmt, depth + 1));
    }
  }
  return best;
}

/** Parse and inspect a single Liquid file. Never throws. */
export function inspectLiquid(key: string, content: string): LiquidInspection {
  const result: LiquidInspection = {
    key,
    errors: [],
    renders: [],
    sections: [],
    sectionGroups: [],
    contentFor: [],
    assetReferences: [],
    schema: null,
    hasJavascript: false,
    hasStylesheet: false,
    variablesReferenced: [],
    tagsUsed: [],
    filtersUsed: [],
    maxNestingDepth: 0,
    lineCount: content.length === 0 ? 0 : content.split("\n").length,
    untrustedComments: [],
  };

  let ast: DocumentNode | null = null;
  try {
    ast = toLiquidHtmlAST(content, { allowUnclosedDocumentNode: true, mode: "tolerant" });
  } catch (err) {
    if (err instanceof LiquidHTMLASTParsingError) {
      result.errors.push({
        message: err.message,
        line: err.loc?.start.line ?? 0,
        col: err.loc?.start.column ?? 0,
      });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ message, line: 0, col: 0 });
    }
    return result;
  }

  const variables = new Set<string>();
  const tags = new Set<string>();
  const filters = new Set<string>();

  walk(ast, (node: any) => {
    switch (node.type) {
      case "LiquidErrorNode": {
        const { line, col } = offsetToLineCol(content, node.position?.start ?? 0);
        result.errors.push({ message: node.message ?? "Liquid parse error", line, col });
        break;
      }
      case "VariableLookup": {
        if (node.name) variables.add(node.name);
        break;
      }
      case "LiquidFilter": {
        if (node.name) filters.add(node.name);
        if (node.name === "asset_url" || node.name === "asset_img_url") {
          // The filtered expression lives on the parent LiquidVariable; we don't have
          // a direct parent pointer here, so asset extraction is done in a second pass below.
        }
        break;
      }
      case "LiquidRawTag": {
        tags.add(node.name);
        const { line } = offsetToLineCol(content, node.position?.start ?? 0);
        if (node.name === "comment" || node.name === "doc") {
          result.untrustedComments.push({ text: node.body?.value ?? "", line });
        }
        if (node.name === "schema") {
          const raw = node.body?.value ?? "";
          const errors: ParseIssue[] = [];
          let json: unknown | null = null;
          try {
            json = raw.trim() === "" ? {} : parseThemeJson(raw);
          } catch (err) {
            errors.push({ message: err instanceof Error ? err.message : String(err), line, col: 0 });
          }
          result.schema = { raw, json, errors, line };
        }
        if (node.name === "javascript") result.hasJavascript = true;
        if (node.name === "stylesheet" || node.name === "style") result.hasStylesheet = true;
        break;
      }
      case "LiquidTag": {
        tags.add(node.name);
        const { line } = offsetToLineCol(content, node.position?.start ?? 0);
        if (node.name === "#") {
          result.untrustedComments.push({ text: typeof node.markup === "string" ? node.markup : "", line });
        }
        if (node.name === "render" || node.name === "include") {
          const kind: "render" | "include" = node.name;
          const markup = node.markup;
          if (markup && typeof markup === "object" && "snippet" in markup) {
            const snippet = markup.snippet;
            if (isStringLiteral(snippet)) {
              const ref: RenderRef = { target: snippet.value, kind, line };
              if (markup.variable?.name) {
                ref.withVariable = isStringLiteral(markup.variable.name)
                  ? markup.variable.name.value
                  : textOf(content, markup.variable.name.position);
              }
              if (markup.alias?.value) ref.alias = markup.alias.value;
              result.renders.push(ref);
            } else {
              result.renders.push({ target: textOf(content, snippet.position), kind, line, dynamic: true });
            }
          } else if (typeof markup === "string") {
            const m = markup.match(/^\s*['"]([^'"]+)['"]/);
            result.renders.push(
              m ? { target: m[1] as string, kind, line } : { target: markup.trim(), kind, line, dynamic: true },
            );
          }
        }
        if (node.name === "section") {
          const markup = node.markup;
          if (markup && typeof markup === "object" && "name" in markup) {
            if (isStringLiteral(markup.name)) {
              result.sections.push({ target: markup.name.value, line });
            } else {
              result.sections.push({ target: textOf(content, markup.name?.position), line, dynamic: true });
            }
          } else if (typeof markup === "string") {
            const m = markup.match(/^\s*['"]([^'"]+)['"]/);
            if (m) result.sections.push({ target: m[1] as string, line });
          }
        }
        if (node.name === "sections") {
          const markup = node.markup;
          if (isStringLiteral(markup)) {
            result.sectionGroups.push({ target: markup.value, line });
          } else if (typeof markup === "string") {
            const m = markup.match(/^\s*['"]([^'"]+)['"]/);
            if (m) result.sectionGroups.push({ target: m[1] as string, line });
          }
        }
        if (node.name === "content_for") {
          const markup = node.markup;
          if (markup && typeof markup === "object" && "contentForType" in markup) {
            if (isStringLiteral(markup.contentForType)) {
              result.contentFor.push({ target: markup.contentForType.value, line });
            }
          }
        }
        break;
      }
      case "LiquidVariableOutput":
        break;
      default:
        break;
    }
  });

  // Second pass: asset_url/asset_img_url filters need the LiquidVariable parent
  // (the expression being filtered), which `walk`'s per-node callback doesn't hand us.
  walk(ast, (node: any) => {
    if (node.type === "LiquidVariable" && Array.isArray(node.filters)) {
      for (const filter of node.filters) {
        if (filter.name === "asset_url" || filter.name === "asset_img_url") {
          const { line } = offsetToLineCol(content, node.position?.start ?? 0);
          if (isStringLiteral(node.expression)) {
            result.assetReferences.push({ name: node.expression.value, filter: filter.name, line });
          } else {
            result.assetReferences.push({
              name: textOf(content, node.expression?.position),
              filter: filter.name,
              line,
              dynamic: true,
            });
          }
        }
      }
    }
  });

  result.variablesReferenced = [...variables].sort();
  result.tagsUsed = [...tags].sort();
  result.filtersUsed = [...filters].sort();
  result.maxNestingDepth = maxChildDepth(ast, 0);

  return result;
}
