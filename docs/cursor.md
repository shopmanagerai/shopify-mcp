# Cursor

Status: **configuration documented**. The shape below matches Cursor's
documented remote-server format.

## Configure

`~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` inside one:

```json
{
  "mcpServers": {
    "shopmanager": {
      "url": "http://localhost:3000/mcp/your-store.myshopify.com",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

Remote servers take `url` and `headers`. There is no `type` field, and no
`command`: this is an HTTP server, not a stdio one.

Restart Cursor, then check the MCP section of settings shows the server as
connected.

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
