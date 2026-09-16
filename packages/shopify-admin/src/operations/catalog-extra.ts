/**
 * Phase 2 catalog/content operations that the original layer left out:
 * product duplicate, variant create/delete, collection remove-products, blog
 * create/update, menu create/delete, file delete, metafield/metaobject
 * definitions, metaobject delete. Same conventions as the sibling modules.
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

const gidOf = (type: string, id: string) => (id.startsWith("gid://") ? id : `gid://shopify/${type}/${id}`);

// ---------------------------------------------------------------------------
// Products / variants
// ---------------------------------------------------------------------------
export const PRODUCT_DUPLICATE_MUTATION = /* GraphQL */ `
  mutation ProductDuplicate($productId: ID!, $newTitle: String!, $newStatus: ProductStatus, $includeImages: Boolean) {
    productDuplicate(productId: $productId, newTitle: $newTitle, newStatus: $newStatus, includeImages: $includeImages) {
      newProduct {
        id
        title
        handle
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export async function duplicateProduct(client: AdminClient, input: { productId: string; newTitle: string; newStatus?: "ACTIVE" | "DRAFT" | "ARCHIVED"; includeImages?: boolean }): Promise<{ product?: { id: string; title: string; handle: string; status: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ productDuplicate: { newProduct?: { id: string; title: string; handle: string; status: string } | null; userErrors: UserError[] } }>(
    PRODUCT_DUPLICATE_MUTATION,
    { productId: gidOf("Product", input.productId), newTitle: input.newTitle, newStatus: input.newStatus ?? "DRAFT", includeImages: input.includeImages ?? true },
    { cost: 20 },
  );
  return { product: result.data.productDuplicate.newProduct ?? undefined, userErrors: result.data.productDuplicate.userErrors };
}

export const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = /* GraphQL */ `
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
      productVariants {
        id
        title
        sku
        price
        compareAtPrice
        barcode
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export interface VariantCreateInput {
  optionValues: Array<{ optionName: string; name: string }>;
  price?: string;
  compareAtPrice?: string;
  sku?: string;
  barcode?: string;
}
export async function createProductVariants(client: AdminClient, productId: string, variants: VariantCreateInput[], strategy: "DEFAULT" | "REMOVE_STANDALONE_VARIANT" = "REMOVE_STANDALONE_VARIANT"): Promise<{ variants: Array<{ id: string; title: string; sku?: string | null; price?: string; compareAtPrice?: string | null; barcode?: string | null }>; userErrors: UserError[] }> {
  const payload = variants.map((v) => ({ optionValues: v.optionValues, price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode, ...(v.sku !== undefined ? { inventoryItem: { sku: v.sku } } : {}) }));
  const result = await client.mutate<{ productVariantsBulkCreate: { productVariants?: Array<{ id: string; title: string; sku?: string | null; price?: string; compareAtPrice?: string | null; barcode?: string | null }> | null; userErrors: UserError[] } }>(
    PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
    { productId: gidOf("Product", productId), variants: payload, strategy },
    { cost: 20 },
  );
  return { variants: result.data.productVariantsBulkCreate.productVariants ?? [], userErrors: result.data.productVariantsBulkCreate.userErrors };
}

export const PRODUCT_VARIANTS_BULK_DELETE_MUTATION = /* GraphQL */ `
  mutation ProductVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export async function deleteProductVariants(client: AdminClient, productId: string, variantIds: string[]): Promise<{ userErrors: UserError[] }> {
  const result = await client.mutate<{ productVariantsBulkDelete: { product?: { id: string } | null; userErrors: UserError[] } }>(
    PRODUCT_VARIANTS_BULK_DELETE_MUTATION,
    { productId: gidOf("Product", productId), variantsIds: variantIds.map((v) => gidOf("ProductVariant", v)) },
    { cost: 10 },
  );
  return { userErrors: result.data.productVariantsBulkDelete.userErrors };
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
export const COLLECTION_REMOVE_PRODUCTS_MUTATION = /* GraphQL */ `
  mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export async function collectionRemoveProducts(client: AdminClient, id: string, productIds: string[]): Promise<{ jobId?: string; userErrors: UserError[] }> {
  const result = await client.mutate<{ collectionRemoveProducts: { job?: { id: string } | null; userErrors: UserError[] } }>(
    COLLECTION_REMOVE_PRODUCTS_MUTATION,
    { id: gidOf("Collection", id), productIds: productIds.map((p) => gidOf("Product", p)) },
    { cost: 10 },
  );
  return { jobId: result.data.collectionRemoveProducts.job?.id, userErrors: result.data.collectionRemoveProducts.userErrors };
}

// ---------------------------------------------------------------------------
// Blogs
// ---------------------------------------------------------------------------
export const BLOG_CREATE_MUTATION = /* GraphQL */ `
  mutation BlogCreate($blog: BlogCreateInput!) {
    blogCreate(blog: $blog) {
      blog {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export async function createBlog(client: AdminClient, input: { title: string; handle?: string; commentPolicy?: "MODERATED" | "CLOSED" | "AUTO_PUBLISHED" }): Promise<{ blog?: { id: string; title: string; handle: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ blogCreate: { blog?: { id: string; title: string; handle: string } | null; userErrors: UserError[] } }>(BLOG_CREATE_MUTATION, { blog: input }, { cost: 10 });
  return { blog: result.data.blogCreate.blog ?? undefined, userErrors: result.data.blogCreate.userErrors };
}

export const BLOG_UPDATE_MUTATION = /* GraphQL */ `
  mutation BlogUpdate($id: ID!, $blog: BlogUpdateInput!) {
    blogUpdate(id: $id, blog: $blog) {
      blog {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export async function updateBlog(client: AdminClient, id: string, input: { title?: string; handle?: string; commentPolicy?: "MODERATED" | "CLOSED" | "AUTO_PUBLISHED" }): Promise<{ blog?: { id: string; title: string; handle: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ blogUpdate: { blog?: { id: string; title: string; handle: string } | null; userErrors: UserError[] } }>(BLOG_UPDATE_MUTATION, { id: gidOf("Blog", id), blog: input }, { cost: 10 });
  return { blog: result.data.blogUpdate.blog ?? undefined, userErrors: result.data.blogUpdate.userErrors };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------
export const MENU_CREATE_MUTATION = /* GraphQL */ `
  mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;
export interface MenuItemCreate {
  title: string;
  type: string;
  url?: string;
  resourceId?: string;
  tags?: string[];
  items?: MenuItemCreate[];
}
export async function createMenu(client: AdminClient, input: { title: string; handle: string; items: MenuItemCreate[] }): Promise<{ menu?: { id: string; handle: string; title: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ menuCreate: { menu?: { id: string; handle: string; title: string } | null; userErrors: UserError[] } }>(MENU_CREATE_MUTATION, input, { cost: 10 });
  return { menu: result.data.menuCreate.menu ?? undefined, userErrors: result.data.menuCreate.userErrors };
}

export const MENU_DELETE_MUTATION = /* GraphQL */ `
  mutation MenuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors {
        field
        message
      }
    }
  }
`;
export async function deleteMenu(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const result = await client.mutate<{ menuDelete: { deletedMenuId?: string | null; userErrors: UserError[] } }>(MENU_DELETE_MUTATION, { id: gidOf("Menu", id) }, { cost: 10 });
  return { deletedId: result.data.menuDelete.deletedMenuId ?? undefined, userErrors: result.data.menuDelete.userErrors };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export const FILE_DELETE_MUTATION = /* GraphQL */ `
  mutation FileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors {
        field
        message
      }
    }
  }
`;
export async function deleteFiles(client: AdminClient, fileIds: string[]): Promise<{ deletedIds: string[]; userErrors: UserError[] }> {
  const result = await client.mutate<{ fileDelete: { deletedFileIds?: string[] | null; userErrors: UserError[] } }>(FILE_DELETE_MUTATION, { fileIds }, { cost: 10 });
  return { deletedIds: result.data.fileDelete.deletedFileIds ?? [], userErrors: result.data.fileDelete.userErrors };
}

// ---------------------------------------------------------------------------
// Metafield definitions
// ---------------------------------------------------------------------------
export const METAFIELD_DEFINITION_CREATE_MUTATION = /* GraphQL */ `
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
        type {
          name
        }
        ownerType
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
export interface MetafieldDefinitionCreateInput {
  name: string;
  namespace: string;
  key: string;
  type: string;
  ownerType: string;
  description?: string;
  pin?: boolean;
  access?: { storefront?: "PUBLIC_READ" | "NONE"; admin?: "MERCHANT_READ" | "MERCHANT_READ_WRITE" };
  validations?: Array<{ name: string; value: string }>;
}
export async function createMetafieldDefinition(client: AdminClient, definition: MetafieldDefinitionCreateInput): Promise<{ definition?: { id: string; name: string; namespace: string; key: string; type: { name: string }; ownerType: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ metafieldDefinitionCreate: { createdDefinition?: { id: string; name: string; namespace: string; key: string; type: { name: string }; ownerType: string } | null; userErrors: UserError[] } }>(METAFIELD_DEFINITION_CREATE_MUTATION, { definition }, { cost: 10 });
  return { definition: result.data.metafieldDefinitionCreate.createdDefinition ?? undefined, userErrors: result.data.metafieldDefinitionCreate.userErrors };
}

export const METAFIELD_DEFINITION_UPDATE_MUTATION = /* GraphQL */ `
  mutation MetafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
        name
        namespace
        key
        ownerType
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
export async function updateMetafieldDefinition(client: AdminClient, definition: { namespace: string; key: string; ownerType: string; name?: string; description?: string; pin?: boolean; access?: MetafieldDefinitionCreateInput["access"]; validations?: Array<{ name: string; value: string }> }): Promise<{ definition?: { id: string; name: string; namespace: string; key: string; ownerType: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ metafieldDefinitionUpdate: { updatedDefinition?: { id: string; name: string; namespace: string; key: string; ownerType: string } | null; userErrors: UserError[] } }>(METAFIELD_DEFINITION_UPDATE_MUTATION, { definition }, { cost: 10 });
  return { definition: result.data.metafieldDefinitionUpdate.updatedDefinition ?? undefined, userErrors: result.data.metafieldDefinitionUpdate.userErrors };
}

// ---------------------------------------------------------------------------
// Metaobject definitions + delete
// ---------------------------------------------------------------------------
export const METAOBJECT_DEFINITION_CREATE_MUTATION = /* GraphQL */ `
  mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
        name
        fieldDefinitions {
          key
          name
          type {
            name
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
export interface MetaobjectFieldDefinitionInput {
  key: string;
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}
export interface MetaobjectDefinitionCreateInput {
  type: string;
  name: string;
  description?: string;
  fieldDefinitions: MetaobjectFieldDefinitionInput[];
  access?: { storefront?: "PUBLIC_READ" | "NONE"; admin?: "MERCHANT_READ" | "MERCHANT_READ_WRITE" };
  capabilities?: { publishable?: { enabled: boolean }; translatable?: { enabled: boolean }; renderable?: { enabled: boolean } };
  displayNameKey?: string;
}
export async function createMetaobjectDefinition(client: AdminClient, definition: MetaobjectDefinitionCreateInput): Promise<{ definition?: { id: string; type: string; name: string; fieldDefinitions: Array<{ key: string; name: string; type: { name: string } }> }; userErrors: UserError[] }> {
  const result = await client.mutate<{ metaobjectDefinitionCreate: { metaobjectDefinition?: { id: string; type: string; name: string; fieldDefinitions: Array<{ key: string; name: string; type: { name: string } }> } | null; userErrors: UserError[] } }>(METAOBJECT_DEFINITION_CREATE_MUTATION, { definition }, { cost: 10 });
  return { definition: result.data.metaobjectDefinitionCreate.metaobjectDefinition ?? undefined, userErrors: result.data.metaobjectDefinitionCreate.userErrors };
}

export const METAOBJECT_DEFINITION_UPDATE_MUTATION = /* GraphQL */ `
  mutation MetaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
        type
        name
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
export async function updateMetaobjectDefinition(client: AdminClient, id: string, definition: { name?: string; description?: string; fieldDefinitions?: Array<{ create?: MetaobjectFieldDefinitionInput; update?: { key: string; name?: string; description?: string; required?: boolean }; delete?: { key: string } }>; access?: MetaobjectDefinitionCreateInput["access"]; capabilities?: MetaobjectDefinitionCreateInput["capabilities"]; displayNameKey?: string }): Promise<{ definition?: { id: string; type: string; name: string }; userErrors: UserError[] }> {
  const result = await client.mutate<{ metaobjectDefinitionUpdate: { metaobjectDefinition?: { id: string; type: string; name: string } | null; userErrors: UserError[] } }>(METAOBJECT_DEFINITION_UPDATE_MUTATION, { id: gidOf("MetaobjectDefinition", id), definition }, { cost: 10 });
  return { definition: result.data.metaobjectDefinitionUpdate.metaobjectDefinition ?? undefined, userErrors: result.data.metaobjectDefinitionUpdate.userErrors };
}

export const METAOBJECT_DELETE_MUTATION = /* GraphQL */ `
  mutation MetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
        code
      }
    }
  }
`;
export async function deleteMetaobject(client: AdminClient, id: string): Promise<{ deletedId?: string; userErrors: UserError[] }> {
  const result = await client.mutate<{ metaobjectDelete: { deletedId?: string | null; userErrors: UserError[] } }>(METAOBJECT_DELETE_MUTATION, { id: gidOf("Metaobject", id) }, { cost: 10 });
  return { deletedId: result.data.metaobjectDelete.deletedId ?? undefined, userErrors: result.data.metaobjectDelete.userErrors };
}
