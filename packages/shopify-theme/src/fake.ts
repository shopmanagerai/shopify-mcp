/**
 * In-memory ThemeEngine used by tests and the server's demo mode. `seedDawnLike`
 * builds a small Online Store 2.0 theme (docs/CURRENT_SHOPIFY_RESEARCH.md §3)
 * with an app block and an app embed so app-reference-preservation logic has
 * something real to exercise.
 */
import { ShopManagerAIError } from "@shopmanagerai/shared";
import type { ThemeEngine, ThemeFile, ThemeFileWrite, ThemeRef } from "@shopmanagerai/shared";
import { validateThemeKey } from "./paths.js";

interface FakeTheme {
  ref: ThemeRef;
  files: Map<string, ThemeFile>;
}

let nextId = 1;

export class FakeThemeEngine implements ThemeEngine {
  readonly kind = "fake" as const;
  private themes = new Map<string, FakeTheme>();
  private installSources = new Map<string, string>();

  /** Directly seed a theme (used by tests that want full control). */
  addTheme(ref: Partial<ThemeRef> & { name: string; role?: ThemeRef["role"] }, files: ThemeFileWrite[] = []): ThemeRef {
    const id = ref.id ?? String(nextId++);
    const fullRef: ThemeRef = {
      id,
      gid: ref.gid ?? `gid://shopify/OnlineStoreTheme/${id}`,
      name: ref.name,
      role: ref.role ?? "unpublished",
      updatedAt: ref.updatedAt ?? new Date(0).toISOString(),
      processing: ref.processing ?? false,
    };
    const fileMap = new Map<string, ThemeFile>();
    for (const f of files) fileMap.set(f.key, toThemeFile(f));
    this.themes.set(id, { ref: fullRef, files: fileMap });
    return fullRef;
  }

  async listThemes(): Promise<ThemeRef[]> {
    return Array.from(this.themes.values()).map((t) => t.ref);
  }

  async getTheme(themeId: string): Promise<ThemeRef | null> {
    return this.themes.get(themeId)?.ref ?? null;
  }

  async listFiles(themeId: string, opts?: { prefix?: string }): Promise<ThemeFile[]> {
    const theme = this.mustGet(themeId);
    const all = Array.from(theme.files.values());
    if (!opts?.prefix) return all.map((f) => ({ ...f, content: undefined, contentBase64: undefined }));
    return all.filter((f) => f.key.startsWith(opts.prefix!)).map((f) => ({ ...f, content: undefined, contentBase64: undefined }));
  }

  async readFiles(themeId: string, keys: string[]): Promise<ThemeFile[]> {
    const theme = this.mustGet(themeId);
    const out: ThemeFile[] = [];
    for (const key of keys) {
      const f = theme.files.get(key);
      if (f) out.push(f);
    }
    return out;
  }

  async writeFiles(themeId: string, files: ThemeFileWrite[]): Promise<{ written: string[]; errors: Array<{ key: string; message: string }> }> {
    const theme = this.mustGet(themeId);
    const written: string[] = [];
    const errors: Array<{ key: string; message: string }> = [];
    for (const f of files) {
      try {
        validateThemeKey(f.key);
        theme.files.set(f.key, toThemeFile(f));
        written.push(f.key);
      } catch (e: any) {
        errors.push({ key: f.key, message: e.message ?? String(e) });
      }
    }
    theme.ref.updatedAt = new Date().toISOString();
    return { written, errors };
  }

  async deleteFiles(themeId: string, keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
    const theme = this.mustGet(themeId);
    const deleted: string[] = [];
    const errors: Array<{ key: string; message: string }> = [];
    for (const key of keys) {
      if (theme.files.delete(key)) deleted.push(key);
      else errors.push({ key, message: "not found" });
    }
    return { deleted, errors };
  }

  async duplicateTheme(sourceThemeId: string, name: string): Promise<ThemeRef> {
    const source = this.mustGet(sourceThemeId);
    const id = String(nextId++);
    const ref: ThemeRef = {
      id,
      gid: `gid://shopify/OnlineStoreTheme/${id}`,
      name,
      role: "unpublished",
      updatedAt: new Date().toISOString(),
      processing: false,
    };
    const files = new Map<string, ThemeFile>();
    for (const [key, file] of source.files) files.set(key, { ...file });
    this.themes.set(id, { ref, files });
    return ref;
  }

  async publishTheme(themeId: string): Promise<ThemeRef> {
    const theme = this.mustGet(themeId);
    for (const t of this.themes.values()) {
      if (t.ref.role === "main") t.ref.role = "unpublished";
    }
    theme.ref.role = "main";
    return theme.ref;
  }

  async deleteTheme(themeId: string): Promise<void> {
    this.mustGet(themeId);
    this.themes.delete(themeId);
  }

  async renameTheme(themeId: string, name: string): Promise<ThemeRef> {
    const theme = this.mustGet(themeId);
    theme.ref.name = name;
    return theme.ref;
  }

  /**
   * ThemeEngine.createFromUrl fake: no real download happens (there is no
   * network in tests/demo mode). Seeds a new unpublished theme as a copy of
   * an existing theme if one exists (so `shopify.theme.install_from_url` has
   * something realistic to inspect afterward), else an empty theme, tagging
   * it with the source URL for test assertions.
   */
  async createFromUrl(src: string, name: string): Promise<ThemeRef> {
    const existing = Array.from(this.themes.values())[0];
    const id = String(nextId++);
    const files = new Map<string, ThemeFile>();
    if (existing) for (const [key, file] of existing.files) files.set(key, { ...file });
    const ref: ThemeRef = {
      id,
      gid: `gid://shopify/OnlineStoreTheme/${id}`,
      name,
      role: "unpublished",
      updatedAt: new Date().toISOString(),
      processing: false,
    };
    this.themes.set(id, { ref, files });
    this.installSources.set(id, src);
    return ref;
  }

