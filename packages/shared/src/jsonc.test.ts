import { describe, expect, it } from "vitest";
import { parseThemeJson, stripJsonComments } from "./jsonc.js";

describe("parseThemeJson", () => {
  it("parses Dawn-style templates that open with a block comment", () => {
    const text = `/*\n * ------------------------------------------------------------\n * IMPORTANT: The contents of this file are auto-generated.\n * ------------------------------------------------------------\n */\n{\n  "sections": { "main": { "type": "main-product", "blocks": {} } },\n  "order": ["main"]\n}`;
    const json = parseThemeJson<{ order: string[] }>(text);
    expect(json.order).toEqual(["main"]);
  });
  it("strips line comments but preserves comment-like text inside strings", () => {
    const text = `{ // trailing\n "url": "https://example.com/path", "note": "a /* not a comment */ b" }`;
    const json = parseThemeJson<{ url: string; note: string }>(text);
    expect(json.url).toBe("https://example.com/path");
    expect(json.note).toBe("a /* not a comment */ b");
  });
  it("handles escaped quotes inside strings", () => {
    expect(stripJsonComments('{"a":"say \\"hi\\" // not comment"}')).toBe('{"a":"say \\"hi\\" // not comment"}');
  });
  it("still throws on genuinely invalid JSON", () => {
    expect(() => parseThemeJson("{ nope }")).toThrow();
  });
});
