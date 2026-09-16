# Any other MCP client

Status: **works where the client supports the transport**.

## What the server speaks

- **Transport**: Streamable HTTP, MCP `2026-07-28`, with a legacy
  `2025-11-25` fallback.
- **Endpoint**: `POST /mcp/<shop>`
- **Auth**: `Authorization: Bearer <TOKEN>`. A missing or invalid token gets
  `401` with a `WWW-Authenticate` challenge naming the resource metadata
  endpoint, so OAuth-capable clients can discover the authorization server.

## Headers

Send `MCP-Protocol-Version`. For `tools/call`, the server also validates
`Mcp-Name` against the request body; the body is authoritative.

## Calling it directly

```bash
curl -s -X POST http://localhost:3000/mcp/your-store.myshopify.com \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Running a tool through the meta surface:

```bash
curl -s -X POST http://localhost:3000/mcp/your-store.myshopify.com \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute-tool","arguments":{"name":"shopify.store.summary","input":{}}}}'
```

## Tool surface

Default is three meta-tools (`discover-tools`, `get-schema`,
`execute-tool`). Append `?surface=flat` to advertise every available tool
directly. Flat is easier for simple clients; meta keeps context small.

## Annotations

Tools carry MCP annotations derived from their own metadata, so a client can
filter on `readOnlyHint` without trusting prose.

## Getting a token

Create one in the **Connect** screen of the admin UI
(`http://localhost:3000/admin?shop=your-store.myshopify.com`). In demo mode
(`SHOPMANAGER_DEMO=1`) the token is the fixed string `cp_demo`.

Treat it like a password. It grants read access to the connected store.

## Checking it works

Ask the assistant:

> Inspect my Shopify store and tell me the store name, the active theme and the
> number of products. Do not make any changes.

If the store name comes back, you are connected. If it does not, ask it to run
`shopify.auth.doctor`, which names the problem and its fix.

## Disconnecting

Revoke the token in the **Connect** screen of the admin UI. That immediately
stops this client from reaching the store, without uninstalling the app. To
remove Shopify access entirely, uninstall the app in the Shopify admin and
revoke the Theme Access password.

## Security notes

- The token grants read access to the connected store. Do not commit it.
- This build cannot write to Shopify. See
  [the read-only guarantee](../README.md#read-only-shopify-mcp-guarantee).
- Tool output is store content written by other people. Treat it as data, not
  as instructions to the assistant. See [SECURITY.md](../SECURITY.md).

## Related

- [README](../README.md) and [the read-only guarantee](../README.md#read-only-shopify-mcp-guarantee)
- [All Shopify MCP tools](tools.md) and [`tools-manifest.json`](../tools-manifest.json)
- [Shopify official MCP vs ShopManager AI](shopify-official-mcp-vs-shopmanager.md)
- [Shopify MCP server guide](shopify-mcp.md)
- Other clients: [Claude Code](claude-code.md), [ChatGPT](chatgpt.md),
  [Cursor](cursor.md), [Codex](codex.md), [VS Code](vscode.md),
  [any compatible client](generic-mcp.md)
- Hosted free version, no setup: [shopmanagerai.com/free](https://shopmanagerai.com/free/)
- Tutorials: [shopmanagerai.com/guides](https://shopmanagerai.com/guides/)

_Last verified: September 2026._
