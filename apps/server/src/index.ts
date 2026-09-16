/**
 * Boot entrypoint (task brief §11): banner with demo token when demo,
 * graceful shutdown (close db, browser).
 */
import { serve } from "@hono/node-server";
import { loadConfig, demoBanner } from "./config.js";
import { buildContainer } from "./container.js";
import { buildApp } from "./app.js";
import { ensureDemoToken } from "./auth/mcp.js";

async function main() {
  const config = loadConfig();
  const container = await buildContainer(config);

  if (config.demo) {
    await container.shopService.ensureDemoShop();
    const token = await ensureDemoToken(container);
    container.log.info(demoBanner(config));
    container.log.info(`Demo MCP token: ${token}`);
  }

  const app = buildApp(container);

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    container.log.info(`ShopManager AI server listening on http://localhost:${info.port}`);
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    container.log.info(`Received ${signal}, shutting down.`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    container.closeDb();
    if (typeof (container.browser as any).close === "function") {
      await (container.browser as any).close().catch(() => undefined);
    }
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("ShopManager AI server failed to start:", e);
  process.exit(1);
});
