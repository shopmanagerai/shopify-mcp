/**
 * Online Store navigation menus (docs/CURRENT_SHOPIFY_RESEARCH.md §5
 * "Navigation" row). `menuUpdate` replaces the full item tree. There is no
 * partial-item mutation, so callers must read-modify-write the whole tree.
 */
import type { AdminClient } from "@shopmanagerai/shared";
import type { UserError } from "./collections.js";

export interface MenuItemNode {
  id?: string;
  title: string;
  type: string; // UNVERIFIED: exact MenuItemType enum values beyond FRONTPAGE/HTTP/COLLECTION/PRODUCT/PAGE/CATALOG/SHOP_POLICY/SEARCH/BLOG/ARTICLE
  url?: string;
  resourceId?: string;
  tags?: string[];
  items: MenuItemNode[];
}

export const MENUS_LIST_QUERY = /* GraphQL */ `
  query MenusList($first: Int!, $after: String) {
    menus(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          handle
          title
          items {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface MenuListItem {
  id: string;
  cursor: string;
  handle: string;
  title: string;
  itemsCount?: number;
}

export async function listMenus(client: AdminClient, opts: { first?: number; after?: string } = {}): Promise<{ items: MenuListItem[]; hasNextPage: boolean; endCursor?: string }> {
  const result = await client.query<{
    menus: { edges: Array<{ cursor: string; node: { id: string; handle: string; title: string; items?: Array<{ id: string }> } }>; pageInfo: { hasNextPage: boolean; endCursor?: string } };
  }>(MENUS_LIST_QUERY, { first: opts.first ?? 20, after: opts.after }, { cost: 10 });
  return {
    items: result.data.menus.edges.map((e) => ({ id: e.node.id, handle: e.node.handle, title: e.node.title, itemsCount: e.node.items?.length ?? 0, cursor: e.cursor })),
    hasNextPage: result.data.menus.pageInfo.hasNextPage,
    endCursor: result.data.menus.pageInfo.endCursor,
  };
}

const MENU_ITEM_FIELDS = /* GraphQL */ `
  id
  title
  type
  url
  resourceId
  tags
`;

export const MENU_BY_ID_QUERY = /* GraphQL */ `
  query MenuById($id: ID!) {
    menu(id: $id) {
      id
      handle
      title
      items {
        ${MENU_ITEM_FIELDS}
        items {
          ${MENU_ITEM_FIELDS}
          items {
            ${MENU_ITEM_FIELDS}
          }
        }
      }
    }
  }
`;

export interface MenuDetail {
  id: string;
  handle: string;
  title: string;
  items: MenuItemNode[];
}

export async function getMenu(client: AdminClient, id: string): Promise<MenuDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Menu/${id}`;
  const result = await client.query<{ menu: null | MenuDetail }>(MENU_BY_ID_QUERY, { id: gid }, { cost: 10 });
  return result.data.menu;
}

/** UNVERIFIED: `menuUpdate` item input field names (`MenuItemUpdateInput`), id/title/type/url/resourceId/tags/items assumed by analogy with the read shape. */
export const MENU_UPDATE_MUTATION = /* GraphQL */ `
  mutation MenuUpdate($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
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

export async function updateMenu(client: AdminClient, id: string, items: MenuItemNode[], opts: { title?: string; handle?: string } = {}): Promise<{ menu?: { id: string; handle: string; title: string }; userErrors: UserError[] }> {
  // menuUpdate requires title and handle (String!); keep the current ones when the caller only changes items.
  let { title, handle } = opts;
  if (!title || !handle) {
    const current = await getMenu(client, id);
    if (!current) return { menu: undefined, userErrors: [{ field: ["id"], message: `Menu ${id} not found.` }] };
    title = title ?? current.title;
    handle = handle ?? current.handle;
  }
  const result = await client.mutate<{ menuUpdate: { menu?: { id: string; handle: string; title: string } | null; userErrors: UserError[] } }>(
    MENU_UPDATE_MUTATION,
    { id, title, handle, items },
    { cost: 10 },
  );
  return { menu: result.data.menuUpdate.menu ?? undefined, userErrors: result.data.menuUpdate.userErrors };
}
