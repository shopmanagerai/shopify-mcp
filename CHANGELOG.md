# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-16

First public release of the open-source Free build.

### Added

- **122 read-only Shopify MCP tools** over Streamable HTTP, covering theme
  inspection, Liquid parsing and validation, Theme Check, sections, blocks and
  templates, catalogue and content reads, store configuration, diagnostics,
  snapshots, memories and skills.
- **Demo mode** (`SHOPMANAGER_DEMO=1`): a complete fake store, so the server
  can be tried without any Shopify credentials.
- **MCP tool annotations** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) derived from each tool's declared risk
  class and data categories.
- **Least-privilege Shopify scopes**, generated from what the shipped tools
  declare. No write scopes are requested.
- **Progressive tool disclosure**: three meta-tools by default to keep client
  context small, or `?surface=flat` to advertise every tool.
- Client setup guides for Claude Code, ChatGPT, Cursor, Codex and VS Code.
- Docker and Docker Compose deployment.
- `server.json` for the official MCP Registry.
- Operation ledger, snapshots and rollback planning.
- SQLite by default, Postgres via `DATABASE_URL`.
- Shopify Admin API `2026-07`.

### Security

- CI asserts the build is read-only against Shopify: no tool may declare a
  Shopify write or a non-Free tier. See
  [`scripts/assert-free-only.mjs`](scripts/assert-free-only.mjs).
- Shopify tokens and Theme Access passwords are encrypted at rest.
- Documented the Theme Access credential's true capability in
  [SECURITY.md](SECURITY.md).

[0.1.0]: https://github.com/shopmanagerai/shopify-mcp/releases/tag/v0.1.0
