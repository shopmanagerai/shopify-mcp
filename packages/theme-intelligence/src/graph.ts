/**
 * Dependency graph over theme files (docs/STORE_DIGITAL_TWIN.md §2). Built
 * from architecture (JSON structure) plus Liquid inspection (render/section/
 * sections/asset/content_for references). Pure, synchronous.
 */
import type { ThemeFileSet } from "./fileset.js";
import { inspectLiquid } from "./liquid.js";
import { isAppBlockType, type ThemeArchitecture } from "./architecture.js";

export type EdgeKind =
  | "render"
  | "section"
  | "sections"
  | "json_template"
  | "json_group"
  | "asset"
  | "block_type"
  | "content_for";

export interface GraphNode {
  id: string;
  kind: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  via: EdgeKind;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  referencesOf(key: string): string[];
  referencedBy(key: string): string[];
  unusedFiles(): string[];
  orphanReferences(): GraphEdge[];
  focusedExcerpt(rootKey: string, depth: number): string[];
}

function snippetKey(name: string): string {
  return name.includes("/") || name.endsWith(".liquid") ? name : `snippets/${name}.liquid`;
}
function sectionKey(name: string): string {
  return name.includes("/") || name.endsWith(".liquid") ? name : `sections/${name}.liquid`;
}
function sectionGroupKey(name: string): string {
  return name.includes("/") || name.endsWith(".json") ? name : `sections/${name}.json`;
}
function blockKey(type: string): string {
  return type.includes("/") || type.endsWith(".liquid") ? type : `blocks/${type}.liquid`;
}
function assetKey(name: string): string {
  return name.includes("/") ? name : `assets/${name}`;
}
function contentForNodeId(type: string): string {
  return `content_for:${type}`;
}

export function buildDependencyGraph(fileSet: ThemeFileSet, architecture: ThemeArchitecture): DependencyGraph {
  const nodes: GraphNode[] = fileSet.all().map((f) => ({ id: f.key, kind: fileSet.role(f.key) }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];

  const addEdge = (from: string, to: string, via: EdgeKind) => {
    edges.push({ from, to, via });
  };

  // Liquid-derived edges: render, section, sections, asset, content_for.
  const liquidRoles = new Set(["layout", "template_liquid", "section", "block", "snippet"]);
  for (const f of fileSet.all()) {
    if (!liquidRoles.has(fileSet.role(f.key))) continue;
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    const insp = inspectLiquid(f.key, text);
    for (const r of insp.renders) {
      if (r.dynamic) continue;
      addEdge(f.key, snippetKey(r.target), "render");
    }
    for (const s of insp.sections) {
      if (s.dynamic) continue;
      addEdge(f.key, sectionKey(s.target), "section");
    }
    for (const g of insp.sectionGroups) {
      if (g.dynamic) continue;
      addEdge(f.key, sectionGroupKey(g.target), "sections");
    }
    for (const a of insp.assetReferences) {
      if (a.dynamic) continue;
      addEdge(f.key, assetKey(a.name), "asset");
    }
    for (const c of insp.contentFor) {
      const to = contentForNodeId(c.target);
      if (!nodeIds.has(to)) nodes.push({ id: to, kind: "content_for_slot" });
      nodeIds.add(to);
      addEdge(f.key, to, "content_for");
    }
  }

  // JSON-derived edges: json_template, json_group, block_type.
  for (const t of architecture.templates) {
    if (t.kind !== "json") continue;
    for (const s of t.sections) {
      if (!s.type || isAppBlockType(s.type)) continue;
      addEdge(t.key, sectionKey(s.type), "json_template");
    }
  }
  for (const g of architecture.sectionGroups) {
    for (const s of g.sections) {
      if (!s.type || isAppBlockType(s.type)) continue;
      addEdge(g.key, sectionKey(s.type), "json_group");
    }
  }
  for (const s of architecture.sections) {
    for (const type of s.blockTypes) {
      if (type === "@app" || isAppBlockType(type)) continue;
      addEdge(s.key, blockKey(type), "block_type");
    }
  }

  const referencesOf = (key: string): string[] => edges.filter((e) => e.from === key).map((e) => e.to);
  const referencedBy = (key: string): string[] => edges.filter((e) => e.to === key).map((e) => e.from);

  const roots = [
    ...architecture.layouts,
    ...architecture.templates.map((t) => t.key),
  ];

  const reachable = (): Set<string> => {
    const seen = new Set<string>(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const to of referencesOf(cur)) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  };

  const unusedFiles = (): string[] => {
    const reach = reachable();
    const unusedRoles = new Set(["snippet", "section", "block", "asset"]);
    return fileSet
      .all()
      .filter((f) => unusedRoles.has(fileSet.role(f.key)) && !reach.has(f.key))
      .map((f) => f.key);
  };

  const orphanReferences = (): GraphEdge[] =>
    edges.filter((e) => !e.to.startsWith("content_for:") && !isAppBlockType(e.to) && !fileSet.has(e.to));

  const focusedExcerpt = (rootKey: string, depth: number): string[] => {
    const seen = new Set<string>([rootKey]);
    let frontier = [rootKey];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const key of frontier) {
        for (const to of referencesOf(key)) {
          if (!seen.has(to)) {
            seen.add(to);
            next.push(to);
          }
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return [...seen];
  };

  return { nodes, edges, referencesOf, referencedBy, unusedFiles, orphanReferences, focusedExcerpt };
}
