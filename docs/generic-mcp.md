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
