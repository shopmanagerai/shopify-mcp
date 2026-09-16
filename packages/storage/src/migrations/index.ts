import type { Migration, MigrationProvider } from "kysely";
import * as m0001 from "./0001_init.js";
import * as m0002 from "./0002_skills.js";
import * as m0003 from "./0003_design_entitlement.js";
import * as m0004 from "./0004_connections_memory.js";
import * as m0005 from "./0005_accounts.js";
import * as m0006 from "./0006_auth_tickets.js";
import * as m0007 from "./0007_posts.js";

const migrations: Record<string, Migration> = {
  "0001_init": m0001,
  "0002_skills": m0002,
  "0003_design_entitlement": m0003,
  "0004_connections_memory": m0004,
  "0005_accounts": m0005,
  "0006_auth_tickets": m0006,
  "0007_posts": m0007,
};

/** In-code migration provider (no filesystem scanning, works from a bundled dist too). */
export class InMemoryMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  }
}
