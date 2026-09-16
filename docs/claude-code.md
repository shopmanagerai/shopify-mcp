# Claude Code

Status: **verified**. Tool calls have been run end to end over this transport.

## Add the server

```bash
claude mcp add --transport http shopmanager http://localhost:3000/mcp/your-store.myshopify.com --header "Authorization: Bearer <TOKEN>"
```

Check it was added:

```bash
claude mcp list
```

To remove it:

```bash
claude mcp remove shopmanager
```

## OAuth instead of a token

Omit the `--header` flag and Claude Code discovers the authorization server
from the `401` challenge. Approve the connection in your Shopify admin.

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

## Seeing every tool

By default three meta-tools are advertised to keep context small. To see all
122 directly, add `?surface=flat` to the URL.
