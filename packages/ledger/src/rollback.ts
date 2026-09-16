import { ShopManagerAIError, fingerprint, newId } from "@shopmanagerai/shared";
import type { AdminClient, Change, Ledger, OperationRecord, RollbackStrategy, SnapshotStore, ThemeEngine, ThemeFileWrite } from "@shopmanagerai/shared";
import {
  setInventoryQuantities,
  getProductInventory,
  deleteMarket,
  updateMarket,
  disableShopLocale,
  updateShopLocale,
  registerTranslations,
  removeTranslations,
  getTranslatableResource,
  deleteCatalog,
  deletePriceList,
  addPriceListFixedPrices,
  deletePriceListFixedPrices,
  listPriceLists,
  deleteDiscount,
  setDiscountActive,
  updateOrder,
  getOrder,
  deleteDraftOrder,
  updateCustomer,
  getCustomer,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  createWebPixel,
  updateWebPixel,
  deleteWebPixel,
  getWebPixel,
  createCollection,
  createDraftArticle,
  createMenu,
  createPage,
  createProductVariants,
  collectionAddProducts,
  deleteMenu,
  deleteProductVariants,
  deleteArticle,
  deleteCollection,
  deletePage,
  deleteProduct,
  getArticle,
  getCollection,
  getMenu,
  getPage,
  getProduct,
  listMetafieldsOnOwner,
  updateArticle,
  updateCollection,
  updateMenu,
  updatePage,
  updateProduct,
  createUrlRedirect,
  updateUrlRedirect,
  deleteUrlRedirect,
  setMetafields,
  deleteMetafields,
} from "@shopmanagerai/shopify-admin";

export interface RollbackStep {
  resource: string;
  action: "restore" | "delete" | "publish" | "none";
  note?: string;
}

export interface RollbackPlan {
  available: boolean;
  strategy: RollbackStrategy;
  steps: RollbackStep[];
  warnings: string[];
}

export interface RollbackExecuteDeps {
  /** Required for `ledger_before_image`, `snapshot`, and `republish_previous`. */
  theme?: ThemeEngine;
  /** Required for `inverse_operation` (product/collection/page/article/menu/redirect/metafield). */
  admin?: AdminClient;
  /** When true (recommended), verify the live file's fingerprint before overwriting it. */
  verifyFingerprints: boolean;
  /** Bypass a FINGERPRINT_MISMATCH refusal for `ledger_before_image` and proceed anyway. */
  force?: boolean;
  /** For the `snapshot` strategy: delete theme files that exist live but aren't in the snapshot. Off by default (non-destructive). */
  pruneExtras?: boolean;
  /** Attributed as the new rollback operation's `credentialLabel`/approval issuer, e.g. "merchant" or a credential label. */
  executedBy?: string;
}

/**
 * `theme_file:<themeId>:<key>` is the convention this package expects tool
 * handlers to use for theme-touching `Change.resource` values, so rollback can
 * recover which theme a before/after image belongs to without a dedicated
 * column on `operations`. Anything else is left alone (e.g. `product:gid://…`)
 * since 0.1 only implements restore for theme files.
 */
function parseThemeFileResource(resource: string): { themeId: string; key: string } | null {
  const parts = resource.split(":");
  if (parts.length < 3 || parts[0] !== "theme_file") return null;
  const themeId = parts[1]!;
  const key = parts.slice(2).join(":");
  return { themeId, key };
}

/**
 * Resource kinds understood by the `inverse_operation` strategy (task brief
 * item 4). `Change.resource` is `"<kind>:<gid>"`, except `metafield`, which is
 * `"metafield:<ownerGid>:<namespace>:<key>"` (a gid itself contains a colon
 * from its `gid://` scheme, so parsing keeps the last N ":"-separated
 * segments as the tail and joins everything before them back into the id).
 */
const COMMERCE_INVERSE_KINDS = ["webhook", "web_pixel", "inventory", "market", "locale", "translation", "catalog", "price_list", "price_list_price", "discount", "order", "draft_order", "customer"];
const INVERSE_RESOURCE_KINDS = new Set(["product", "collection", "page", "article", "menu", "redirect", "metafield", "variant", ...COMMERCE_INVERSE_KINDS]);

function resourceKind(resource: string): string | null {
  const idx = resource.indexOf(":");
  return idx === -1 ? null : resource.slice(0, idx);
}

function parseResource(resource: string, kind: string, tailFields = 0): { id: string; tail: string[] } | null {
  const prefix = `${kind}:`;
  if (!resource.startsWith(prefix)) return null;
  const rest = resource.slice(prefix.length);
  if (tailFields === 0) return { id: rest, tail: [] };
  const parts = rest.split(":");
  if (parts.length <= tailFields) return null;
  const tail = parts.slice(parts.length - tailFields);
  const id = parts.slice(0, parts.length - tailFields).join(":");
  return { id, tail };
}

/** Fingerprint of just the fields present in `keys`, for optimistic-concurrency checks. */
function fingerprintSubset(entity: Record<string, unknown> | null | undefined, keys: string[]): string {
  const subset: Record<string, unknown> = {};
  for (const k of keys) subset[k] = (entity as Record<string, unknown> | undefined)?.[k] ?? null;
  return fingerprint(subset);
}

/**
 * Implements `commerce.rollback.plan` / `commerce.rollback.execute` against the
 * ledger + snapshot store. See docs/PRODUCT_ARCHITECTURE.md §7.
 */
