/**
 * Fake handlers for the Phase 2 operations in operations/catalog-extra.ts.
 * Called from FakeAdminClient.dispatch before the original switch so tests and
 * demo mode cover the new tools without touching the main dispatcher.
 */
import type { FakeAdminStore } from "./fake.js";

function nextId(store: FakeAdminStore, kind: string): string {
  const n = (store.counters[kind] ?? 0) + 1;
  store.counters[kind] = n;
  return String(n);
}
const gid = (type: string, id: string) => `gid://shopify/${type}/${id}`;
const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function dispatchCatalogExtra(s: FakeAdminStore, name: string, vars: Record<string, any>): unknown | undefined {
  switch (name) {
    case "ProductDuplicate": {
      const src = s.products.get(vars.productId);
      if (!src) return { productDuplicate: { newProduct: null, userErrors: [{ field: ["productId"], message: "Product not found." }] } };
      const id = nextId(s, "product");
      const pid = gid("Product", id);
      const variantIds = src.variantIds.map((vid) => {
        const v = s.variants.get(vid)!;
        const nv = gid("ProductVariant", nextId(s, "variant"));
        s.variants.set(nv, { ...v, id: nv, productId: pid });
        return nv;
      });
      s.products.set(pid, { ...src, id: pid, title: vars.newTitle, handle: slug(vars.newTitle), status: vars.newStatus ?? "DRAFT", variantIds, mediaIds: vars.includeImages === false ? [] : [...src.mediaIds], collectionIds: [], publicationIds: new Set(), updatedAt: new Date().toISOString() });
      return { productDuplicate: { newProduct: { id: pid, title: vars.newTitle, handle: slug(vars.newTitle), status: vars.newStatus ?? "DRAFT" }, userErrors: [] } };
    }
    case "ProductVariantsBulkCreate": {
      const p = s.products.get(vars.productId);
      if (!p) return { productVariantsBulkCreate: { productVariants: [], userErrors: [{ field: ["productId"], message: "Product not found." }] } };
      const created = (vars.variants as any[]).map((vi) => {
        const id = gid("ProductVariant", nextId(s, "variant"));
        const title = (vi.optionValues ?? []).map((o: any) => o.name).join(" / ") || "Default Title";
        const v = { id, productId: p.id, title, sku: vi.inventoryItem?.sku, price: vi.price ?? "0.00", compareAtPrice: vi.compareAtPrice ?? undefined, barcode: vi.barcode, inventoryQuantity: 0, selectedOptions: (vi.optionValues ?? []).map((o: any) => ({ name: o.optionName, value: o.name })) };
        s.variants.set(id, v);
        p.variantIds.push(id);
        return { id, title, sku: v.sku ?? null, price: v.price, compareAtPrice: v.compareAtPrice ?? null, barcode: v.barcode ?? null };
      });
      return { productVariantsBulkCreate: { productVariants: created, userErrors: [] } };
    }
    case "ProductVariantsBulkDelete": {
      const p = s.products.get(vars.productId);
      if (!p) return { productVariantsBulkDelete: { product: null, userErrors: [{ field: ["productId"], message: "Product not found." }] } };
      for (const vid of vars.variantsIds as string[]) {
        s.variants.delete(vid);
        p.variantIds = p.variantIds.filter((x) => x !== vid);
      }
      return { productVariantsBulkDelete: { product: { id: p.id }, userErrors: [] } };
    }
    case "CollectionRemoveProducts": {
      const c = s.collections.get(vars.id);
      if (!c) return { collectionRemoveProducts: { job: null, userErrors: [{ field: ["id"], message: "Collection not found." }] } };
      const remove = new Set(vars.productIds as string[]);
      c.productIds = c.productIds.filter((pid) => !remove.has(pid));
      for (const pid of remove) {
        const p = s.products.get(pid);
        if (p) p.collectionIds = p.collectionIds.filter((x) => x !== c.id);
      }
      return { collectionRemoveProducts: { job: { id: gid("Job", nextId(s, "job")) }, userErrors: [] } };
    }
    case "BlogCreate": {
      const id = gid("Blog", nextId(s, "blog"));
      const blog = { id, title: vars.blog.title, handle: vars.blog.handle ?? slug(vars.blog.title) };
      s.blogs.set(id, blog);
      return { blogCreate: { blog, userErrors: [] } };
    }
    case "BlogUpdate": {
      const b = s.blogs.get(vars.id);
      if (!b) return { blogUpdate: { blog: null, userErrors: [{ field: ["id"], message: "Blog not found." }] } };
      if (vars.blog.title !== undefined) b.title = vars.blog.title;
      if (vars.blog.handle !== undefined) b.handle = vars.blog.handle;
      return { blogUpdate: { blog: { ...b }, userErrors: [] } };
    }
    case "MenuCreate": {
      const id = gid("Menu", nextId(s, "menu"));
      const items = (vars.items as any[]).map((it, i) => ({ id: gid("MenuItem", nextId(s, "menuItem")), title: it.title, type: it.type, url: it.url, resourceId: it.resourceId, tags: it.tags, items: (it.items ?? []).map((sub: any) => ({ id: gid("MenuItem", nextId(s, "menuItem")), title: sub.title, type: sub.type, url: sub.url, resourceId: sub.resourceId, tags: sub.tags, items: [] })) }));
      void items;
      s.menus.set(id, { id, handle: vars.handle, title: vars.title, items });
      return { menuCreate: { menu: { id, handle: vars.handle, title: vars.title }, userErrors: [] } };
    }
    case "MenuDelete": {
      const existed = s.menus.delete(vars.id);
      return { menuDelete: { deletedMenuId: existed ? vars.id : null, userErrors: existed ? [] : [{ field: ["id"], message: "Menu not found." }] } };
    }
    case "FileDelete": {
      const deleted: string[] = [];
      for (const fid of vars.fileIds as string[]) if (s.files.delete(fid)) deleted.push(fid);
      return { fileDelete: { deletedFileIds: deleted, userErrors: deleted.length === (vars.fileIds as string[]).length ? [] : [{ field: ["fileIds"], message: "Some files were not found." }] } };
    }
    case "MetafieldDefinitionCreate": {
      const d = vars.definition;
      if (s.metafieldDefinitions.some((x) => x.namespace === d.namespace && x.key === d.key && x.ownerType === d.ownerType)) {
        return { metafieldDefinitionCreate: { createdDefinition: null, userErrors: [{ field: ["definition", "key"], message: "Key is in use for this namespace and owner type.", code: "TAKEN" }] } };
      }
      const def = { id: gid("MetafieldDefinition", nextId(s, "metafieldDefinition")), namespace: d.namespace, key: d.key, name: d.name, type: d.type, ownerType: d.ownerType };
      s.metafieldDefinitions.push(def);
      return { metafieldDefinitionCreate: { createdDefinition: { ...def, type: { name: def.type } }, userErrors: [] } };
    }
    case "MetafieldDefinitionUpdate": {
      const d = vars.definition;
      const def = s.metafieldDefinitions.find((x) => x.namespace === d.namespace && x.key === d.key && x.ownerType === d.ownerType);
      if (!def) return { metafieldDefinitionUpdate: { updatedDefinition: null, userErrors: [{ field: ["definition"], message: "Definition not found.", code: "NOT_FOUND" }] } };
      if (d.name !== undefined) def.name = d.name;
      return { metafieldDefinitionUpdate: { updatedDefinition: { id: def.id, name: def.name, namespace: def.namespace, key: def.key, ownerType: def.ownerType }, userErrors: [] } };
    }
    case "MetaobjectDefinitionCreate": {
      const d = vars.definition;
      if (s.metaobjectDefinitions.some((x) => x.type === d.type)) return { metaobjectDefinitionCreate: { metaobjectDefinition: null, userErrors: [{ field: ["definition", "type"], message: "Type already exists.", code: "TAKEN" }] } };
      const def = { id: gid("MetaobjectDefinition", nextId(s, "metaobjectDefinition")), type: d.type, name: d.name, fieldDefinitions: (d.fieldDefinitions as any[]).map((f) => ({ key: f.key, name: f.name, type: f.type })) };
      s.metaobjectDefinitions.push(def);
      return { metaobjectDefinitionCreate: { metaobjectDefinition: { ...def, fieldDefinitions: def.fieldDefinitions.map((f) => ({ key: f.key, name: f.name, type: { name: f.type } })) }, userErrors: [] } };
    }
    case "MetaobjectDefinitionUpdate": {
      const def = s.metaobjectDefinitions.find((x) => x.id === vars.id);
      if (!def) return { metaobjectDefinitionUpdate: { metaobjectDefinition: null, userErrors: [{ field: ["id"], message: "Definition not found.", code: "NOT_FOUND" }] } };
      if (vars.definition.name !== undefined) def.name = vars.definition.name;
      for (const op of (vars.definition.fieldDefinitions ?? []) as any[]) {
        if (op.create) def.fieldDefinitions.push({ key: op.create.key, name: op.create.name, type: op.create.type });
        if (op.delete) def.fieldDefinitions = def.fieldDefinitions.filter((f) => f.key !== op.delete.key);
        if (op.update) {
          const f = def.fieldDefinitions.find((x) => x.key === op.update.key);
          if (f && op.update.name) f.name = op.update.name;
        }
      }
      return { metaobjectDefinitionUpdate: { metaobjectDefinition: { id: def.id, type: def.type, name: def.name }, userErrors: [] } };
    }
    case "MetaobjectDelete": {
      for (const [type, list] of s.metaobjects) {
        const idx = list.findIndex((m) => m.id === vars.id);
        if (idx >= 0) {
          list.splice(idx, 1);
          void type;
          return { metaobjectDelete: { deletedId: vars.id, userErrors: [] } };
        }
      }
      return { metaobjectDelete: { deletedId: null, userErrors: [{ field: ["id"], message: "Metaobject not found.", code: "NOT_FOUND" }] } };
    }
    default:
      return undefined;
  }
}
