# Connecting MCP clients

Every client connects to the same URL: `https://<host>/mcp/<shop-handle>` (Streamable HTTP, MCP 2026-07-28 with legacy 2025-11-25 fallback). Auth is either OAuth 2.1 (PKCE + CIMD) or a long-lived `cp_` token created in **Connect**. Configs below are generated with the real token by the Connect screen; `<TOKEN>` is the placeholder.

## Claude Code

```bash
claude mcp add --transport http shopmanagerai https://<host>/mcp/<shop> --header "Authorization: Bearer <TOKEN>"
```

Or, for OAuth, omit the header and let Claude Code discover the authorization server from the 401 challenge; approve inside the Shopify admin.

## Cursor

`~/.cursor/mcp.json`:

```json
{ "mcpServers": { "shopmanagerai": { "url": "https://<host>/mcp/<shop>", "headers": { "Authorization": "Bearer <TOKEN>" } } } }
```

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.shopmanagerai]
url = "https://<host>/mcp/<shop>"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

## VS Code

`.vscode/mcp.json`:

```json
{ "servers": { "shopmanagerai": { "type": "http", "url": "https://<host>/mcp/<shop>", "headers": { "Authorization": "Bearer <TOKEN>" } } } }
```

## Generic / other clients

Any client speaking Streamable HTTP works. Send `MCP-Protocol-Version`, `Mcp-Method`, and for `tools/call` the `Mcp-Name` header mirroring the body (the server validates the mirror; the body is authoritative). Legacy clients may `initialize` first.

## Meta vs flat surface

Default: three meta-tools (`discover-tools`, `get-schema`, `execute-tool`) keep the client's context small. Append `?surface=flat` to the URL to advertise every available tool directly.

## Run Shopify's Dev MCP alongside

Shopify's open-source Dev MCP (docs search, GraphQL schema introspection, `validate_theme`) is complementary. ShopManager AI does not duplicate documentation lookup; install both.
