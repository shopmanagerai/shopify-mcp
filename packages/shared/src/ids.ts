import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase

/** Time-sortable id: 10 chars of ms timestamp + 16 random chars. */
export function newId(prefix?: string): string {
  const now = Date.now();
  let t = "";
  let n = now;
  for (let i = 0; i < 10; i++) {
    t = ALPHABET[n % 32] + t;
    n = Math.floor(n / 32);
  }
  const bytes = randomBytes(16);
  let r = "";
  for (let i = 0; i < 16; i++) r += ALPHABET[bytes[i]! % 32];
  return prefix ? `${prefix}_${t}${r}` : `${t}${r}`;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable fingerprint of any JSON-serialisable value (key-sorted). */
export function fingerprint(value: unknown): string {
  return sha256(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(o[k]);
        return acc;
      }, {});
  }
  return v;
}
