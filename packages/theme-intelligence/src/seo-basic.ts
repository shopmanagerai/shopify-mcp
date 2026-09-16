/**
 * Static, deterministic SEO auditing over theme source. This is a text-level
 * heuristic pass, NOT a rendered-DOM audit: it cannot see what Liquid actually
 * outputs at runtime (conditional branches, loops, app-injected markup), so
 * every finding here is a hint, not a guarantee, see docs/STORE_DIGITAL_TWIN.md
 * §2 (SeoBaseline is the runtime counterpart built from live pages).
 */
import type { Finding } from "@shopmanagerai/shared";
import type { ThemeFileSet } from "./fileset.js";

let counter = 0;
function nextId(cat: string): string {
  return `seo:${cat}:${++counter}`;
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

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Title tag construction, meta description presence, canonical, robots, og tags. */
export function auditMetadata(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  const layouts = fileSet.byRole("layout");
  if (layouts.length === 0) {
    findings.push({
      id: nextId("no_layout"),
      severity: "MEDIUM",
      category: "seo_metadata",
      title: "No layout/theme.liquid found",
      detail: "Could not locate a layout file to audit <title>/meta tags.",
      evidence: [],
      confidence: 0.9,
    });
    return findings;
  }

  for (const f of layouts) {
    const text = fileSet.text(f.key) ?? "";
    const checks: Array<{ re: RegExp; title: string; detail: string }> = [
      { re: /<title>/i, title: "Missing <title> tag", detail: "No <title> element found in the layout head." },
      {
        re: /<meta\s+[^>]*name=["']description["']/i,
        title: "Missing meta description",
        detail: "No <meta name=\"description\"> tag found in the layout head.",
      },
      {
        re: /<link\s+[^>]*rel=["']canonical["']/i,
        title: "Missing canonical link",
        detail: "No <link rel=\"canonical\"> found in the layout head.",
      },
      {
        re: /<meta\s+[^>]*name=["']robots["']/i,
        title: "No robots meta tag",
        detail: "No <meta name=\"robots\"> tag found (this is often fine (Shopify has sane defaults) but worth confirming intentionally).",
      },
      {
        re: /property=["']og:title["']/i,
        title: "Missing Open Graph title",
        detail: "No og:title meta tag found in the layout head.",
      },
    ];
    for (const c of checks) {
      if (!c.re.test(text)) {
        findings.push({
          id: nextId("metadata"),
          severity: c.title.includes("robots") ? "OPPORTUNITY" : "MEDIUM",
          category: "seo_metadata",
          title: c.title,
          detail: c.detail,
          evidence: [],
          confidence: 0.55,
          location: { file: f.key },
          suggestedFix: "Add the missing tag to layout/theme.liquid <head>.",
        });
      }
    }
  }
  return findings;
}

/** Heuristic: more than one literal <h1 in a single file. Cannot see runtime output. */
export function auditHeadings(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  for (const { key, text } of liquidishFiles(fileSet)) {
    const matches = [...text.matchAll(/<h1[\s>]/gi)];
    if (matches.length > 1) {
      findings.push({
        id: nextId("h1"),
        severity: "LOW",
        category: "seo_headings",
        title: "Multiple <h1> tags found in one file",
        detail: `${matches.length} literal <h1> occurrences in ${key}. This is a static-source heuristic: conditional branches may mean only one ever renders. Verify at runtime before treating as a real issue.`,
        evidence: [],
        confidence: 0.35,
        location: { file: key, line: lineOf(text, matches[1]!.index ?? 0) },
      });
    }
  }
  return findings;
}

/** JSON-LD <script type="application/ld+json"> blocks and their @type. */
export function auditSchema(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let found = false;
  for (const { key, text } of liquidishFiles(fileSet)) {
    let m: RegExpExecArray | null;
    jsonLdRe.lastIndex = 0;
    while ((m = jsonLdRe.exec(text))) {
      found = true;
      const raw = (m[1] as string).trim();
      // Liquid output tags inside JSON-LD make this non-JSON at the source level;
      // just look for a literal "@type" occurrence as a best-effort signal.
      const typeMatch = raw.match(/"@type"\s*:\s*"([^"]+)"/);
      if (!typeMatch) {
        findings.push({
          id: nextId("jsonld_type"),
          severity: "OPPORTUNITY",
          category: "seo_schema",
          title: "JSON-LD block without a literal @type",
          detail: `Found a JSON-LD <script> block in ${key} without a statically-visible "@type" (it may be built dynamically).`,
          evidence: [],
          confidence: 0.3,
          location: { file: key, line: lineOf(text, m.index) },
        });
      }
    }
  }
  if (!found) {
    findings.push({
      id: nextId("jsonld_missing"),
      severity: "OPPORTUNITY",
      category: "seo_schema",
      title: "No JSON-LD structured data found",
      detail: "No <script type=\"application/ld+json\"> blocks found anywhere in the theme source.",
      evidence: [],
      confidence: 0.4,
    });
  }
  return findings;
}

/** <img> tags with no alt attribute, or alt="" / alt='' , in sections and snippets. */
export function auditImageAlt(fileSet: ThemeFileSet): Finding[] {
  const findings: Finding[] = [];
  const roles = new Set(["section", "snippet", "block"]);
  for (const f of fileSet.all()) {
    if (!roles.has(fileSet.role(f.key))) continue;
    const text = fileSet.text(f.key);
    if (text === undefined) continue;
    const imgRe = /<img\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(text))) {
      const tag = m[0] as string;
      const altMatch = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      const hasAlt = !!altMatch;
      const isEmpty = hasAlt && (altMatch![2] as string).trim() === "";
      if (!hasAlt || isEmpty) {
        findings.push({
          id: nextId("img_alt"),
          severity: "LOW",
          category: "seo_image_alt",
          title: hasAlt ? "<img> with empty alt text" : "<img> missing alt attribute",
          detail: `${tag.slice(0, 120)}${tag.length > 120 ? "..." : ""}`,
          evidence: [],
          confidence: 0.5,
          location: { file: f.key, line: lineOf(text, m.index) },
          suggestedFix: "Add a descriptive alt attribute (or alt=\"\" only when the image is decorative).",
        });
      }
    }
  }
  return findings;
}
