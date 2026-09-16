# Shopify MCP Server Guide

How this server works, for people deciding whether to run it or wondering what
happens between their AI client and their store. The
[README](../README.md) covers installation; this covers architecture.

## What "Shopify MCP" means here

The [Model Context Protocol](https://modelcontextprotocol.io) is a standard way
for an AI client to discover and call tools. A Shopify MCP server is one that
exposes Shopify capabilities as those tools.

That phrase covers several quite different things, which is worth untangling
because they are often discussed as if they were one product. Shopify's own
servers are mostly aimed at shopper-facing commerce or at development knowledge;
this server is aimed at reading a merchant's own store. The
[comparison](shopify-official-mcp-vs-shopmanager.md) has the detail.

## Request path

```
AI client
  |  POST /mcp/<shop>            Streamable HTTP, Authorization: Bearer cp_...
  v
Bearer authentication            resolves the shop, loads its credential
  |
  v
Tool registry                    is this tool registered, and available here?
  |
  v
Policy engine                    scopes, capabilities, tier, risk, approvals
  |
  v
Handler                          Admin GraphQL, or theme files via Theme Access
  |
  v
Operation ledger                 records what ran, at what risk, with what result
```

A call that fails any earlier stage never reaches a handler. That is what makes
the read-only guarantee structural rather than a matter of the tools being
well-behaved.

## Transport

Streamable HTTP, MCP `2026-07-28`, with a legacy `2025-11-25` fallback for older
clients. One endpoint per store:

```
POST http://<host>/mcp/<shop>
```

`<shop>` may be a bare handle or a full `*.myshopify.com` domain; a bare handle
has the suffix appended.

## Tool discovery

Two surfaces, because the right answer depends on the client.

**Meta (default).** Three tools are advertised: `discover-tools`, `get-schema`
and `execute-tool`. The client spends almost no context on a catalog and asks
for schemas as it needs them. This is the better default with a large tool set.

**Flat (`?surface=flat`).** Every currently available tool is advertised
directly. Simpler for clients that expect to see everything, at the cost of
context.

Either way, tools carry MCP annotations derived from their own metadata:

| Annotation | Derived from |
| --- | --- |
| `readOnlyHint` | risk class is `read` and the tool declares no writes |
| `destructiveHint` | risk class is `destructive` or `critical` |
| `idempotentHint` | the tool is read-only |
| `openWorldHint` | the tool reaches Shopify rather than local state |

Because these are derived rather than hand-written, they cannot drift away from
what the policy engine actually enforces.

## Authentication

**MCP clients** send a bearer token (`cp_...`), created and revocable in the
Connect screen. A missing or invalid token gets `401` with a
`WWW-Authenticate` challenge naming the resource metadata endpoint, so
OAuth-capable clients can discover the authorization server.

**Shopify** is reached two ways:

- **Admin API**, through an OAuth token obtained when the app was installed on
  the store. The scopes requested are all `read_*`.
- **Theme files**, through Shopify's Theme Access proxy, using a Theme Access
  password you supply. Note what that credential can do at the Shopify level:
  see [SECURITY.md](../SECURITY.md).

Both are encrypted at rest with `SHOPMANAGER_MASTER_KEY`.

## Why read-only is structural

The build contains no tool that writes to Shopify. That is not a runtime flag
that could be flipped, and not a policy rule that could be misconfigured: the
tool definitions are absent from the binary.

Three things enforce it:

1. **Tool selection at build time.** The published tree is generated, and a tool
   ships only if the tier policy calls it Free.
2. **Scope generation.** `SHOPIFY_SCOPES` in `.env.example` is generated from
   what the shipped tools declare. The build fails if that produces a write
   scope.
3. **A CI assertion.** [`scripts/assert-free-only.mjs`](../scripts/assert-free-only.mjs)
   loads the registry the server actually builds and fails if any tool declares
   a Shopify write, if the manifest disagrees with the registry, if the scope
   list is wider than the tools need, or if an annotation contradicts its own
   metadata.

The `commerce.change.*` facade deserves a specific mention, because it looks
like an escape hatch. It runs another tool by name through the same pipeline. It
cannot reach a tool that is not registered, and no registered tool writes to
Shopify, so asking it for a Pro tool returns `TOOL_NOT_FOUND`.

## Storage

SQLite by default, in `DATA_DIR`. Set `DATABASE_URL` to a `postgres://` URL for
Postgres.

What is stored: encrypted Shopify credentials, hashed MCP tokens, the operation
ledger, snapshots you create, memories and skills you save, and a record of
which clients connected. Store content itself is read on demand, not warehoused.
See [PRIVACY.md](../PRIVACY.md).

## Operation ledger

Every tool call is recorded with an operation id, the tool, its risk level, the
changes it reported and whether a rollback is available. `commerce.operations.list`
and `commerce.operation.get` read it back.

For a read-only build the ledger is mostly an audit trail. It is the same
machinery the hosted Pro tier uses to make writes reversible, which is why plan,
diff and rollback tooling exists here even though there is nothing to undo.

## Rate limiting and health

Per credential, `MCP_RATE_LIMIT_PER_MIN`, default 600 requests per minute.
`/healthz` and `/readyz` for liveness and readiness, Prometheus metrics at
`/metrics`.

## Supported clients

See the [client guides](../README.md#connect-claude-chatgpt-cursor-codex-and-vs-code). Anything that
speaks MCP over Streamable HTTP with a bearer token should work;
[docs/generic-mcp.md](generic-mcp.md) has raw `curl` examples for checking a
client's behavior against the server directly.
