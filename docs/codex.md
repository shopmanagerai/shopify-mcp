# Codex CLI

Status: **configuration documented**.

## Configure

`~/.codex/config.toml`:

```toml
[mcp_servers.shopmanager]
url = "http://localhost:3000/mcp/your-store.myshopify.com"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

The table key (`shopmanager`) is the name the server appears under.

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
