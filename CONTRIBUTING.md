# Contributing

Thanks for wanting to help.

## How this repository works

Be aware of something unusual before you start: **this repository is
generated.** The code is developed in a private monorepo that contains both the
Free tools published here and the Pro tools that are not. A release script cuts
the Pro definitions out and publishes the result as a commit here.

Two consequences:

1. A pull request against this repository cannot be merged directly. It has to
   be reapplied upstream, and it then reappears here on the next release.
2. The git history here is release history, not development history.

We know that is not ideal, and we would rather say so plainly than let you find
out after writing a patch.

## So what is the best way to contribute?

**Open an issue first.** For anything beyond a typo, an issue is more useful
than a pull request, because it lets us apply the change upstream once instead
of you writing it twice.

Especially valuable:

- **Bug reports** with reproduction steps. Include the output of
  `shopify.auth.doctor` when it is a connection problem.
- **A tool that returns something wrong** for a real store. These are the most
  valuable reports we get, because our fixtures cannot cover every theme.
- **Client compatibility reports.** If you got it working with an MCP client we
  do not list, tell us the configuration and we will document it.
- **Documentation gaps.** If a setup step did not work as written, say so.
- **Security issues.** Privately, see [SECURITY.md](SECURITY.md).

Small documentation pull requests are welcome and easy to apply upstream.

## Running it locally

```bash
pnpm install
pnpm build
cp .env.example .env     # set SHOPMANAGER_DEMO=1 to use the fake store
pnpm start
```

Tests:

```bash
pnpm test
node scripts/assert-free-only.mjs
```

`assert-free-only.mjs` is the guarantee that this build stays read-only. If
your change makes it fail, that is the change being wrong, not the check.

## What will not be accepted here

Tools that write to a Shopify store. That is the boundary between this build
and the hosted Pro tier, and it is enforced in CI. A pull request that adds one
cannot be merged no matter how good it is.
