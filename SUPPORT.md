# Support

## Something is not working

Start with the built-in diagnosis. Ask your assistant:

> Diagnose this connection and tell me exactly what is wrong and how to fix it.

That runs `shopify.auth.doctor`, which names the missing scope or capability
and the fix for it. The [troubleshooting table in the
README](README.md#troubleshooting) covers the common cases.

## Where to ask

| What | Where |
| --- | --- |
| Bug, or a tool returning something wrong | [Open an issue](../../issues/new/choose) |
| Feature idea | [Open an issue](../../issues/new/choose) |
| Security vulnerability | Privately, see [SECURITY.md](SECURITY.md) |
| Question about the hosted service or billing | https://shopmanagerai.com/contact/ |
| General documentation | https://shopmanagerai.com/docs/ |

## What to include in a bug report

- What you asked the assistant, and what it did.
- The tool name, if you know it.
- The output of `shopify.auth.doctor`.
- Which MCP client, and which Shopify plan.
- Whether it reproduces in demo mode (`SHOPMANAGER_DEMO=1`).

Never paste an access token, a Theme Access password or a `cp_` token into an
issue. If you already did, revoke it.

## Support expectations

This is open-source software maintained alongside a commercial product. Issues
are read and triaged, but there is no response-time guarantee for the free
build. Paid plans on the hosted service include support; see
https://shopmanagerai.com/pricing/.
