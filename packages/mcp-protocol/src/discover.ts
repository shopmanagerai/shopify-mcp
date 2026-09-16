/**
 * `server/discover`, the modern revision's required capability advertisement.
 *
 * Port of the original plugin’s `includes/mcp/discover.php`. The result describes what
 * this server actually serves, computed from a `ServerDescriptor` the host
 * application supplies (per store, per credential) rather than a static
 * capability list, so a client never learns of a method the very next call
 * would refuse.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/server/discover
 */
import { BRAND } from "@shopmanagerai/shared";
import { SUPPORTED_VERSIONS } from "./protocol.js";

export interface ServerDescriptor {
  /** Defaults to BRAND.name so a rename stays a one-commit change. */
  name?: string;
  version: string;
  /** Free-form usage guidance prepended to an LLM's context on connection. */
  instructions?: string;
}

export interface DiscoverCapabilities {
  tools: { listChanged: boolean };
  resources: Record<string, never>;
  prompts: Record<string, never>;
}

export interface DiscoverResult {
  serverInfo: { name: string; version: string };
  protocolVersions: readonly string[];
  capabilities: DiscoverCapabilities;
  extensions: string[];
  instructions: string;
}

/** The package's default `instructions` text, exported so a host can compose on top of it (e.g. appending a memory index). */
export function defaultInstructions(): string {
  return (
    `${BRAND.name} controls a Shopify store through typed, policy-gated tools. ` +
    `Operations outside the connected credential's profile and entitlements are refused server-side ` +
    `regardless of the tool list. Destructive operations require an explicit confirmation.`
  );
}

/** Build the `server/discover` result from a server descriptor. */
export function buildDiscoverResult(descriptor: ServerDescriptor): DiscoverResult {
  return {
    serverInfo: { name: descriptor.name ?? BRAND.name, version: descriptor.version },
    protocolVersions: SUPPORTED_VERSIONS,
    // No `listChanged` support: this server does not emit `tools/list_changed`,
    // and declaring it would promise a notification that never arrives.
    capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
    extensions: [],
    instructions: descriptor.instructions ?? defaultInstructions(),
  };
}
