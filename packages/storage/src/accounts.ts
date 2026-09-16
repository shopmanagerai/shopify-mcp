/**
 * Account-layer repositories: users (passwordless identities), magic links,
 * browser sessions, and the user<->shop link table. Tokens are stored hashed
 * (sha256) exactly like MCP credentials; plaintext exists only in the email /
 * cookie. See migrations/0005_accounts.ts.
 */
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Schema } from "./schema.js";

export function hashAccountToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface UserRow {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
  planState: string;
  plan: string | null;
  seats: { shops: number; members: number } | null;
  licenseRef: string | null;
  freemiusUserId: string | null;
  freemiusLicenseId: string | null;
  graceUntil: string | null;
  updatedAt: string;
  hasPassword: boolean;
  emailVerifiedAt: string | null;
  role: "user" | "admin";
  notes: string | null;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapUser(row: any): UserRow {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name ?? "",
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
    planState: row.plan_state ?? "FREE",
    plan: row.plan ?? null,
    seats: parseJson(row.seats_json),
    licenseRef: row.license_ref ?? null,
    freemiusUserId: row.freemius_user_id ?? null,
    freemiusLicenseId: row.freemius_license_id ?? null,
    graceUntil: row.grace_until ?? null,
    updatedAt: row.updated_at,
    hasPassword: Boolean(row.password_hash),
    emailVerifiedAt: row.email_verified_at ?? null,
    role: row.role === "admin" ? "admin" : "user",
    notes: row.notes ?? null,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class UserRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async get(userId: string): Promise<UserRow | null> {
    const row = await this.db.selectFrom("users").selectAll().where("user_id", "=", userId).executeTakeFirst();
    return row ? mapUser(row) : null;
  }

  async getByEmail(email: string): Promise<UserRow | null> {
    const row = await this.db.selectFrom("users").selectAll().where("email", "=", normalizeEmail(email)).executeTakeFirst();
    return row ? mapUser(row) : null;
  }

  async getByFreemiusUserId(freemiusUserId: string): Promise<UserRow | null> {
    const row = await this.db.selectFrom("users").selectAll().where("freemius_user_id", "=", freemiusUserId).executeTakeFirst();
    return row ? mapUser(row) : null;
  }

  /** Creates the user on first login; returns the existing row otherwise. */
  async ensure(input: { userId: string; email: string; name?: string; passwordHash?: string | null; emailVerified?: boolean }): Promise<UserRow> {
    const existing = await this.getByEmail(input.email);
    if (existing) return existing;
    const now = new Date().toISOString();
    await this.db
      .insertInto("users")
      .values({
        user_id: input.userId,
        email: normalizeEmail(input.email),
        name: input.name ?? "",
        password_hash: input.passwordHash ?? null,
        email_verified_at: input.emailVerified ? now : null,
        role: "user",
        notes: null,
        created_at: now,
        last_login_at: null,
        plan_state: "FREE",
        plan: null,
        seats_json: null,
        license_ref: null,
        freemius_user_id: null,
        freemius_license_id: null,
        grace_until: null,
        updated_at: now,
      })
      .execute();
    return (await this.get(input.userId))!;
  }

  async touchLogin(userId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateTable("users").set({ last_login_at: now, updated_at: now }).where("user_id", "=", userId).execute();
  }

  /** Raw hash for password verification; never returned on UserRow. */
  async getPasswordHash(userId: string): Promise<string | null> {
    const row = await this.db.selectFrom("users").select("password_hash").where("user_id", "=", userId).executeTakeFirst();
    return row?.password_hash ?? null;
  }

  async setPasswordHash(userId: string, hash: string | null): Promise<void> {
    await this.db.updateTable("users").set({ password_hash: hash, updated_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
  }

  async markEmailVerified(userId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateTable("users").set({ email_verified_at: now, updated_at: now }).where("user_id", "=", userId).execute();
  }

  async setRole(userId: string, role: "user" | "admin"): Promise<void> {
    await this.db.updateTable("users").set({ role, updated_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
  }

  async setNotes(userId: string, notes: string | null): Promise<void> {
    await this.db.updateTable("users").set({ notes, updated_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
  }

  async list(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ users: UserRow[]; total: number }> {
    let q = this.db.selectFrom("users").selectAll();
    let c = this.db.selectFrom("users").select((eb) => eb.fn.count("user_id").as("n"));
    if (opts.q) {
      const like = `%${opts.q.toLowerCase()}%`;
      q = q.where((eb) => eb.or([eb("email", "like", like), eb("name", "like", like), eb("user_id", "like", like)]));
      c = c.where((eb) => eb.or([eb("email", "like", like), eb("name", "like", like), eb("user_id", "like", like)]));
    }
    const rows = await q.orderBy("created_at", "desc").limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
    const total = Number(((await c.executeTakeFirst()) as any)?.n ?? 0);
    return { users: rows.map(mapUser), total };
  }

  async count(): Promise<number> {
    const r = await this.db.selectFrom("users").select((eb) => eb.fn.count("user_id").as("n")).executeTakeFirst();
    return Number((r as any)?.n ?? 0);
  }

  async updateProfile(userId: string, patch: { name?: string }): Promise<UserRow | null> {
    const now = new Date().toISOString();
    await this.db
      .updateTable("users")
      .set({ ...(patch.name !== undefined ? { name: patch.name } : {}), updated_at: now })
      .where("user_id", "=", userId)
      .execute();
    return this.get(userId);
  }

  async updatePlan(
    userId: string,
    patch: {
      planState: string;
      plan?: string | null;
      seats?: { shops: number; members: number } | null;
      licenseRef?: string | null;
      freemiusUserId?: string | null;
      freemiusLicenseId?: string | null;
      graceUntil?: string | null;
    },
  ): Promise<UserRow | null> {
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { plan_state: patch.planState, updated_at: now };
    if (patch.plan !== undefined) set.plan = patch.plan;
    if (patch.seats !== undefined) set.seats_json = patch.seats ? JSON.stringify(patch.seats) : null;
    if (patch.licenseRef !== undefined) set.license_ref = patch.licenseRef;
    if (patch.freemiusUserId !== undefined) set.freemius_user_id = patch.freemiusUserId;
    if (patch.freemiusLicenseId !== undefined) set.freemius_license_id = patch.freemiusLicenseId;
    if (patch.graceUntil !== undefined) set.grace_until = patch.graceUntil;
    await this.db.updateTable("users").set(set as any).where("user_id", "=", userId).execute();
    return this.get(userId);
  }

  async delete(userId: string): Promise<void> {
    await this.db.deleteFrom("user_shops").where("user_id", "=", userId).execute();
    await this.db.deleteFrom("sessions").where("user_id", "=", userId).execute();
    await this.db.deleteFrom("users").where("user_id", "=", userId).execute();
  }
}

export class MagicLinkRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async create(input: { token: string; email: string; redirect?: string | null; ttlMs: number }): Promise<void> {
    const now = new Date();
    await this.db
      .insertInto("magic_links")
      .values({
        token_hash: hashAccountToken(input.token),
        email: normalizeEmail(input.email),
        redirect: input.redirect ?? null,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + input.ttlMs).toISOString(),
        consumed_at: null,
      })
      .execute();
  }

  /** Atomically consumes a link: returns null if unknown, expired, or already used. */
  async consume(token: string): Promise<{ email: string; redirect: string | null } | null> {
    const hash = hashAccountToken(token);
    const row = await this.db.selectFrom("magic_links").selectAll().where("token_hash", "=", hash).executeTakeFirst();
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) return null;
    const now = new Date().toISOString();
    const res = await this.db
      .updateTable("magic_links")
      .set({ consumed_at: now })
      .where("token_hash", "=", hash)
      .where("consumed_at", "is", null)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows ?? 0) === 0) return null;
    return { email: row.email, redirect: row.redirect ?? null };
  }

  /** How many links were issued for an email in the last window (rate limiting). */
  async countRecent(email: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const rows = await this.db
      .selectFrom("magic_links")
      .select("token_hash")
      .where("email", "=", normalizeEmail(email))
      .where("created_at", ">", since)
      .execute();
    return rows.length;
  }
}

export interface SessionRow {
  sessionId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string;
}

function mapSession(row: any): SessionRow {
  return { sessionId: row.session_id, userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, userAgent: row.user_agent ?? "" };
}

export class SessionRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async create(input: { sessionId: string; token: string; userId: string; ttlMs: number; userAgent?: string }): Promise<SessionRow> {
    const now = new Date();
    await this.db
      .insertInto("sessions")
      .values({
        session_id: input.sessionId,
        token_hash: hashAccountToken(input.token),
        user_id: input.userId,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + input.ttlMs).toISOString(),
        last_seen_at: now.toISOString(),
        user_agent: (input.userAgent ?? "").slice(0, 300),
        revoked_at: null,
      })
      .execute();
    return (await this.get(input.sessionId))!;
  }

  async get(sessionId: string): Promise<SessionRow | null> {
    const row = await this.db.selectFrom("sessions").selectAll().where("session_id", "=", sessionId).executeTakeFirst();
    return row ? mapSession(row) : null;
  }

  /** Resolves a cookie token to a live session (null when unknown, revoked or expired). */
  async findByToken(token: string): Promise<SessionRow | null> {
    const row = await this.db.selectFrom("sessions").selectAll().where("token_hash", "=", hashAccountToken(token)).executeTakeFirst();
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
    return mapSession(row);
  }

  async touch(sessionId: string): Promise<void> {
    await this.db.updateTable("sessions").set({ last_seen_at: new Date().toISOString() }).where("session_id", "=", sessionId).execute();
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.updateTable("sessions").set({ revoked_at: new Date().toISOString() }).where("session_id", "=", sessionId).execute();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.updateTable("sessions").set({ revoked_at: new Date().toISOString() }).where("user_id", "=", userId).where("revoked_at", "is", null).execute();
  }

  async listForUser(userId: string): Promise<SessionRow[]> {
    const rows = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .orderBy("last_seen_at", "desc")
      .execute();
    return rows.filter((r) => new Date(r.expires_at).getTime() >= Date.now()).map(mapSession);
  }
}

