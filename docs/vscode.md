# VS Code

Status: **configuration documented**.

## Configure

`.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "shopmanager": {
      "type": "http",
      "url": "http://localhost:3000/mcp/your-store.myshopify.com",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

`type: "http"` is required here, unlike Cursor.

Do not commit a real token. Keep the file out of version control, or use an
input variable so VS Code prompts for the token instead.

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
