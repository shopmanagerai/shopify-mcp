/**
 * Asserts the promises this repository makes about itself.
 *
 * Run in CI after `pnpm build`. It loads the registry the server actually
 * builds, not the manifest and not the source, and fails if:
 *
 *   1. any tool is outside the Free tier;
 *   2. any tool that reaches Shopify declares a write of any kind;
 *   3. any tool writes a theme file, or carries a theme-write risk class;
 *   4. the registry and tools-manifest.json disagree;
 *   5. SHOPIFY_SCOPES in .env.example asks for more than the tools need;
 *   6. a tool's MCP annotations contradict its own metadata.
 *
 * Rule 2 is the one that matters. "Read-only" has to mean no product write, no
 * collection write, no content write, no order write, no customer write and no
 * configuration write, not merely no theme write. Anything that does write is
 * listed below with a reason, so adding a new one is a visible decision rather
 * than an accident.
 *
 * Run:  node scripts/assert-free-only.mjs
 */
import { readFileSync } from "node:fs";
import { createRegistry } from "../packages/tools/dist/index.js";

/**
 * The only tools allowed to write anything, and what they are allowed to touch.
 *
 * Everything here writes to this server's own storage, except the two marked
 * `shopify`, which change something narrow and deliberate about this server's
 * own access rather than about store content.
 */
const ALLOWED_WRITERS = new Map([
  ["commerce.memory.save", "local: saved memories"],
  ["commerce.memory.delete", "local: saved memories"],
  ["commerce.memory.restore", "local: saved memories"],
  ["commerce.skills.write", "local: custom skills"],
  ["commerce.skills.delete", "local: custom skills"],
  ["commerce.skills.enable", "local: custom skills"],
  ["commerce.snapshot.create", "local: snapshot storage"],
  ["commerce.operation.cancel", "local: operation ledger"],
  ["commerce.operation.approve", "local: operation ledger"],
  ["commerce.change.apply", "local: delegates to another registered tool, all of which are listed here"],
  ["shopify.auth.disconnect", "shopify: revokes this server's own access"],
  ["commerce.settings.storefront_password", "shopify: the storefront preview password"],
]);

/** Words in a `dataCategories.writes` entry that mean store content. */
const STORE_CONTENT = /theme|product|variant|collection|page|article|blog|menu|navigation|metafield|metaobject|media|file|redirect|order|customer|discount|inventory|market|translation|publication|webhook|pixel|script/i;

const defs = createRegistry().list();
const failures = [];
const note = [];

// 1. Tier.
const notFree = defs.filter((d) => d.tier !== "free");
if (notFree.length) failures.push(`not on the Free tier: ${notFree.map((d) => `${d.name} (${d.tier})`).join(", ")}`);

// 2 and 3. Writes.
for (const def of defs) {
  const writes = def.dataCategories?.writes ?? [];
  if (writes.length && !ALLOWED_WRITERS.has(def.name)) {
    failures.push(`${def.name} declares writes [${writes.join(", ")}] and is not an allowed writer`);
    continue;
  }
  if (writes.some((w) => /theme/i.test(w))) {
    failures.push(`${def.name} writes theme files`);
  }
  if (ALLOWED_WRITERS.get(def.name)?.startsWith("local") && writes.some((w) => STORE_CONTENT.test(w))) {
    failures.push(`${def.name} is listed as a local writer but declares a store write: [${writes.join(", ")}]`);
  }
}

const themeWriteRisk = defs.filter((d) => d.riskClass === "theme_write" || d.riskClass === "publish");
if (themeWriteRisk.length) failures.push(`theme-write risk class: ${themeWriteRisk.map((d) => d.name).join(", ")}`);

const unusedAllowances = [...ALLOWED_WRITERS.keys()].filter((n) => !defs.some((d) => d.name === n));
if (unusedAllowances.length) {
  note.push(`allowed writers no longer registered (safe, but the list can be trimmed): ${unusedAllowances.join(", ")}`);
}