export interface UserShopRow {
  userId: string;
  shopId: string;
  role: "owner" | "member";
  proSeat: boolean;
  createdAt: string;
}

function mapUserShop(row: any): UserShopRow {
  return { userId: row.user_id, shopId: row.shop_id, role: row.role === "member" ? "member" : "owner", proSeat: Number(row.pro_seat) === 1, createdAt: row.created_at };
}

export class UserShopRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async link(input: { userId: string; shopId: string; role?: "owner" | "member"; proSeat?: boolean }): Promise<UserShopRow> {
    const existing = await this.get(input.userId, input.shopId);
    if (existing) return existing;
    await this.db
      .insertInto("user_shops")
      .values({
        user_id: input.userId,
        shop_id: input.shopId,
        role: input.role ?? "owner",
        pro_seat: input.proSeat ? 1 : 0,
        created_at: new Date().toISOString(),
      })
      .execute();
    return (await this.get(input.userId, input.shopId))!;
  }

  async get(userId: string, shopId: string): Promise<UserShopRow | null> {
    const row = await this.db.selectFrom("user_shops").selectAll().where("user_id", "=", userId).where("shop_id", "=", shopId).executeTakeFirst();
    return row ? mapUserShop(row) : null;
  }

  async listForUser(userId: string): Promise<UserShopRow[]> {
    const rows = await this.db.selectFrom("user_shops").selectAll().where("user_id", "=", userId).orderBy("created_at", "asc").execute();
    return rows.map(mapUserShop);
  }

  async listForShop(shopId: string): Promise<UserShopRow[]> {
    const rows = await this.db.selectFrom("user_shops").selectAll().where("shop_id", "=", shopId).orderBy("created_at", "asc").execute();
    return rows.map(mapUserShop);
  }

  async setProSeat(userId: string, shopId: string, proSeat: boolean): Promise<void> {
    await this.db.updateTable("user_shops").set({ pro_seat: proSeat ? 1 : 0 }).where("user_id", "=", userId).where("shop_id", "=", shopId).execute();
  }

  async unlink(userId: string, shopId: string): Promise<void> {
    await this.db.deleteFrom("user_shops").where("user_id", "=", userId).where("shop_id", "=", shopId).execute();
  }
}
