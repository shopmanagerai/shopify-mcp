/**
 * The tool registry (docs/PRODUCT_ARCHITECTURE.md §3): "a tool that is not in
 * the registry does not exist." Validates every declarative field on
 * registration so bad definitions fail fast in CI, not at call time.
 */
import {
  ENTITLEMENTS,
  EXECUTION_PLANES,
  ROLLBACK_STRATEGIES,
  STORE_CAPABILITIES,
  TIERS,
  RISK_CLASSES,
  TOOL_CATEGORIES,
  type ToolDefinition,
} from "@shopmanagerai/shared";

const APPROVAL_KINDS = ["none", "confirm", "approval_token"] as const;

/** `shopify.foo.bar` or `commerce.foo.bar`; lowercase, dot-separated segments. */
export const TOOL_NAME_PATTERN = /^(shopify|commerce)\.[a-z0-9_.]+$/;

const IDEMPOTENCY_VALUES = ["natural", "key_required", "none"] as const;
const TASK_MODE_VALUES = ["sync", "task"] as const;
const RATE_LIMIT_CATEGORIES = ["admin_read", "admin_write", "theme", "browser", "job", "none"] as const;
const AUDIT_VALUES = ["always", "mutations_only"] as const;

export class ToolRegistryError extends Error {}

export interface RegisterFamilyOptions {
  /** Name template with a `{<param>}` placeholder, e.g. "shopify.{target}.inspect". */
  familyNameTemplate: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly aliases = new Map<string, string>();

  /** Register a single tool definition after validating it. */
  register(def: ToolDefinition): void {
    this.validate(def);
    this.assertNoCollision(def.name, "name");
    for (const alias of def.aliases ?? []) this.assertNoCollision(alias, "alias");

    this.tools.set(def.name, def);
    for (const alias of def.aliases ?? []) this.aliases.set(alias, def.name);
  }

  /**
   * Expand a family definition into one derived tool per `family.values`
   * (ARCHITECTURE_REVIEW B9): a single handler serves many discoverable names.
   * `def.name` is used as the family's internal/base identity and is not
   * itself registered; `options.familyNameTemplate` (or `def.familyNameTemplate`)
   * supplies the `{param}` template used to derive each concrete name.
   */
  registerFamily(def: ToolDefinition & { familyNameTemplate?: string }, options?: RegisterFamilyOptions): void {
    if (!def.family) {
      throw new ToolRegistryError(`registerFamily: "${def.name}" has no "family" descriptor.`);
    }
    const template = options?.familyNameTemplate ?? def.familyNameTemplate;
    if (!template) {
      throw new ToolRegistryError(`registerFamily: "${def.name}" needs a familyNameTemplate, e.g. "shopify.{target}.inspect".`);
    }
    const placeholder = `{${def.family.param}}`;
    if (!template.includes(placeholder)) {
      throw new ToolRegistryError(`registerFamily: template "${template}" does not contain placeholder "${placeholder}".`);
    }
    if (def.family.values.length === 0) {
      throw new ToolRegistryError(`registerFamily: "${def.name}" family.values must be non-empty.`);
    }

    const { param, values } = def.family;
    for (const value of values) {
      const derivedName = template.split(placeholder).join(value);
      const handler = def.handler;
      const derived: ToolDefinition = {
        ...def,
        name: derivedName,
        family: undefined,
        aliases: undefined,
        handler: (ctx, input: any) => handler(ctx, { ...(input ?? {}), [param]: (input ?? {})[param] ?? value }),
      };
      this.register(derived);
    }
  }

  /** Resolve a name (or alias) to its definition. */
  get(name: string): ToolDefinition | undefined {
    const canonical = this.aliases.get(name) ?? name;
    return this.tools.get(canonical);
  }

  /** All registered definitions (canonical names only; families already expanded). */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  byCategory(category: ToolDefinition["category"]): ToolDefinition[] {
    return this.list().filter((t) => t.category === category);
  }

  get size(): number {
    return this.tools.size;
  }

