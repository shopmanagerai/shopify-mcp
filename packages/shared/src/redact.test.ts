import { describe, expect, it } from "vitest";
import { containsSecret, redactString, redactValue } from "./redact.js";
import { fingerprint, newId } from "./ids.js";

describe("redaction", () => {
  it("masks Shopify and ShopManager AI tokens", () => {
    const s = "token shpat_abcdefghijklmnopqrstuvwxyz123456 and shptka_0123456789abcdefghij and cp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const out = redactString(s);
    expect(out).not.toContain("shpat_");
    expect(out).not.toContain("shptka_");
    expect(out).not.toContain("cp_aaaa");
    expect(containsSecret(s)).toBe(true);
    expect(containsSecret("hello world")).toBe(false);
  });
  it("masks sensitive keys deeply", () => {
    const v = redactValue({ a: { password: "x", nested: [{ accessToken: "y", ok: "fine" }] } });
    expect(v.a.password).toBe("[REDACTED]");
    expect(v.a.nested[0].accessToken).toBe("[REDACTED]");
    expect(v.a.nested[0].ok).toBe("fine");
  });
});

describe("ids", () => {
  it("generates sortable unique ids", () => {
    const a = newId("op");
    const b = newId("op");
    expect(a).not.toBe(b);
    expect(a.startsWith("op_")).toBe(true);
  });
  it("fingerprints stably regardless of key order", () => {
    expect(fingerprint({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(fingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });
});
