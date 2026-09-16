# Privacy

This document covers the **self-hosted open-source server** in this repository.
The hosted service at https://shopmanagerai.com has its own privacy policy.

## What this server sends us

Nothing.

There is no license check, no activation, no usage beacon and no crash
reporting. The server contacts exactly two kinds of host: Shopify, and whatever
MCP client you point at it.

## What it stores, and where

Everything stays in `DATA_DIR` (SQLite by default) or in the Postgres database
you configure. That includes:

| Data | Why |
| --- | --- |
| Shopify access tokens | To call the Admin API on your behalf. Encrypted at rest |
| Theme Access password | To read theme files. Encrypted at rest |
| MCP bearer tokens | To authenticate your AI client. Stored hashed |
| Operation ledger | An audit record of every tool call |
| Snapshots | Copies of theme files you asked to snapshot |
| Memories and skills | Notes you explicitly asked the assistant to save |
| Connection records | Which client connected, and when |

## Store data

Store content (products, themes, orders and so on) is read on demand and
returned to your AI client. It is not warehoused here, beyond snapshots you
create and memories you save.

Note that your AI client is a third party. Whatever a tool returns is sent to
whoever runs that model, under their terms. Tools that read customer or order
data are marked `protectedCustomerData` in
[`tools-manifest.json`](tools-manifest.json).

## Telemetry

The telemetry emitter is disabled unless explicitly configured, and is opt-in
per shop on top of that. It never includes tool inputs, outputs or store
domains. Leave it unset and nothing is emitted.

## Deleting everything

Stop the server and delete `DATA_DIR`. Then revoke the app in your Shopify
admin and revoke the Theme Access password.