export class RollbackService {
  constructor(
    private readonly ledger: Ledger,
    private readonly snapshots: SnapshotStore,
  ) {}

  async plan(operationId: string): Promise<RollbackPlan> {
    const op = await this.ledger.get(operationId);
    if (!op) {
      return { available: false, strategy: "none", steps: [], warnings: [`Operation ${operationId} not found.`] };
    }

    const strategy = (op.rollback?.strategy ?? "none") as RollbackStrategy;
    const warnings: string[] = [];

    if (!op.rollback?.available || strategy === "none") {
      return { available: false, strategy: "none", steps: [], warnings };
    }

    if (strategy === "inverse_operation") {
      const steps: RollbackStep[] = [];
      for (const change of op.changes) {
        const kind = resourceKind(change.resource);
        if (!kind || !INVERSE_RESOURCE_KINDS.has(kind)) {
          steps.push({ resource: change.resource, action: "none", note: `No inverse operation known for resource "${change.resource}".` });
          continue;
        }
        if (change.kind === "create" && kind !== "metafield") {
          steps.push({ resource: change.resource, action: "delete", note: `Delete the ${kind} that this operation created.` });
          continue;
        }
        if (change.kind === "delete" && change.before !== undefined && ["collection", "page", "article", "menu", "variant"].includes(kind)) {
          steps.push({ resource: change.resource, action: "restore", note: `Recreate the ${kind} from its before-image (new id).` });
          continue;
        }
        if (change.before === undefined && change.kind !== "delete") {
          steps.push({ resource: change.resource, action: "none", note: "No before-image captured; cannot restore." });
          continue;
        }
        steps.push({ resource: change.resource, action: "restore", note: `Call the ${kind} update mutation with the recorded before-image.` });
      }
      return { available: steps.some((s) => s.action !== "none"), strategy, steps, warnings };
    }

    if (strategy === "ledger_before_image") {
      const steps: RollbackStep[] = [];
      for (const change of op.changes) {
        const parsed = parseThemeFileResource(change.resource);
        if (!parsed) {
          warnings.push(`No restore path for resource "${change.resource}"; skipped.`);
          continue;
        }
        if (change.kind === "create") {
          steps.push({ resource: change.resource, action: "delete", note: `Remove ${parsed.key} from theme ${parsed.themeId} (it did not exist before the operation).` });
          continue;
        }
        if (change.kind === "delete" && change.before === undefined) {
          steps.push({ resource: change.resource, action: "none", note: "File was deleted with no captured before-image; cannot restore." });
          continue;
        }
        steps.push({ resource: change.resource, action: "restore", note: `Restore ${parsed.key} in theme ${parsed.themeId} to its before-image.` });
      }
      return { available: steps.some((s) => s.action !== "none"), strategy, steps, warnings };
    }

    if (strategy === "snapshot") {
      const snapshotId = op.rollback?.snapshotId;
      if (!snapshotId) {
        warnings.push("Rollback strategy is 'snapshot' but no snapshotId was recorded on the operation.");
        return { available: false, strategy, steps: [], warnings };
      }
      const snapshot = await this.snapshots.get(snapshotId);
      if (!snapshot) {
        warnings.push(`Snapshot ${snapshotId} no longer exists.`);
        return { available: false, strategy, steps: [], warnings };
      }
      const files = await this.snapshots.readThemeFiles(snapshotId);
      const steps: RollbackStep[] = files.map((f) => ({ resource: `theme_file:${snapshot.themeId}:${f.key}`, action: "restore" as const }));
      steps.push({
        resource: `theme:${snapshot.themeId}`,
        action: "none",
        note: "Files present live but not in the snapshot are left in place unless pruneExtras is requested.",
      });
      return { available: true, strategy, steps, warnings };
    }

    if (strategy === "republish_previous") {
      const publishChange = op.changes.find((c) => c.kind === "publish");
      if (!publishChange || typeof publishChange.before !== "string") {
        warnings.push("No previous theme id was recorded to republish.");
        return { available: false, strategy, steps: [], warnings };
      }
      return {
        available: true,
        strategy,
        steps: [{ resource: `theme:${publishChange.before}`, action: "publish", note: `Republish theme ${publishChange.before}.` }],
        warnings,
      };
    }

    return { available: false, strategy, steps: [], warnings: [`Unknown rollback strategy "${strategy}".`] };
  }

