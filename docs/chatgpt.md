# ChatGPT

Status: **depends on your plan**. This server speaks the remote MCP protocol
ChatGPT uses, but whether you can add a custom MCP server depends on your
ChatGPT plan and on developer mode being available for your workspace. If you
do not see the option, that is a ChatGPT account limitation rather than a
problem with this server.

## What ChatGPT needs

- A **publicly reachable HTTPS URL**. `localhost` will not work: ChatGPT
  connects from OpenAI's servers, not from your browser. Use a tunnel
  (`cloudflared`, `ngrok`) or deploy the server somewhere public.
- A bearer token, or OAuth.

## Steps

1. Expose the server publicly and confirm the URL answers:

   ```bash
   curl -i https://your-public-host/healthz
   ```

2. In ChatGPT, enable developer mode / custom connectors for your workspace if
   your plan offers it.

3. Add a remote MCP server pointing at:

   ```
   https://your-public-host/mcp/your-store.myshopify.com
   ```

   with the header:

   ```
   Authorization: Bearer <TOKEN>
   ```

4. Approve the tools when prompted.

## Why the read-only build suits ChatGPT

ChatGPT filters remote MCP tools partly on the `readOnlyHint` annotation. Every
genuinely read-only tool here sets it, and the tools that write local state do
not, so the distinction is visible to the client rather than assumed.

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
