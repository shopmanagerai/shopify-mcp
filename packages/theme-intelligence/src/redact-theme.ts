/**
 * Secret masking for theme reads (threat model T16). Reuses
 * @shopmanagerai/shared's redactString rather than reimplementing patterns.
 */
import { containsSecret, redactString } from "@shopmanagerai/shared";
import type { ThemeFile } from "@shopmanagerai/shared";
import type { ThemeFileSet } from "./fileset.js";

export interface RedactedThemeFile {
  key: string;
  content?: string;
  contentBase64?: string;
  masked: boolean;
}

export interface RedactThemeReport {
  files: RedactedThemeFile[];
  maskedKeys: string[];
}

/** Mask secrets inside a single ThemeFile's text content. Binary files pass through unchanged. */
export function redactThemeFile(file: ThemeFile): RedactedThemeFile {
  if (file.content === undefined) {
    return { key: file.key, contentBase64: file.contentBase64, masked: false };
  }
  const masked = containsSecret(file.content);
  return { key: file.key, content: redactString(file.content), masked };
}

/** Mask secrets across an entire ThemeFileSet; report which keys had anything masked. */
export function redactThemeFileSet(fileSet: ThemeFileSet): RedactThemeReport {
  const files: RedactedThemeFile[] = [];
  const maskedKeys: string[] = [];
  for (const f of fileSet.all()) {
    const redacted = redactThemeFile(f);
    files.push(redacted);
    if (redacted.masked) maskedKeys.push(redacted.key);
  }
  return { files, maskedKeys };
}