  async execute(operationId: string, deps: RollbackExecuteDeps): Promise<OperationRecord> {
    const op = await this.ledger.get(operationId);
    if (!op) {
      throw new ShopManagerAIError("NOT_FOUND", `Operation ${operationId} not found.`);
    }
    const strategy = (op.rollback?.strategy ?? "none") as RollbackStrategy;
    if (!op.rollback?.available || strategy === "none") {
      throw new ShopManagerAIError("NOT_SUPPORTED", `Operation ${operationId} has no rollback available.`);
    }

    const rollbackOpId = newId("op");
    await this.ledger.begin({
      operationId: rollbackOpId,
      shopId: op.shopId,
      credentialId: op.credentialId,
      credentialLabel: deps.executedBy ?? op.credentialLabel,
      tool: "commerce.rollback.execute",
      tier: op.tier,
      risk: op.risk,
      inputsHash: fingerprint({ operationId }),
      inputsRedacted: { operationId },
      resources: [],
      changes: [],
      evidence: [],
      warnings: [],
      rollback: { available: false, strategy: "none", byOperationId: operationId },
    });

    try {
      const changes: Change[] = [];
      const warnings: string[] = [];

      switch (strategy) {
        case "ledger_before_image":
          await this.executeLedgerBeforeImage(op, deps, changes, warnings);
          break;
        case "snapshot":
          await this.executeSnapshot(op, deps, changes, warnings);
          break;
        case "republish_previous":
          await this.executeRepublishPrevious(op, deps, changes);
          break;
        case "inverse_operation":
          await this.executeInverseOperation(op, deps, changes, warnings);
          break;
        default:
          throw new ShopManagerAIError("NOT_SUPPORTED", `Unknown rollback strategy "${strategy}".`);
      }

      const finished = await this.ledger.finish(rollbackOpId, {
        status: "succeeded",
        changes,
        warnings,
        rollback: { available: false, strategy: "none", byOperationId: operationId },
      });

      await this.ledger.finish(operationId, {
        status: "rolled_back",
        rollback: { ...op.rollback, byOperationId: rollbackOpId, executedAt: new Date().toISOString() },
      });

      return finished;
    } catch (e) {
      const err = e instanceof ShopManagerAIError ? e : new ShopManagerAIError("INTERNAL", "Rollback failed.", { cause: e });
      await this.ledger.finish(rollbackOpId, { status: "failed", error: { code: err.code, message: err.message } });
      throw err;
    }
  }

  private async executeLedgerBeforeImage(
    op: OperationRecord,
    deps: RollbackExecuteDeps,
    changes: Change[],
    warnings: string[],
  ): Promise<void> {
    if (!deps.theme) throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "Rollback requires a ThemeEngine for ledger_before_image.");

    const byTheme = new Map<string, ThemeFileWrite[]>();
    const deletesByTheme = new Map<string, string[]>();
    for (const change of op.changes) {
      const parsed = parseThemeFileResource(change.resource);
      if (!parsed) {
        warnings.push(`No restore path for resource "${change.resource}"; skipped.`);
        continue;
      }

      const verify = async () => {
        if (!deps.verifyFingerprints || !change.fingerprintAfter) return;
        const [current] = await deps.theme!.readFiles(parsed.themeId, [parsed.key]);
        const currentFingerprint = current ? fingerprint(current.content ?? current.contentBase64 ?? "") : fingerprint(null);
        if (currentFingerprint !== change.fingerprintAfter && !deps.force) {
          throw new ShopManagerAIError("FINGERPRINT_MISMATCH", `File ${parsed.key} in theme ${parsed.themeId} changed since the operation; refusing to overwrite.`, {
            details: { resource: change.resource, expected: change.fingerprintAfter, actual: currentFingerprint },
          });
        }
      };

      if (change.kind === "create") {
        // Undo a creation by removing the file (after checking nobody edited it since).
        await verify();
        const list = deletesByTheme.get(parsed.themeId) ?? [];
        list.push(parsed.key);
        deletesByTheme.set(parsed.themeId, list);
        changes.push({ resource: change.resource, kind: "delete", before: change.after });
        continue;
      }

      if (change.before === undefined) {
        warnings.push(`No before-image captured for ${change.resource}; skipped.`);
        continue;
      }

      if (change.kind !== "delete") await verify();

      const before = change.before as { content?: string; contentBase64?: string };
      const write: ThemeFileWrite = { key: parsed.key };
      if (typeof before?.contentBase64 === "string") write.contentBase64 = before.contentBase64;
      else write.content = typeof before === "string" ? before : (before?.content ?? "");

      const list = byTheme.get(parsed.themeId) ?? [];
      list.push(write);
      byTheme.set(parsed.themeId, list);
      changes.push({ resource: change.resource, kind: "update", before: change.after, after: change.before });
    }

