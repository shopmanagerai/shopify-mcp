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
 * If no account exists for that email yet, it refuses by default - pass --create to
 * have it create the account too, rather than silently conjuring a user nobody signed
 * up. Existing accounts are never affected by --create; it only fires when the lookup
 * comes back empty.
 *   pnpm tsx scripts/set-admin-password.ts info@cuibit.com 'a-strong-new-password' --create
 *
 * Loads the repo root .env itself (same file ecosystem.config.cjs points the running
 * server at via --env-file), then reads DATA_DIR / DATABASE_URL from it exactly like
 * the server does - so it opens the same database the live server is using, not
 * whatever's on the machine you happen to run this from.
 */
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@shopmanagerai/shared";
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
  const args = process.argv.slice(2).filter((a) => a !== "--create");
  const create = process.argv.includes("--create");
  const [email, password] = args;
  if (!email || !password) {
    console.error("Usage: pnpm tsx scripts/set-admin-password.ts <email> <new-password> [--create]");
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`Rejected: ${problem}`);
    process.exit(1);
  }

  // DATA_DIR in .env is relative (default "./data"), and the running server resolves it
  // against its own process.cwd(), which pm2 sets to the repo root (ecosystem.config.cjs:
  // cwd: __dirname). Resolve it the same way here regardless of where this script is
  // invoked from - anchoring to repoRoot rather than process.cwd() is what makes
  // `cd apps/server && pnpm tsx scripts/...` open the same database the live server uses
  // instead of silently creating a second, empty one under apps/server/data/.
  const dataDirRaw = process.env.DATA_DIR ?? "./data";
  const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : join(repoRoot, dataDirRaw);
  const dbPath = join(dataDir, "shopmanagerai.sqlite");
  const databaseUrl = process.env.DATABASE_URL;
  console.log(databaseUrl ? "Connecting via DATABASE_URL (Postgres)…" : `Connecting to SQLite at ${dbPath} (absolute)…`);

  const { db, close } = await openDatabase({ path: dbPath, url: databaseUrl });
  try {
    const users = new UserRepo(db);
    let user = await users.getByEmail(email);
    const hash = await hashPassword(password);

    if (!user) {
      if (!create) {
        console.error(`No user found for ${normalizeEmail(email)}. They need to have signed up at least once first,`);
        console.error("or rerun this with --create to have it create the account.");
        process.exit(1);
      }
      user = await users.ensure({ userId: newId("usr"), email, passwordHash: hash, emailVerified: true });
      console.log(`Created account for ${normalizeEmail(email)}.`);
    }

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