  /** Test helper: the `src` URL a theme was created from via `createFromUrl`, if any. */
  installSourceOf(themeId: string): string | undefined {
    return this.installSources.get(themeId);
  }

  private mustGet(themeId: string): FakeTheme {
    const theme = this.themes.get(themeId);
    if (!theme) throw new ShopManagerAIError("NOT_FOUND", `Theme ${themeId} not found.`);
    return theme;
  }
}

function toThemeFile(f: ThemeFileWrite): ThemeFile {
  return {
    key: f.key,
    content: f.content,
    contentBase64: f.contentBase64,
    size: f.content ? Buffer.byteLength(f.content, "utf8") : f.contentBase64 ? Buffer.from(f.contentBase64, "base64").length : 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Seeds a realistic mini Online Store 2.0 theme onto `engine`, returning the
 * created ThemeRef. Includes an app block in templates/product.json and an
 * app embed in config/settings_data.json so preservation logic has real
 * `shopify://apps/...` references to work with.
 */
export function seedDawnLike(engine: FakeThemeEngine, opts: { name?: string; role?: ThemeRef["role"] } = {}): ThemeRef {
  const files: ThemeFileWrite[] = [
    {
      key: "layout/theme.liquid",
      content: `<!doctype html>
<html>
<head>
  {{ content_for_header }}
</head>
<body>
  {% sections 'header-group' %}
  <main>{{ content_for_layout }}</main>
  {% sections 'footer-group' %}
</body>
</html>
`,
    },
    {
      key: "templates/index.json",
      content: JSON.stringify(
        {
          sections: {
            hero: { type: "hero", settings: { heading: "Welcome" } },
            featured_collection: { type: "featured-collection", settings: { collection: "frontpage" } },
            rich_text: { type: "rich-text", settings: { text: "About us" } },
          },
          order: ["hero", "featured_collection", "rich_text"],
        },
        null,
        2,
      ),
    },
    {
      key: "templates/product.json",
      content: JSON.stringify(
        {
          sections: {
            main: {
              type: "main-product",
              blocks: {
                title: { type: "title" },
                price: { type: "price" },
                review_widget: { type: "shopify://apps/judge-me-reviews/blocks/review-widget/abc123" },
              },
              block_order: ["title", "price", "review_widget"],
            },
          },
          order: ["main"],
        },
        null,
        2,
      ),
    },
    {
      key: "sections/hero.liquid",
      content: `<div class="hero">{{ section.settings.heading }}</div>
{% schema %}
{
  "name": "Hero",
  "settings": [{ "type": "text", "id": "heading", "label": "Heading" }]
}
{% endschema %}
`,
    },
    {
      key: "sections/featured-collection.liquid",
      content: `<div class="featured-collection">{{ section.settings.collection }}</div>
{% schema %}
{
  "name": "Featured collection",
  "settings": [{ "type": "collection", "id": "collection", "label": "Collection" }]
}
{% endschema %}
`,
    },
    {
      key: "sections/rich-text.liquid",
      content: `<div class="rich-text">{{ section.settings.text }}</div>
{% schema %}
{
  "name": "Rich text",
  "settings": [{ "type": "richtext", "id": "text", "label": "Text" }]
}
{% endschema %}
`,
    },
    {
      key: "sections/main-product.liquid",
      content: `<div class="product">
  {% for block in section.blocks %}
    {% case block.type %}
      {% when 'title' %}<h1>{{ product.title }}</h1>
      {% when 'price' %}<span>{{ product.price }}</span>
      {% when '@app' %}{% render block %}
    {% endcase %}
  {% endfor %}
</div>
{% schema %}
{
  "name": "Main product",
  "blocks": [
    { "type": "title", "name": "Title" },
    { "type": "price", "name": "Price" },
    { "type": "@app" }
  ]
}
{% endschema %}
`,
    },
    {
      key: "sections/header-group.json",
      content: JSON.stringify({ type: "header", name: "Header group", sections: {}, order: [] }, null, 2),
    },
    {
      key: "sections/footer-group.json",
      content: JSON.stringify({ type: "footer", name: "Footer group", sections: {}, order: [] }, null, 2),
    },
    {
      key: "snippets/icon-cart.liquid",
      content: `<svg class="icon icon-cart" viewBox="0 0 24 24"></svg>\n`,
    },
    {
      key: "assets/base.css",
      content: `:root { --color-primary: #111; }\nbody { font-family: sans-serif; }\n`,
    },
    {
      key: "config/settings_schema.json",
      content: JSON.stringify(
        [
          { name: "theme_info", theme_name: "Dawn-like", theme_version: "1.0.0" },
          { name: "Colors", settings: [{ type: "color", id: "color_primary", label: "Primary", default: "#111111" }] },
        ],
        null,
        2,
      ),
    },
    {
      key: "config/settings_data.json",
      content: JSON.stringify(
        {
          current: {
            settings: { color_primary: "#111111" },
            blocks: {
              klaviyo_embed: {
                type: "shopify://apps/klaviyo/blocks/onsite/xyz",
                disabled: false,
                settings: {},
              },
            },
            sections: {},
          },
        },
        null,
        2,
      ),
    },
    {
      key: "locales/en.default.json",
      content: JSON.stringify({ general: { title: "Home" } }, null, 2),
    },
  ];

  const ref = engine.addTheme({ name: opts.name ?? "Dawn-like", role: opts.role ?? "main" }, files);
  return ref;
}
