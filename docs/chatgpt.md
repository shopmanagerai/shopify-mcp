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
