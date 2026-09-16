/**
 * One-off: set (or reset) a user's password directly in the database, and make sure
 * they carry the admin role. For when the magic-link/reset-email path isn't available
 * (no configured EMAIL_PROVIDER) and you need a real password today.
 *
 * Not wired into any app flow, not imported by anything else. Run once, then delete
 * or leave it - it is idempotent and harmless to leave in the repo, but never run it
 * against a database you don't control.
 *
 * Usage, from apps/server on the machine actually running the server (the VPS):
 *   pnpm tsx scripts/set-admin-password.ts info@cuibit.com 'a-strong-new-password'
 *
 * Loads the repo root .env itself (same file ecosystem.config.cjs points the running
 * server at via --env-file), then reads DATA_DIR / DATABASE_URL from it exactly like
 * the server does - so it opens the same database the live server is using, not
 * whatever's on the machine you happen to run this from.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, UserRepo, normalizeEmail } from "@shopmanagerai/storage";
import { hashPassword, passwordProblem } from "../src/accounts/password.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
try {
  process.loadEnvFile(join(repoRoot, ".env"));
} catch (e) {
  console.error(`Could not load ${join(repoRoot, ".env")}: ${(e as Error).message}`);
  console.error("Run this from the same repo checkout as the live server, with its .env in place.");
  process.exit(1);
}

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: pnpm tsx scripts/set-admin-password.ts <email> <new-password>");
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`Rejected: ${problem}`);
    process.exit(1);
  }

  const dataDir = process.env.DATA_DIR ?? "./data";
  const dbPath = join(dataDir, "shopmanagerai.sqlite");
  const databaseUrl = process.env.DATABASE_URL;
  console.log(databaseUrl ? "Connecting via DATABASE_URL (Postgres)…" : `Connecting to SQLite at ${dbPath}…`);

  const { db, close } = await openDatabase({ path: dbPath, url: databaseUrl });
  try {
    const users = new UserRepo(db);
    const user = await users.getByEmail(email);
    if (!user) {
      console.error(`No user found for ${normalizeEmail(email)}. They need to have signed up at least once first.`);
      process.exit(1);
    }

    const hash = await hashPassword(password);
    await users.setPasswordHash(user.userId, hash);

    if (user.role !== "admin") {
      await users.setRole(user.userId, "admin");
      console.log(`Role: ${user.role} → admin`);
    } else {
      console.log("Role: already admin");
    }

    console.log(`Done. ${normalizeEmail(email)} can now sign in at /login with that password.`);
    console.log("Note: this only sets the password directly. ADMIN_EMAILS in .env is still what re-grants the");
    console.log("admin role on every future sign-in - if that email isn't listed there too, keep it in sync.");
  } finally {
    close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
