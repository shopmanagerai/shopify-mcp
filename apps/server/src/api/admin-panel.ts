/**
 * Operator admin panel API under /api/panel/*. Requires a session whose user has role "admin"
 * (granted to ADMIN_EMAILS on sign-in). Everything here is read/write over the account layer:
 * users, their stores and plans, support tickets, and a few product-wide numbers.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ShopManagerAIError, ERROR_CODES } from "@shopmanagerai/shared";
import { effectiveState as effectiveShopState } from "@shopmanagerai/entitlement-freemius";
import type { UserRow } from "@shopmanagerai/storage";
import type { Container } from "../container.js";
import { apiError, requireSession, tierForSeats } from "./account.js";
import { effectiveUserState } from "../accounts/service.js";

async function requireAdmin(container: Container, c: any): Promise<UserRow> {
  const { user } = await requireSession(container, c);
  if (user.role !== "admin") throw new ShopManagerAIError(ERROR_CODES.PROFILE_DENIED, "Admin access required.", { httpStatus: 403 });
  return user;
}

function userView(u: UserRow) {
  const state = effectiveUserState(u);
  const active = ["PRO_ACTIVE", "AGENCY_ACTIVE", "TRIAL", "PRO_GRACE"].includes(state);
  return {
    userId: u.userId,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    emailVerified: Boolean(u.emailVerifiedAt),
    hasPassword: u.hasPassword,
    planState: state,
    planActive: active,
    tier: active ? tierForSeats(u.seats?.shops).slug : "free",
    seats: u.seats?.shops ?? 0,
    plan: u.plan,
    licenseLinked: Boolean(u.licenseRef || u.freemiusLicenseId),
    freemiusLicenseId: u.freemiusLicenseId,
    graceUntil: u.graceUntil,
    notes: u.notes,
  };
}

export function mountAdminPanelApi(app: Hono, container: Container): void {
  const api = new Hono();

  api.get("/overview", async (c) => {
    try {
      await requireAdmin(container, c);
      const { users, total } = await container.users.list({ limit: 1000 });
      const paying = users.filter((u) => ["PRO_ACTIVE", "AGENCY_ACTIVE"].includes(effectiveUserState(u)));
      const shops = await container.db.selectFrom("shops").select(["shop_id", "uninstalled_at"]).execute();
      const links = await container.db.selectFrom("user_shops").select(["shop_id"]).execute();
      const ticketCounts = await container.tickets.counts();
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const ops = await container.db.selectFrom("operations").select((eb) => eb.fn.count("operation_id").as("n")).where("started_at", ">", dayAgo).executeTakeFirst().catch(() => ({ n: 0 }));
      const recentTickets = await container.tickets.listAll({ status: "open", limit: 5 });
      return c.json({
        ok: true,
        stats: {
          users: total,
          usersLast7d: users.filter((u) => u.createdAt > weekAgo).length,
          paying: paying.length,
          seatsSold: paying.reduce((n, u) => n + Math.min(u.seats?.shops ?? 0, 100_000), 0),
          storesInstalled: shops.filter((s) => !s.uninstalled_at).length,
          storesLinked: new Set(links.map((l) => l.shop_id)).size,
          toolCallsLast24h: Number((ops as any)?.n ?? 0),
          tickets: ticketCounts,
        },
        recentTickets,
        recentUsers: users.slice(0, 8).map(userView),
        billingConfigured: Boolean(container.config.freemius.productId),
        emailProvider: container.email.kind,
      });
    } catch (e) {
      return apiError(c, e);
    }
  });

  api.get("/users", async (c) => {
    try {
      await requireAdmin(container, c);
      const q = c.req.query("q") ?? undefined;
      const offset = Number(c.req.query("offset") ?? 0);
      const { users, total } = await container.users.list({ q, limit: 50, offset });
      return c.json({ ok: true, users: users.map(userView), total, offset });
    } catch (e) {
      return apiError(c, e);
    }
  });

  api.get("/users/:userId", async (c) => {
    try {
      await requireAdmin(container, c);
      const user = await container.users.get(c.req.param("userId"));
      if (!user) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "User not found.");
      const links = await container.userShops.listForUser(user.userId);
      const shops = await Promise.all(
        links.map(async (l) => {
          const shop = await container.shopService.getById(l.shopId);
          const ent = await container.entitlementRepo.get(l.shopId);
          const tokens = await container.credentials.listByShop(l.shopId);
          return { shopId: l.shopId, domain: shop?.domain ?? l.shopId, name: shop?.name ?? null, installed: shop ? await container.secrets.has(shop.shopId, "admin_token") : false, uninstalledAt: shop?.uninstalledAt ?? null, proSeat: l.proSeat, entitlement: ent ? effectiveShopState(ent.state as any, ent.graceUntil) : "FREE", tokens: tokens.filter((t) => !t.revokedAt).length, connectedAt: l.createdAt };
        }),
      );
      const tickets = await container.tickets.listForUser(user.userId);
      const sessions = await container.sessions.listForUser(user.userId);
      return c.json({ ok: true, user: userView(user), shops, tickets, sessions: sessions.length });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const PlanBody = z.object({ seats: z.number().int().min(0).max(100000).nullable(), note: z.string().max(2000).optional() });
  api.post("/users/:userId/plan", async (c) => {
    try {
      const admin = await requireAdmin(container, c);
      const body = PlanBody.parse(await c.req.json());
      const user = await container.accounts.adminSetPlan(c.req.param("userId"), body);
      container.log.info("admin: plan set", { by: admin.email, userId: user.userId, seats: body.seats });
      return c.json({ ok: true, user: userView(user) });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const NotesBody = z.object({ notes: z.string().max(4000) });
  api.post("/users/:userId/notes", async (c) => {
    try {
      await requireAdmin(container, c);
      const body = NotesBody.parse(await c.req.json());
      await container.users.setNotes(c.req.param("userId"), body.notes.trim() || null);
      return c.json({ ok: true });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const RoleBody = z.object({ role: z.enum(["user", "admin"]) });
  api.post("/users/:userId/role", async (c) => {
    try {
      const admin = await requireAdmin(container, c);
      const body = RoleBody.parse(await c.req.json());
      if (c.req.param("userId") === admin.userId && body.role !== "admin") throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "You cannot remove your own admin role.");
      await container.users.setRole(c.req.param("userId"), body.role);
      return c.json({ ok: true });
    } catch (e) {
      return apiError(c, e);
    }
  });

  api.post("/users/:userId/signout", async (c) => {
    try {
      await requireAdmin(container, c);
      await container.accounts.logoutEverywhere(c.req.param("userId"));
      return c.json({ ok: true });
    } catch (e) {
      return apiError(c, e);
    }
  });

  /** Sends the customer a sign-in link (support use: "I cannot log in"). */
  api.post("/users/:userId/magic-link", async (c) => {
    try {
      await requireAdmin(container, c);
      const user = await container.users.get(c.req.param("userId"));
      if (!user) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "User not found.");
      const r = await container.accounts.requestMagicLink(user.email);
      return c.json({ ok: true, ...(r.devLink ? { devLink: r.devLink } : {}) });
    } catch (e) {
      return apiError(c, e);
    }
  });

  // ---- tickets ----
  api.get("/tickets", async (c) => {
    try {
      await requireAdmin(container, c);
      const status = (c.req.query("status") ?? "all") as any;
      const q = c.req.query("q") ?? undefined;
      const tickets = await container.tickets.listAll({ status, q });
      const userIds = [...new Set(tickets.map((t) => t.userId))];
      const users = new Map<string, UserRow>();
      for (const id of userIds) {
        const u = await container.users.get(id);
        if (u) users.set(id, u);
      }
      return c.json({ ok: true, tickets: tickets.map((t) => ({ ...t, userEmail: users.get(t.userId)?.email ?? null, userName: users.get(t.userId)?.name ?? null })), counts: await container.tickets.counts() });
    } catch (e) {
      return apiError(c, e);
    }
  });

  api.get("/tickets/:ticketId", async (c) => {
    try {
      await requireAdmin(container, c);
      const ticket = await container.tickets.get(c.req.param("ticketId"));
      if (!ticket) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Ticket not found.");
      const messages = await container.tickets.messages(ticket.ticketId, { includeInternal: true });
      const user = await container.users.get(ticket.userId);
      return c.json({ ok: true, ticket, messages, user: user ? userView(user) : null });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const AdminReplyBody = z.object({ body: z.string().min(1).max(20000), internal: z.boolean().optional(), status: z.enum(["open", "answered", "waiting", "closed"]).optional() });
  api.post("/tickets/:ticketId/reply", async (c) => {
    try {
      const admin = await requireAdmin(container, c);
      const body = AdminReplyBody.parse(await c.req.json());
      const message = await container.ticketService.replyAsAdmin(admin, c.req.param("ticketId"), body.body, { internal: body.internal, status: body.status });
      return c.json({ ok: true, message });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const TicketPatch = z.object({ status: z.enum(["open", "answered", "waiting", "closed"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), category: z.string().max(40).optional() });
  api.post("/tickets/:ticketId", async (c) => {
    try {
      await requireAdmin(container, c);
      const body = TicketPatch.parse(await c.req.json());
      const ticket = await container.tickets.update(c.req.param("ticketId"), body);
      return c.json({ ok: true, ticket });
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.route("/api/panel", api);
}
