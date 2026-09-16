/**
 * Skills -> MCP prompts. Skills live as Markdown files with YAML-ish
 * frontmatter (`skills/*.md` at the repo root). No external YAML dependency:
 * frontmatter here is a flat `key: value` block, one per line, which is all
 * the skill files in this repo use.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillFrontmatter {
  name: string;
  title: string;
  description: string;
  tier: string;
}

export interface Skill extends SkillFrontmatter {
  body: string;
  filePath: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}
export interface McpPromptDescriptor {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
}
export interface McpPromptMessage {
  role: "user";
  content: { type: "text"; text: string };
}

/** Splits `---\nkey: value\n---\nbody` into a flat frontmatter object + body. */
function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const [, fmBlock, body] = match;
  const frontmatter: Record<string, string> = {};
  for (const line of (fmBlock ?? "").split(/\r?\n/)) {
    const lineMatch = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!lineMatch) continue;
    const [, key, value] = lineMatch;
    if (!key) continue;
    frontmatter[key] = (value ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: (body ?? "").trim() };
}

/** Loads every `*.md` skill file in `dir` (non-recursive). */
export async function loadSkills(dir: string): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  const skills: Skill[] = [];
  for (const file of mdFiles) {
    const filePath = join(dir, file);
    const raw = await readFile(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const name = frontmatter.name ?? file.replace(/\.md$/, "");
    skills.push({
      name,
      title: frontmatter.title ?? name,
      description: frontmatter.description ?? "",
      tier: frontmatter.tier ?? "free",
      body,
      filePath,
    });
  }
  return skills;
}

export function skillToPromptDescriptor(skill: Skill): McpPromptDescriptor {
  return { name: skill.name, description: skill.description, arguments: [] };
}

export function listPromptsForSkills(skills: Skill[]): McpPromptDescriptor[] {
  return skills.map(skillToPromptDescriptor);
}

/** Returns the MCP `prompts/get` message array for one skill by name, or null if unknown. */
export function getPromptForSkill(skills: Skill[], name: string): McpPromptMessage[] | null {
  const skill = skills.find((s) => s.name === name);
  if (!skill) return null;
  return [{ role: "user", content: { type: "text", text: skill.body } }];
}