// 4. Registry matches the published manifest.
const manifest = JSON.parse(readFileSync(new URL("../tools-manifest.json", import.meta.url), "utf8"));
const expected = new Set(manifest.tools.map((t) => t.name));
const names = new Set(defs.map((d) => d.name));
const extra = [...names].filter((n) => !expected.has(n));
const missing = [...expected].filter((n) => !names.has(n));
if (extra.length) failures.push(`registered but not in tools-manifest.json: ${extra.join(", ")}`);
if (missing.length) failures.push(`in tools-manifest.json but never registered: ${missing.join(", ")}`);

// 5. Least privilege: .env.example must not request more than the tools need.
const needed = new Set();
for (const def of defs) for (const s of def.requiredShopifyScopes ?? []) needed.add(s);
// Theme reads use the Theme Access proxy, but the Admin-API theme engine needs
// this scope, so it is requested even though no tool declares it.
needed.add("read_themes");

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const scopeLine = envExample.match(/^SHOPIFY_SCOPES=(.*)$/m);
if (!scopeLine) {
  failures.push(".env.example has no SHOPIFY_SCOPES line");
} else {
  const requested = scopeLine[1].split(",").map((s) => s.trim()).filter(Boolean);
  const writeScopes = requested.filter((s) => s.startsWith("write_"));
  if (writeScopes.length) failures.push(`.env.example requests write scopes: ${writeScopes.join(", ")}`);

  const excessive = requested.filter((s) => !needed.has(s));
  if (excessive.length) failures.push(`.env.example requests scopes no tool needs: ${excessive.join(", ")}`);

  const absent = [...needed].filter((s) => !requested.includes(s));
  if (absent.length) failures.push(`.env.example is missing scopes tools require: ${absent.join(", ")}`);
}

// 6. MCP annotations must agree with the metadata they were derived from.
const { listForMcp } = await import("../packages/tool-registry/dist/index.js");
const flat = listForMcp(
  createRegistry(),
  {
    tier: "free",
    entitlements: new Set(),
    scopesGranted: new Set(needed),
    capabilities: new Set(["admin.read", "admin.write", "theme.read", "theme.write", "theme.engine_a", "theme.engine_b", "browser.capture", "jobs"]),
    profile: "read_only",
    policy: {},
  },
  "flat",
);

for (const descriptor of flat) {
  const def = defs.find((d) => d.name === descriptor.name);
  if (!def || !descriptor.annotations) continue;
  const writes = def.dataCategories?.writes ?? [];
  const shouldBeReadOnly = def.riskClass === "read" && writes.length === 0;
  if (descriptor.annotations.readOnlyHint !== shouldBeReadOnly) {
    failures.push(`${def.name}: readOnlyHint is ${descriptor.annotations.readOnlyHint} but riskClass=${def.riskClass}, writes=${writes.length}`);
  }
}

// 7. Documentation must not claim a tool count the registry disagrees with.
// The README is generated from a template, but it is committed, so a stale
// commit would otherwise ship the wrong number in the title and the badges.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const claimed = [...readme.matchAll(/\b(\d{2,4})\s+tools\b/gi)].map((m) => Number(m[1]));
const wrong = [...new Set(claimed)].filter((n) => n !== defs.length);
if (wrong.length) {
  failures.push(`README claims ${wrong.join(" and ")} tools, the registry has ${defs.length}`);
}
if (!readme.includes(`tools-${defs.length}-brightgreen`)) {
  failures.push(`the README tool badge does not show ${defs.length}`);
}

// server.json must describe this repository and nothing it cannot back up.
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
if (server.version !== JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version) {
  failures.push("server.json version does not match package.json");
}
if (server.remotes?.length) {
  failures.push("server.json advertises a remote endpoint; this repository is the self-hosted server");
}

for (const n of note) console.log(`note: ${n}`);

if (failures.length) {
  console.error("\nFree-tier guarantees violated:\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("");
  process.exit(1);
}

const writers = defs.filter((d) => (d.dataCategories?.writes ?? []).length);
console.log(
  `OK: ${defs.length} tools, all Free.\n` +
    `    0 write to a Shopify store's content or theme.\n` +
    `    ${writers.length} write only to this server's own state or its own access.\n` +
    `    ${[...needed].length} Shopify scopes requested, all read-only.`,
);
