import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS_PER_SECTION,
  MAX_SECTIONS_PER_TEMPLATE,
  listAppReferences,
  mergeJsonTemplate,
  mergeSettingsData,
} from "./settings-merge.js";

describe("mergeSettingsData", () => {
  const current = {
    current: {
      settings: { color_primary: "#111111", font: "Helvetica" },
      sections: { hero: { type: "hero", settings: { heading: "Old" } } },
      blocks: {
        klaviyo_embed: { type: "shopify://apps/klaviyo/blocks/onsite/xyz", disabled: false, settings: {} },
        merchant_block: { type: "text", settings: { text: "hi" } },
      },
    },
  };

  it("deep-merges settings and sections", () => {
    const patch = { current: { settings: { color_primary: "#222222" }, sections: { hero: { settings: { heading: "New" } } } } };
    const merged = mergeSettingsData(current, patch);
    expect((merged.current as any).settings).toEqual({ color_primary: "#222222", font: "Helvetica" });
    expect((merged.current as any).sections.hero.settings.heading).toBe("New");
  });

  it("preserves app-embed blocks the patch does not target", () => {
    const patch = { current: { settings: { color_primary: "#222222" } } };
    const merged = mergeSettingsData(current, patch);
    expect((merged.current as any).blocks.klaviyo_embed).toEqual(current.current.blocks.klaviyo_embed);
  });

  it("allows the patch to explicitly modify an app-embed block by id", () => {
    const patch = { current: { blocks: { klaviyo_embed: { disabled: true } } } };
    const merged = mergeSettingsData(current, patch);
    expect((merged.current as any).blocks.klaviyo_embed.disabled).toBe(true);
    expect((merged.current as any).blocks.klaviyo_embed.type).toBe("shopify://apps/klaviyo/blocks/onsite/xyz");
  });

  it("merges non-app-ref blocks normally", () => {
    const patch = { current: { blocks: { merchant_block: { settings: { text: "bye" } } } } };
    const merged = mergeSettingsData(current, patch);
    expect((merged.current as any).blocks.merchant_block.settings.text).toBe("bye");
  });

  it("with preserveAppEmbeds:false, an untargeted app block is still carried through (merge never deletes untouched keys)", () => {
    const patch = { current: { settings: { color_primary: "#333333" } } };
    const merged = mergeSettingsData(current, patch, { preserveAppEmbeds: false });
    expect((merged.current as any).blocks.klaviyo_embed).toEqual(current.current.blocks.klaviyo_embed);
  });

  it("adds new blocks introduced by the patch", () => {
    const patch = { current: { blocks: { new_block: { type: "text", settings: { text: "new" } } } } };
    const merged = mergeSettingsData(current, patch);
    expect((merged.current as any).blocks.new_block).toEqual({ type: "text", settings: { text: "new" } });
    expect((merged.current as any).blocks.klaviyo_embed).toBeDefined();
  });
});

describe("mergeJsonTemplate", () => {
  const current = {
    sections: {
      main: {
        type: "main-product",
        blocks: {
          title: { type: "title" },
          review_widget: { type: "shopify://apps/judge-me-reviews/blocks/review-widget/abc123" },
        },
        block_order: ["title", "review_widget"],
      },
    },
    order: ["main"],
  };

  it("preserves app blocks not explicitly targeted by the patch", () => {
    const patch = { sections: { main: { blocks: { title: { settings: { size: "large" } } } } } };
    const merged = mergeJsonTemplate(current, patch);
    const mainBlocks = (merged.sections as any).main.blocks;
    expect(mainBlocks.review_widget).toEqual(current.sections.main.blocks.review_widget);
    expect(mainBlocks.title.settings.size).toBe("large");
  });

  it("allows explicit patch of an app block by id", () => {
    const patch = { sections: { main: { blocks: { review_widget: { type: "shopify://apps/judge-me-reviews/blocks/review-widget/abc123", settings: { theme: "dark" } } } } } };
    const merged = mergeJsonTemplate(current, patch);
    expect((merged.sections as any).main.blocks.review_widget.settings.theme).toBe("dark");
  });

  it("enforces the max-sections-per-template limit", () => {
    const patch: any = { sections: {} };
    for (let i = 0; i < MAX_SECTIONS_PER_TEMPLATE; i++) patch.sections[`extra_${i}`] = { type: "text" };
    expect(() => mergeJsonTemplate(current, patch)).toThrow();
    try {
      mergeJsonTemplate(current, patch);
    } catch (e: any) {
      expect(e.code).toBe("INVALID_INPUT");
    }
  });

  it("enforces the max-blocks-per-section limit", () => {
    const blocks: Record<string, unknown> = {};
    for (let i = 0; i < MAX_BLOCKS_PER_SECTION + 1; i++) blocks[`b${i}`] = { type: "text" };
    const patch = { sections: { main: { blocks } } };
    expect(() => mergeJsonTemplate(current, patch)).toThrow();
  });

  it("stays within limits for a normal merge", () => {
    const patch = { sections: { main: { blocks: { title: { settings: { size: "small" } } } } } };
    expect(() => mergeJsonTemplate(current, patch)).not.toThrow();
  });
});

describe("listAppReferences", () => {
  it("finds app embeds in settings_data.json shape", () => {
    const json = { current: { blocks: { klaviyo: { type: "shopify://apps/klaviyo/blocks/onsite/xyz", disabled: false } } } };
    const refs = listAppReferences(json);
    expect(refs).toEqual([{ location: "settings_data.blocks", blockId: "klaviyo", type: "shopify://apps/klaviyo/blocks/onsite/xyz", disabled: false }]);
  });

  it("finds app blocks in a JSON template shape", () => {
    const json = {
      sections: { main: { blocks: { review_widget: { type: "shopify://apps/judge-me-reviews/blocks/review-widget/abc123" } } } },
    };
    const refs = listAppReferences(json);
    expect(refs).toEqual([{ location: "template.sections.main.blocks", blockId: "review_widget", type: "shopify://apps/judge-me-reviews/blocks/review-widget/abc123" }]);
  });

  it("returns an empty array when there are no app references", () => {
    const json = { current: { blocks: { text_block: { type: "text" } } } };
    expect(listAppReferences(json)).toEqual([]);
  });
});