  /** Adds an alias after registration (namespace aliases, façades). Throws on collision. */
  addAlias(alias: string, canonical: string): void {
    if (!this.tools.has(canonical)) throw new ToolRegistryError(`addAlias: unknown tool "${canonical}".`);
    // Idempotent: definitions are module singletons, so a second registry build sees the alias already on the def.
    if (this.aliases.get(alias) === canonical) return;
    this.assertNoCollision(alias, "alias");
    if (this.aliases.has(alias)) throw new ToolRegistryError(`Alias collision: "${alias}" is already an alias.`);
    this.aliases.set(alias, canonical);
    const def = this.tools.get(canonical)!;
    if (!def.aliases?.includes(alias)) (def as { aliases?: string[] }).aliases = [...(def.aliases ?? []), alias];
  }

  /** Canonical name a given alias resolves to, if any. */
  resolveAlias(name: string): string | undefined {
    return this.aliases.get(name);
  }

  private assertNoCollision(name: string, kind: "name" | "alias" = "name"): void {
    if (this.tools.has(name)) {
      throw new ToolRegistryError(
        kind === "name"
          ? `Duplicate tool name: "${name}" is already registered.`
          : `Alias collision: "${name}" collides with an existing tool name.`,
      );
    }
    if (this.aliases.has(name)) {
      throw new ToolRegistryError(`Alias collision: "${name}" is already registered as an alias for "${this.aliases.get(name)}".`);
    }
  }

  private validate(def: ToolDefinition): void {
    if (!TOOL_NAME_PATTERN.test(def.name)) {
      throw new ToolRegistryError(`Invalid tool name "${def.name}": must match ${TOOL_NAME_PATTERN}.`);
    }
    requireEnum("tier", def.tier, TIERS);
    requireEnum("category", def.category, TOOL_CATEGORIES);
    requireEnum("riskClass", def.riskClass, RISK_CLASSES);
    requireEnum("executionPlane", def.executionPlane, EXECUTION_PLANES);
    requireEnum("rollback", def.rollback, ROLLBACK_STRATEGIES);
    requireEnum("idempotency", def.idempotency, IDEMPOTENCY_VALUES);
    requireEnum("taskMode", def.taskMode, TASK_MODE_VALUES);
    requireEnum("rateLimitCategory", def.rateLimitCategory, RATE_LIMIT_CATEGORIES);
    requireEnum("audit", def.audit, AUDIT_VALUES);
    requireEnum("approval", def.approval, APPROVAL_KINDS);

    for (const e of def.requiredEntitlements) requireEnum("requiredEntitlements[]", e, ENTITLEMENTS);
    for (const c of def.requiredStoreCapabilities) requireEnum("requiredStoreCapabilities[]", c, STORE_CAPABILITIES);

    if (!def.inputSchema) throw new ToolRegistryError(`"${def.name}": inputSchema is required.`);
    if (!def.outputSchema) throw new ToolRegistryError(`"${def.name}": outputSchema is required.`);
    if (typeof def.description !== "string" || def.description.trim().length === 0) {
      throw new ToolRegistryError(`"${def.name}": description is required.`);
    }

    if (!def.docs || !Array.isArray(def.docs.examples) || def.docs.examples.length < 1) {
      throw new ToolRegistryError(`"${def.name}": docs.examples must have at least one example.`);
    }
    if (!def.dataCategories) {
      throw new ToolRegistryError(`"${def.name}": dataCategories is required.`);
    }
    for (const field of ["reads", "writes", "stores", "returnsToClient"] as const) {
      if (!Array.isArray(def.dataCategories[field])) {
        throw new ToolRegistryError(`"${def.name}": dataCategories.${field} must be an array.`);
      }
    }

    if (def.escalation) {
      for (const rule of def.escalation) {
        requireEnum("escalation[].toRisk", rule.toRisk, RISK_CLASSES);
        if (!Array.isArray(rule.whenInputHas) || rule.whenInputHas.length === 0) {
          throw new ToolRegistryError(`"${def.name}": escalation.whenInputHas must be non-empty.`);
        }
      }
    }

    if (typeof def.handler !== "function") {
      throw new ToolRegistryError(`"${def.name}": handler must be a function.`);
    }
  }
}

function requireEnum<T extends string>(field: string, value: T, allowed: readonly T[]): void {
  if (!allowed.includes(value)) {
    throw new ToolRegistryError(`Invalid ${field} "${value}": must be one of ${allowed.join(", ")}.`);
  }
}
