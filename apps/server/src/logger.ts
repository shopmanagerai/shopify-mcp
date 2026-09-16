/**
 * Minimal console logger implementing @shopmanagerai/shared's Logger interface,
 * with secret redaction applied to every message/meta (threat model T5/T16).
 */
import { redactString, redactValue } from "@shopmanagerai/shared";
import type { Logger } from "@shopmanagerai/shared";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = LEVELS[level];

  function emit(lvl: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVELS[lvl] < threshold) return;
    const safeMsg = redactString(msg);
    const safeMeta = meta ? redactValue(meta) : undefined;
    const line = { level: lvl, time: new Date().toISOString(), msg: safeMsg, ...(safeMeta ? { meta: safeMeta } : {}) };
    const fn = lvl === "error" ? console.error : lvl === "warn" ? console.warn : console.log;
    fn(JSON.stringify(line));
  }

  return {
    debug: (msg, meta) => emit("debug", msg, meta),
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
  };
}
