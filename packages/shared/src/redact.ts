/**
 * Secret redaction (threat model T5, T16). Applied to ledger inputs, logs, error
 * messages, and theme-file reads. Patterns are conservative: better to mask a
 * false positive than to leak a token.
 */

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "shopify_admin_token", re: /\bshpat_[A-Za-z0-9]{16,}\b/g },
  { name: "shopify_custom_token", re: /\bshpca_[A-Za-z0-9]{16,}\b/g },
  { name: "shopify_private_token", re: /\bshppa_[A-Za-z0-9]{16,}\b/g },
  { name: "shopify_storefront_token", re: /\bshpss_[A-Za-z0-9]{16,}\b/g },
  { name: "theme_access_password", re: /\bshptka_[A-Za-z0-9]{16,}\b/g },
  { name: "shopmanagerai_token", re: /\bcp_[A-Za-z0-9_-]{20,}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { name: "freemius_secret", re: /\bsk_[A-Za-z0-9]{24,}\b/g },
  { name: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "generic_api_key", re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{12,}['"]?/gi },
];

export const REDACTED = "[REDACTED]";

export function redactString(input: string): string {
  let out = input;
  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      // keep key name for the generic pattern so logs stay readable
      const idx = m.search(/[:=]/);
      if (idx > 0 && /^(api[_-]?key|secret|password|token)/i.test(m)) return m.slice(0, idx + 1) + " " + REDACTED;
      return REDACTED;
    });
  }
  return out;
}

const SENSITIVE_KEYS = /^(password|secret|token|accesstoken|access_token|apikey|api_key|authorization|clientsecret|client_secret|themeaccesspassword|theme_access_password|approvaltoken)$/i;

/** Deep-redact an object: sensitive keys masked entirely, strings scanned. */
export function redactValue<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

export function containsSecret(input: string): boolean {
  return SECRET_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(input);
  });
}
