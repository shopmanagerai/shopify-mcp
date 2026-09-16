import { describe, expect, it } from "vitest";
import { validateThemeKey } from "./paths.js";

describe("validateThemeKey", () => {
  it.each([
    "layout/theme.liquid",
    "templates/index.json",
    "templates/product.json",
    "templates/customers/account.liquid",
    "sections/hero.liquid",
    "blocks/text.liquid",
    "snippets/icon-cart.liquid",
    "assets/base.css",
    "assets/theme.js",
    "assets/logo.svg",
    "assets/font.woff2",
    "assets/component.css.liquid",
    "assets/component.js.liquid",
    "assets/component.scss.liquid",
    "config/settings_schema.json",
    "config/settings_data.json",
    "locales/en.default.json",
    "sections/header-group.json",
  ])("accepts a valid key: %s", (key) => {
    expect(validateThemeKey(key)).toBe(key);
  });

  it.each([
    ["../config/settings_data.json", "traversal with leading .."],
    ["assets/../config/settings_data.json", "traversal mid-path"],
    ["assets/..%2f..%2fconfig/settings_data.json", "encoded traversal (still contains ..)"],
    ["..\\config\\settings_data.json", "windows-style traversal with backslashes"],
    ["/etc/passwd", "absolute unix path outside sandbox"],
    ["C:\\Windows\\System32\\config", "absolute windows path"],
    ["assets\\theme.js", "backslash separator"],
    ["assets/theme\0.js", "embedded null byte"],
    ["unknowndir/file.liquid", "unknown top-level directory"],
    ["assets/theme.exe", "disallowed extension"],
    ["assets/theme", "no extension"],
    ["sections/hero.css", "wrong extension for sections"],
    ["config/settings.liquid", "wrong extension for config"],
    ["assets//theme.js", "empty path segment"],
    ["assets/théme*.js", "disallowed characters"],
    ["a".repeat(210), "exceeds max length"],
  ])("rejects: %s (%s)", (key) => {
    expect(() => validateThemeKey(key)).toThrowError();
    try {
      validateThemeKey(key);
    } catch (e: any) {
      expect(e.code).toBe("INVALID_PATH");
    }
  });

  it("rejects an empty string", () => {
    expect(() => validateThemeKey("")).toThrow();
  });

  it("rejects a bare top-level directory with no filename", () => {
    expect(() => validateThemeKey("assets")).toThrow();
    expect(() => validateThemeKey("assets/")).toThrow();
  });

  it("rejects a path exactly at the max length boundary plus one", () => {
    const longName = "a".repeat(196) + ".js"; // dir "assets/" + 199 chars = 206 total incl dir
    const key = `assets/${longName}`;
    expect(key.length).toBeGreaterThan(200);
    expect(() => validateThemeKey(key)).toThrow();
  });

  it("fuzzes a batch of traversal-style inputs and expects INVALID_PATH for all", () => {
    const fuzz = [
      "../../../../etc/passwd",
      "assets/../../../secret.js",
      "snippets/../../config/settings_data.json",
      "templates/..\\..\\config\\settings_data.json",
      "assets/%2e%2e/config/settings_data.json",
      "\u0000assets/theme.js",
      "assets/theme.js\u0000",
    ];
    for (const key of fuzz) {
      let threw = false;
      try {
        validateThemeKey(key);
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe("INVALID_PATH");
      }
      expect(threw).toBe(true);
    }
  });
});