    for (const [themeId, writes] of byTheme) {
      if (writes.length === 0) continue;
      const result = await deps.theme.writeFiles(themeId, writes);
      for (const err of result.errors) warnings.push(`Failed to restore ${err.key} in theme ${themeId}: ${err.message}`);
    }
    for (const [themeId, keys] of deletesByTheme) {
      if (keys.length === 0) continue;
      const result = await deps.theme.deleteFiles(themeId, keys);
      for (const err of result.errors) warnings.push(`Failed to remove ${err.key} in theme ${themeId}: ${err.message}`);
    }
  }

  private async executeSnapshot(op: OperationRecord, deps: RollbackExecuteDeps, changes: Change[], warnings: string[]): Promise<void> {
    if (!deps.theme) throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "Rollback requires a ThemeEngine for the snapshot strategy.");
    const snapshotId = op.rollback?.snapshotId;
    if (!snapshotId) throw new ShopManagerAIError("SNAPSHOT_NOT_FOUND", "Operation has no snapshotId recorded.");
    const snapshot = await this.snapshots.get(snapshotId);
    if (!snapshot || !snapshot.themeId) throw new ShopManagerAIError("SNAPSHOT_NOT_FOUND", `Snapshot ${snapshotId} not found.`);

    const files = await this.snapshots.readThemeFiles(snapshotId);
    const writes: ThemeFileWrite[] = files.map((f) => (f.contentBase64 !== undefined ? { key: f.key, contentBase64: f.contentBase64 } : { key: f.key, content: f.content ?? "" }));

    const result = await deps.theme.writeFiles(snapshot.themeId, writes);
    for (const key of result.written) changes.push({ resource: `theme_file:${snapshot.themeId}:${key}`, kind: "update" });
    for (const err of result.errors) warnings.push(`Failed to restore ${err.key} in theme ${snapshot.themeId}: ${err.message}`);

    if (deps.pruneExtras) {
      const snapshotKeys = new Set(files.map((f) => f.key));
      const live = await deps.theme.listFiles(snapshot.themeId);
      const extras = live.filter((f) => !snapshotKeys.has(f.key)).map((f) => f.key);
      if (extras.length > 0) {
        const del = await deps.theme.deleteFiles(snapshot.themeId, extras);
        for (const key of del.deleted) changes.push({ resource: `theme_file:${snapshot.themeId}:${key}`, kind: "delete" });
        for (const err of del.errors) warnings.push(`Failed to delete extra file ${err.key}: ${err.message}`);
      }
    } else {
      const snapshotKeys = new Set(files.map((f) => f.key));
      const live = await deps.theme.listFiles(snapshot.themeId);
      const extraCount = live.filter((f) => !snapshotKeys.has(f.key)).length;
      if (extraCount > 0) warnings.push(`${extraCount} file(s) exist live but not in the snapshot; left in place (pruneExtras was not set).`);
    }
  }

  private async executeRepublishPrevious(op: OperationRecord, deps: RollbackExecuteDeps, changes: Change[]): Promise<void> {
    if (!deps.theme) throw new ShopManagerAIError("THEME_ENGINE_UNAVAILABLE", "Rollback requires a ThemeEngine for republish_previous.");
    const publishChange = op.changes.find((c) => c.kind === "publish");
    if (!publishChange || typeof publishChange.before !== "string") {
      throw new ShopManagerAIError("NOT_FOUND", "No previous theme id was recorded on the operation to republish.");
    }
    const previousThemeId = publishChange.before;
    const published = await deps.theme.publishTheme(previousThemeId);
    changes.push({ resource: `theme:${previousThemeId}`, kind: "publish", before: op.changes.find((c) => c.kind === "publish")?.after, after: published.id });
  }

  /**
   * Restores product/collection/page/article/menu/redirect/metafield
   * before-images via the matching update mutation in @shopmanagerai/shopify-admin.
   * Unless `force`, refuses (FINGERPRINT_MISMATCH) when the live resource's
   * fingerprint (over the same fields the operation touched) no longer
   * matches the fingerprint recorded right after the original operation.
   */
  private async executeInverseOperation(op: OperationRecord, deps: RollbackExecuteDeps, changes: Change[], warnings: string[]): Promise<void> {
    if (!deps.admin) throw new ShopManagerAIError("NOT_SUPPORTED", "Rollback requires an AdminClient for inverse_operation.");
    const admin = deps.admin;

    for (const change of op.changes) {
      const kind = resourceKind(change.resource);
      if (!kind || !INVERSE_RESOURCE_KINDS.has(kind)) {
        warnings.push(`No inverse operation for resource "${change.resource}"; skipped.`);
        continue;
      }

      try {
        if (COMMERCE_INVERSE_KINDS.includes(kind)) {
          await this.commerceInverse(kind, change, admin, changes, warnings, deps);
          continue;
        }
        switch (kind) {
          case "product": {
            const parsed = parseResource(change.resource, "product");
            if (!parsed) break;
            if (change.kind === "create") {
              await this.deleteCreated(change, changes, warnings, () => deleteProduct(admin, parsed.id));
              break;
            }
            await this.restoreViaFields(change, changes, warnings, deps, {
              fetch: () => getProduct(admin, parsed.id) as Promise<Record<string, unknown> | null>,
              restore: (fields) => updateProduct(admin, { id: parsed.id, ...(fields as Record<string, unknown>) } as any),
            });
            break;
          }
          case "collection": {
            const parsed = parseResource(change.resource, "collection");
            if (!parsed) break;
            if (change.kind === "create") {
              await this.deleteCreated(change, changes, warnings, () => deleteCollection(admin, parsed.id));
              break;
            }
            if (change.kind === "delete") {
              const b = change.before as { title?: string; descriptionHtml?: string; ruleSet?: unknown; seo?: unknown; handle?: string } | undefined;
              if (!b?.title) {
                warnings.push(`No before-image for ${change.resource}; cannot recreate.`);
                break;
              }
              const { collection, userErrors } = await createCollection(admin, { title: b.title, descriptionHtml: b.descriptionHtml, ruleSet: b.ruleSet, seo: b.seo } as any);
              if (userErrors.length > 0 || !collection) warnings.push(`collectionCreate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: `collection:${collection.id}`, kind: "create", after: b });
              break;
            }
            const after = change.after as { removedProductIds?: string[] } | undefined;
            if (after?.removedProductIds?.length) {
              const { userErrors } = await collectionAddProducts(admin, parsed.id, after.removedProductIds);
              if (userErrors.length > 0) warnings.push(`collectionAddProducts rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: change.resource, kind: "update", before: change.after, after: { addedProductIds: after.removedProductIds } });
              break;
            }
            await this.restoreViaFields(change, changes, warnings, deps, {
              fetch: () => getCollection(admin, parsed.id) as Promise<Record<string, unknown> | null>,
              restore: (fields) => updateCollection(admin, { id: parsed.id, ...(fields as Record<string, unknown>) } as any),
            });
            break;
          }
          case "page": {
            const parsed = parseResource(change.resource, "page");
            if (!parsed) break;
            if (change.kind === "create") {
              await this.deleteCreated(change, changes, warnings, () => deletePage(admin, parsed.id));
              break;
            }
            if (change.kind === "delete") {
              const b = change.before as { title?: string; body?: string; isPublished?: boolean; templateSuffix?: string; seo?: unknown } | undefined;
              if (!b?.title) {
                warnings.push(`No before-image for ${change.resource}; cannot recreate.`);
                break;
              }
              const { page, userErrors } = await createPage(admin, { title: b.title, body: b.body, isPublished: b.isPublished, templateSuffix: b.templateSuffix, seo: b.seo } as any);
              if (userErrors.length > 0 || !page) warnings.push(`pageCreate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: `page:${page.id}`, kind: "create", after: b });
              break;
            }
            await this.restoreViaFields(change, changes, warnings, deps, {
              fetch: () => getPage(admin, parsed.id) as Promise<Record<string, unknown> | null>,
              restore: (fields) => updatePage(admin, parsed.id, fields as Record<string, unknown>),
            });
            break;
          }
          case "article": {
            const parsed = parseResource(change.resource, "article");
            if (!parsed) break;
            if (change.kind === "create") {
              await this.deleteCreated(change, changes, warnings, () => deleteArticle(admin, parsed.id));
              break;
            }
            if (change.kind === "delete") {
              const b = change.before as { title?: string; body?: string; blogId?: string } | undefined;
              if (!b?.title || !b.blogId) {
                warnings.push(`No before-image for ${change.resource}; cannot recreate.`);
                break;
              }
              const { article, userErrors } = await createDraftArticle(admin, { blogId: b.blogId, title: b.title, body: b.body });
              if (userErrors.length > 0 || !article) warnings.push(`articleCreate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: `article:${article.id}`, kind: "create", after: b });
              break;
            }
            await this.restoreViaFields(change, changes, warnings, deps, {
              fetch: () => getArticle(admin, parsed.id) as Promise<Record<string, unknown> | null>,
              restore: (fields) => updateArticle(admin, parsed.id, fields as Record<string, unknown>),
            });
            break;
          }
          case "menu": {
            const parsed = parseResource(change.resource, "menu");
            if (!parsed) break;
            if (change.kind === "create") {
              await this.deleteCreated(change, changes, warnings, () => deleteMenu(admin, parsed.id));
              break;
            }
            if (change.kind === "delete") {
              const b = change.before as { title?: string; handle?: string; items?: unknown[] } | undefined;
              if (!b?.title || !b.handle) {
                warnings.push(`No before-image for ${change.resource}; cannot recreate.`);
                break;
              }
              const strip = (items: any[]): any[] => items.map((it) => ({ title: it.title, type: it.type, url: it.url ?? undefined, resourceId: it.resourceId ?? undefined, tags: it.tags ?? undefined, items: strip(it.items ?? []) }));
              const { menu, userErrors } = await createMenu(admin, { title: b.title, handle: b.handle, items: strip((b.items ?? []) as any[]) });
              if (userErrors.length > 0 || !menu) warnings.push(`menuCreate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: `menu:${menu.id}`, kind: "create", after: b });
              break;
            }
            const before = change.before as { items?: unknown[] } | undefined;
            if (!before?.items) {
              warnings.push(`No before-image captured for ${change.resource}; skipped.`);
              break;
            }
            if (deps.verifyFingerprints && change.fingerprintAfter) {
              const current = await getMenu(admin, parsed.id);
              const currentFp = fingerprint((current as any)?.items ?? null);
              if (currentFp !== change.fingerprintAfter && !deps.force) {
                throw new ShopManagerAIError("FINGERPRINT_MISMATCH", `Menu ${parsed.id} changed since the operation; refusing to overwrite.`, {
                  details: { resource: change.resource, expected: change.fingerprintAfter, actual: currentFp },
                });
              }
            }
            const { userErrors } = await updateMenu(admin, parsed.id, before.items as any);
            if (userErrors.length > 0) warnings.push(`menuUpdate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
            changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
            break;
          }
          case "variant": {
            const parsed = parseResource(change.resource, "variant");
            if (!parsed) break;
            const variantId = parsed.id;
            const productId = ((change.before as { productId?: string } | undefined)?.productId ?? (change.after as { productId?: string } | undefined)?.productId) as string | undefined;
            if (!productId) {
              warnings.push(`No productId recorded for ${change.resource}; cannot roll back.`);
              break;
            }
            if (change.kind === "create") {
              const { userErrors } = await deleteProductVariants(admin, productId, [variantId]);
              if (userErrors.length > 0) warnings.push(`productVariantsBulkDelete rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: change.resource, kind: "delete", before: change.after });
              break;
            }
            if (change.kind === "delete") {
              const b = change.before as { title?: string; price?: string; compareAtPrice?: string | null; sku?: string | null; barcode?: string | null; selectedOptions?: Array<{ name: string; value: string }> } | undefined;
              const optionValues = (b?.selectedOptions ?? (b?.title && b.title !== "Default Title" ? b.title.split(" / ").map((v, i) => ({ name: `Option${i + 1}`, value: v })) : [])).map((o) => ({ optionName: o.name, name: o.value }));
              if (!b || optionValues.length === 0) {
                warnings.push(`No option values recorded for ${change.resource}; cannot recreate the variant.`);
                break;
              }
              const { variants, userErrors } = await createProductVariants(admin, productId, [{ optionValues, price: b.price, compareAtPrice: b.compareAtPrice ?? undefined, sku: b.sku ?? undefined, barcode: b.barcode ?? undefined }], "DEFAULT");
              if (userErrors.length > 0 || variants.length === 0) warnings.push(`productVariantsBulkCreate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              else changes.push({ resource: `variant:${variants[0]!.id}`, kind: "create", after: { ...b, productId } });
              break;
            }
            warnings.push(`No inverse for variant change kind "${change.kind}".`);
            break;
          }
          case "redirect": {
            const parsed = parseResource(change.resource, "redirect");
            if (!parsed) break;
            if (change.kind === "create") {
              const { userErrors } = await deleteUrlRedirect(admin, parsed.id);
              if (userErrors.length > 0) warnings.push(`urlRedirectDelete rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              changes.push({ resource: change.resource, kind: "delete", before: change.after });
            } else if (change.kind === "delete") {
              const before = change.before as { path: string; target: string } | undefined;
              if (!before) {
                warnings.push(`No before-image captured for ${change.resource}; skipped.`);
                break;
              }
              const { userErrors } = await createUrlRedirect(admin, before.path, before.target);
              if (userErrors.length > 0) warnings.push(`urlRedirectCreate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              changes.push({ resource: change.resource, kind: "create", after: before });
            } else {
              const before = change.before as { path?: string; target?: string } | undefined;
              if (!before) {
                warnings.push(`No before-image captured for ${change.resource}; skipped.`);
                break;
              }
              const { userErrors } = await updateUrlRedirect(admin, parsed.id, before);
              if (userErrors.length > 0) warnings.push(`urlRedirectUpdate rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
            }
            break;
          }
          case "metafield": {
            const parsed = parseResource(change.resource, "metafield", 2);
            if (!parsed) break;
            const [namespace, key] = parsed.tail;
            if (change.kind === "create") {
              const { userErrors } = await deleteMetafields(admin, [{ ownerId: parsed.id, namespace: namespace!, key: key! }]);
              if (userErrors.length > 0) warnings.push(`metafieldsDelete rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              changes.push({ resource: change.resource, kind: "delete", before: change.after });
            } else {
              const before = change.before as { type?: string; value?: string } | undefined;
              if (!before?.value) {
                warnings.push(`No before-image captured for ${change.resource}; skipped.`);
                break;
              }
              if (deps.verifyFingerprints && change.fingerprintAfter) {
                const list = await listMetafieldsOnOwner(admin, parsed.id);
                const current = list.items.find((m) => m.namespace === namespace && m.key === key);
                const currentFp = fingerprint(current?.value ?? null);
                if (currentFp !== change.fingerprintAfter && !deps.force) {
                  throw new ShopManagerAIError("FINGERPRINT_MISMATCH", `Metafield ${change.resource} changed since the operation; refusing to overwrite.`, {
                    details: { resource: change.resource, expected: change.fingerprintAfter, actual: currentFp },
                  });
                }
              }
              const { userErrors } = await setMetafields(admin, [{ ownerId: parsed.id, namespace: namespace!, key: key!, type: before.type ?? "single_line_text_field", value: before.value }]);
              if (userErrors.length > 0) warnings.push(`metafieldsSet rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
              changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
            }
            break;
          }
        }
      } catch (e) {
        if (e instanceof ShopManagerAIError && e.code === "FINGERPRINT_MISMATCH") throw e;
        warnings.push(`Failed to restore ${change.resource}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** Shared restore path for resources whose before-image is a flat field object (product/collection/page/article). */
  /** Inverse of a `create` change: delete the resource the operation created. */
  /** Inverse operations for the Phase 5 commerce resources. Each branch reverses exactly what the tool recorded. */
  private async commerceInverse(kind: string, change: Change, admin: AdminClient, changes: Change[], warnings: string[], deps: RollbackExecuteDeps): Promise<void> {
    const skip = (why: string): void => { warnings.push(`${change.resource}: ${why}; skipped.`); };
    const errs = (label: string, userErrors: Array<{ message: string }>) => { if (userErrors.length) warnings.push(`${label} rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`); return userErrors.length === 0; };
    switch (kind) {
      case "webhook": {
        const parsed = parseResource(change.resource, "webhook");
        if (!parsed) return;
        if (change.kind === "create") { const x = await deleteWebhookSubscription(admin, parsed.id); if (errs("webhookSubscriptionDelete", x.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (change.kind === "delete") {
          const before = change.before as { topic?: string; uri?: string; format?: "JSON" | "XML"; includeFields?: string[]; metafieldNamespaces?: string[]; filter?: string | null } | undefined;
          if (!before?.topic || !before.uri) return skip("no before-image");
          const x = await createWebhookSubscription(admin, before.topic.toLowerCase().replace("_", "/"), { uri: before.uri, format: before.format, includeFields: before.includeFields, metafieldNamespaces: before.metafieldNamespaces, filter: before.filter ?? undefined });
          if (errs("webhookSubscriptionCreate", x.userErrors)) changes.push({ resource: change.resource, kind: "create", after: before });
          return;
        }
        const before = change.before as { uri?: string; includeFields?: string[]; metafieldNamespaces?: string[]; filter?: string } | undefined;
        if (!before) return skip("no before-image");
        const x = await updateWebhookSubscription(admin, parsed.id, before);
        if (errs("webhookSubscriptionUpdate", x.userErrors)) changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
        return;
      }
      case "web_pixel": {
        const parsed = parseResource(change.resource, "web_pixel");
        if (!parsed) return;
        const before = change.before as { settings?: string } | undefined;
        if (change.kind === "create") { const x = await deleteWebPixel(admin, parsed.id); if (errs("webPixelDelete", x.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (!before?.settings) return skip("no before settings");
        const settings = JSON.parse(before.settings) as Record<string, unknown>;
        const current = await getWebPixel(admin);
        const x = current ? await updateWebPixel(admin, current.id, settings) : await createWebPixel(admin, settings);
        if (errs("webPixel restore", x.userErrors)) changes.push({ resource: change.resource, kind: change.kind === "delete" ? "create" : "update", before: change.after, after: before });
        return;
      }
      case "inventory": {
        // inventory:<inventoryItemId>:<locationId>:<name>; before.quantity restores the absolute value.
        const parsed = parseResource(change.resource, "inventory", 2);
        const before = change.before as { quantity?: number; productId?: string; variantId?: string } | undefined;
        if (!parsed || before?.quantity === undefined) return skip("no before quantity");
        const [locationId, name] = parsed.tail;
        const locationGid = `gid://shopify/${locationId}`;
        let current = (change.after as { quantity?: number } | undefined)?.quantity ?? 0;
        if (before.productId) {
          try { const inv = await getProductInventory(admin, before.productId, [name!]); const row = inv.rows.find((x) => x.inventoryItemId === parsed.id && x.locationId === locationGid); if (row) current = row.quantities[name!] ?? current; } catch { /* keep the recorded after value */ }
        }
        const r = await setInventoryQuantities(admin, { name: name as "available" | "on_hand", reason: "correction", quantities: [{ inventoryItemId: parsed.id, locationId: locationGid, quantity: before.quantity, changeFromQuantity: current }] });
        if (errs("inventorySetQuantities", r.userErrors)) changes.push({ resource: change.resource, kind: "update", before: change.after, after: change.before });
        return;
      }
      case "market": {
        const parsed = parseResource(change.resource, "market");
        if (!parsed) return;
        if (change.kind === "create") { const r = await deleteMarket(admin, parsed.id); if (errs("marketDelete", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (change.kind === "update") { const before = change.before as { name?: string; handle?: string; status?: "ACTIVE" | "DRAFT" } | undefined; if (!before) return skip("no before-image"); const r = await updateMarket(admin, parsed.id, before); if (errs("marketUpdate", r.userErrors)) changes.push({ resource: change.resource, kind: "update", before: change.after, after: before }); return; }
        return skip("market deletes cannot be reversed (web presences and catalogs are gone)");
      }
      case "locale": {
        const parsed = parseResource(change.resource, "locale");
        if (!parsed) return;
        if (change.kind === "create") { const r = await disableShopLocale(admin, parsed.id); if (errs("shopLocaleDisable", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (change.kind === "publish") { const before = change.before as { published?: boolean } | undefined; if (before?.published === undefined) return skip("no before-image"); const r = await updateShopLocale(admin, parsed.id, { published: before.published }); if (errs("shopLocaleUpdate", r.userErrors)) changes.push({ resource: change.resource, kind: "publish", before: change.after, after: before }); return; }
        return skip("re-enabling a disabled locale does not restore its translations");
      }
      case "translation": {
        // translation:<resourceId>:<locale>:<key>
        const parsed = parseResource(change.resource, "translation", 2);
        if (!parsed) return;
        const [locale, key] = parsed.tail;
        const before = change.before as { value?: string; digest?: string; marketId?: string } | undefined;
        if (change.kind === "create") { const r = await removeTranslations(admin, parsed.id, [key!], [locale!], before?.marketId ? [before.marketId] : undefined); if (errs("translationsRemove", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (!before?.value) return skip("no before value");
        const current = await getTranslatableResource(admin, parsed.id);
        const digest = current?.content.find((c) => c.key === key)?.digest ?? before.digest;
        if (!digest) return skip("resource no longer translatable");
        const r = await registerTranslations(admin, parsed.id, [{ key: key!, value: before.value, locale: locale!, translatableContentDigest: digest, marketId: before.marketId }]);
        if (errs("translationsRegister", r.userErrors)) changes.push({ resource: change.resource, kind: change.kind === "delete" ? "create" : "update", before: change.after, after: before });
        return;
      }
      case "catalog": {
        const parsed = parseResource(change.resource, "catalog");
        if (!parsed) return;
        if (change.kind === "create") { const r = await deleteCatalog(admin, parsed.id); if (errs("catalogDelete", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        return skip("catalog updates/deletes are not reversed automatically");
      }
      case "price_list": {
        const parsed = parseResource(change.resource, "price_list");
        if (!parsed) return;
        if (change.kind === "create") { const r = await deletePriceList(admin, parsed.id); if (errs("priceListDelete", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        return skip("price list deletes are not reversed automatically");
      }
      case "price_list_price": {
        // price_list_price:<priceListId>:<variantId>
        const parsed = parseResource(change.resource, "price_list_price", 1);
        if (!parsed) return;
        const variantId = `gid://shopify/${parsed.tail[0]!}`;
        const before = change.before as { price?: { amount: string; currencyCode: string }; compareAtPrice?: { amount: string; currencyCode: string } | null } | undefined;
        if (change.kind === "create") { const r = await deletePriceListFixedPrices(admin, parsed.id, [variantId]); if (errs("priceListFixedPricesDelete", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (!before?.price) return skip("no before price");
        const r = await addPriceListFixedPrices(admin, parsed.id, [{ variantId, price: before.price, compareAtPrice: before.compareAtPrice ?? undefined }]);
        if (errs("priceListFixedPricesAdd", r.userErrors)) changes.push({ resource: change.resource, kind: change.kind === "delete" ? "create" : "update", before: change.after, after: before });
        void listPriceLists;
        return;
      }
      case "discount": {
        const parsed = parseResource(change.resource, "discount");
        if (!parsed) return;
        const after = change.after as { method?: "CODE" | "AUTOMATIC" } | undefined;
        const before = change.before as { status?: string; method?: "CODE" | "AUTOMATIC" } | undefined;
        const method = after?.method ?? before?.method ?? (parsed.id.includes("Automatic") ? "AUTOMATIC" : "CODE");
        if (change.kind === "create") { const r = await deleteDiscount(admin, parsed.id, method); if (errs("discount delete", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        if (change.kind === "update" && before?.status) { const r = await setDiscountActive(admin, parsed.id, method, before.status === "ACTIVE" || before.status === "SCHEDULED"); if (errs("discount status", r.userErrors)) changes.push({ resource: change.resource, kind: "update", before: change.after, after: before }); return; }
        return skip("deleted discounts cannot be recreated with their usage history");
      }
      case "order": {
        const parsed = parseResource(change.resource, "order");
        if (!parsed) return;
        const before = change.before as { note?: string | null; tags?: string[]; email?: string | null } | undefined;
        if (!before || (before.note === undefined && before.tags === undefined)) return skip("only note/tags/email updates are reversible");
        if (deps.verifyFingerprints && change.fingerprintAfter) {
          const current = await getOrder(admin, parsed.id);
          const fp = fingerprint({ note: current?.note, tags: current?.tags });
          if (fp !== change.fingerprintAfter && !deps.force) throw new ShopManagerAIError("FINGERPRINT_MISMATCH", `${change.resource} changed since the operation; refusing to overwrite.`, { details: { resource: change.resource, expected: change.fingerprintAfter, actual: fp } });
        }
        const r = await updateOrder(admin, parsed.id, { note: before.note ?? undefined, tags: before.tags, email: before.email ?? undefined });
        if (errs("orderUpdate", r.userErrors)) changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
        return;
      }
      case "draft_order": {
        const parsed = parseResource(change.resource, "draft_order");
        if (!parsed) return;
        if (change.kind === "create") { const r = await deleteDraftOrder(admin, parsed.id); if (errs("draftOrderDelete", r.userErrors)) changes.push({ resource: change.resource, kind: "delete", before: change.after }); return; }
        return skip("completed/updated draft orders are not reversed automatically");
      }
      case "customer": {
        const parsed = parseResource(change.resource, "customer");
        if (!parsed) return;
        const before = change.before as { tags?: string[]; note?: string | null } | undefined;
        if (change.kind !== "update" || !before) return skip("customer records cannot be deleted through the API; only tag/note updates are reversible");
        void getCustomer;
        const r = await updateCustomer(admin, parsed.id, { tags: before.tags, note: before.note ?? undefined });
        if (errs("customerUpdate", r.userErrors)) changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
        return;
      }
    }
  }

  private async deleteCreated(change: Change, changes: Change[], warnings: string[], del: () => Promise<{ userErrors: Array<{ message: string }> }>): Promise<void> {
    const { userErrors } = await del();
    if (userErrors.length > 0) {
      warnings.push(`Delete rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
      return;
    }
    changes.push({ resource: change.resource, kind: "delete", before: change.after });
  }

  private async restoreViaFields(
    change: Change,
    changes: Change[],
    warnings: string[],
    deps: RollbackExecuteDeps,
    io: { fetch: () => Promise<Record<string, unknown> | null>; restore: (fields: Record<string, unknown>) => Promise<{ userErrors: Array<{ message: string }> }> },
  ): Promise<void> {
    const before = change.before as Record<string, unknown> | undefined;
    if (before === undefined) {
      warnings.push(`No before-image captured for ${change.resource}; skipped.`);
      return;
    }
    const keys = Object.keys(before);
    if (deps.verifyFingerprints && change.fingerprintAfter) {
      const current = await io.fetch();
      const currentFp = fingerprintSubset(current, keys);
      if (currentFp !== change.fingerprintAfter && !deps.force) {
        throw new ShopManagerAIError("FINGERPRINT_MISMATCH", `${change.resource} changed since the operation; refusing to overwrite.`, {
          details: { resource: change.resource, expected: change.fingerprintAfter, actual: currentFp },
        });
      }
    }
    const { userErrors } = await io.restore(before);
    if (userErrors.length > 0) warnings.push(`Rollback errors for ${change.resource}: ${userErrors.map((e) => e.message).join("; ")}`);
    changes.push({ resource: change.resource, kind: "update", before: change.after, after: before });
  }
}
