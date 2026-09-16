/** Support tickets: one thread per ticket, messages from the user or an operator (role admin). */
import type { Kysely } from "kysely";
import type { Schema } from "./schema.js";

export type TicketStatus = "open" | "answered" | "waiting" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface TicketRow {
  ticketId: string;
  number: number;
  userId: string;
  shopId: string | null;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessageBy: "user" | "admin";
  closedAt: string | null;
}

export interface TicketMessageRow {
  messageId: string;
  ticketId: string;
  authorUserId: string;
  authorRole: "user" | "admin";
  body: string;
  internal: boolean;
  createdAt: string;
}

function mapTicket(r: any): TicketRow {
  return {
    ticketId: r.ticket_id,
    number: Number(r.number),
    userId: r.user_id,
    shopId: r.shop_id ?? null,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastMessageAt: r.last_message_at,
    lastMessageBy: r.last_message_by === "admin" ? "admin" : "user",
    closedAt: r.closed_at ?? null,
  };
}

function mapMessage(r: any): TicketMessageRow {
  return { messageId: r.message_id, ticketId: r.ticket_id, authorUserId: r.author_user_id, authorRole: r.author_role === "admin" ? "admin" : "user", body: r.body, internal: Number(r.internal) === 1, createdAt: r.created_at };
}

export class TicketRepo {
  constructor(private readonly db: Kysely<Schema>) {}

  async create(input: { ticketId: string; messageId: string; userId: string; shopId?: string | null; subject: string; category?: string; priority?: TicketPriority; body: string }): Promise<TicketRow> {
    const now = new Date().toISOString();
    const max = await this.db.selectFrom("tickets").select((eb) => eb.fn.max("number").as("m")).executeTakeFirst();
    const number = Number((max as any)?.m ?? 1000) + 1;
    await this.db
      .insertInto("tickets")
      .values({
        ticket_id: input.ticketId,
        number,
        user_id: input.userId,
        shop_id: input.shopId ?? null,
        subject: input.subject,
        category: input.category ?? "general",
        priority: input.priority ?? "normal",
        status: "open",
        created_at: now,
        updated_at: now,
        last_message_at: now,
        last_message_by: "user",
        closed_at: null,
      })
      .execute();
    await this.db
      .insertInto("ticket_messages")
      .values({ message_id: input.messageId, ticket_id: input.ticketId, author_user_id: input.userId, author_role: "user", body: input.body, internal: 0, created_at: now })
      .execute();
    return (await this.get(input.ticketId))!;
  }

  async get(ticketId: string): Promise<TicketRow | null> {
    const r = await this.db.selectFrom("tickets").selectAll().where("ticket_id", "=", ticketId).executeTakeFirst();
    return r ? mapTicket(r) : null;
  }

  async listForUser(userId: string): Promise<TicketRow[]> {
    const rows = await this.db.selectFrom("tickets").selectAll().where("user_id", "=", userId).orderBy("updated_at", "desc").execute();
    return rows.map(mapTicket);
  }

  async listAll(opts: { status?: TicketStatus | "all"; limit?: number; q?: string } = {}): Promise<TicketRow[]> {
    let q = this.db.selectFrom("tickets").selectAll();
    if (opts.status && opts.status !== "all") q = q.where("status", "=", opts.status);
    if (opts.q) q = q.where("subject", "like", `%${opts.q}%`);
    const rows = await q.orderBy("updated_at", "desc").limit(opts.limit ?? 200).execute();
    return rows.map(mapTicket);
  }

  async counts(): Promise<Record<TicketStatus, number>> {
    const rows = await this.db.selectFrom("tickets").select(["status"]).select((eb) => eb.fn.count("ticket_id").as("n")).groupBy("status").execute();
    const out: Record<TicketStatus, number> = { open: 0, answered: 0, waiting: 0, closed: 0 };
    for (const r of rows as any[]) out[r.status as TicketStatus] = Number(r.n);
    return out;
  }

  async messages(ticketId: string, opts: { includeInternal?: boolean } = {}): Promise<TicketMessageRow[]> {
    let q = this.db.selectFrom("ticket_messages").selectAll().where("ticket_id", "=", ticketId);
    if (!opts.includeInternal) q = q.where("internal", "=", 0);
    const rows = await q.orderBy("created_at", "asc").execute();
    return rows.map(mapMessage);
  }

  async addMessage(input: { messageId: string; ticketId: string; authorUserId: string; authorRole: "user" | "admin"; body: string; internal?: boolean }): Promise<TicketMessageRow> {
    const now = new Date().toISOString();
    await this.db
      .insertInto("ticket_messages")
      .values({ message_id: input.messageId, ticket_id: input.ticketId, author_user_id: input.authorUserId, author_role: input.authorRole, body: input.body, internal: input.internal ? 1 : 0, created_at: now })
      .execute();
    if (!input.internal) {
      const status: TicketStatus = input.authorRole === "admin" ? "answered" : "open";
      await this.db.updateTable("tickets").set({ updated_at: now, last_message_at: now, last_message_by: input.authorRole, status, closed_at: null }).where("ticket_id", "=", input.ticketId).execute();
    }
    const r = await this.db.selectFrom("ticket_messages").selectAll().where("message_id", "=", input.messageId).executeTakeFirst();
    return mapMessage(r);
  }

  async update(ticketId: string, patch: { status?: TicketStatus; priority?: TicketPriority; category?: string; subject?: string }): Promise<TicketRow | null> {
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updated_at: now };
    if (patch.status) {
      set.status = patch.status;
      set.closed_at = patch.status === "closed" ? now : null;
    }
    if (patch.priority) set.priority = patch.priority;
    if (patch.category) set.category = patch.category;
    if (patch.subject) set.subject = patch.subject;
    await this.db.updateTable("tickets").set(set as any).where("ticket_id", "=", ticketId).execute();
    return this.get(ticketId);
  }
}
