/** Support tickets: user side and operator side, plus email notifications. */
import { ShopManagerAIError, ERROR_CODES, newId, type Logger } from "@shopmanagerai/shared";
import type { TicketPriority, TicketRepo, TicketRow, TicketStatus, UserRepo, UserRow } from "@shopmanagerai/storage";
import type { EmailSender } from "./email.js";

export const TICKET_CATEGORIES = ["general", "billing", "connection", "tool_bug", "feature_request", "account"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export interface TicketServiceDeps {
  tickets: TicketRepo;
  users: UserRepo;
  email: EmailSender;
  log: Logger;
  appUrl: string;
  brand: string;
  supportInbox: string | null;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export class TicketService {
  constructor(private readonly d: TicketServiceDeps) {}

  async create(user: UserRow, input: { subject: string; body: string; category?: string; shopId?: string | null; priority?: TicketPriority }): Promise<TicketRow> {
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (subject.length < 3) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Give the ticket a short subject.");
    if (body.length < 10) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Describe the problem in a few sentences.");
    const category = (TICKET_CATEGORIES as readonly string[]).includes(input.category ?? "") ? (input.category as TicketCategory) : "general";
    const open = (await this.d.tickets.listForUser(user.userId)).filter((t) => t.status !== "closed").length;
    if (open >= 20) throw new ShopManagerAIError(ERROR_CODES.RATE_LIMITED, "You have 20 open tickets. Close some before opening more.");
    const ticket = await this.d.tickets.create({ ticketId: newId("tkt"), messageId: newId("msg"), userId: user.userId, shopId: input.shopId ?? null, subject: clip(subject, 160), category, priority: input.priority ?? "normal", body: clip(body, 20_000) });
    if (this.d.supportInbox) {
      void this.d.email
        .send({
          to: this.d.supportInbox,
          subject: `[${this.d.brand}] New ticket #${ticket.number}: ${ticket.subject}`,
          text: `From: ${user.email}\nCategory: ${category}\nStore: ${input.shopId ?? "-"}\n\n${body}\n\nOpen: ${this.d.appUrl}/app/admin/tickets/${ticket.ticketId}`,
          html: `<p><b>From:</b> ${esc(user.email)}<br><b>Category:</b> ${category}<br><b>Store:</b> ${esc(input.shopId ?? "-")}</p><pre style="white-space:pre-wrap;font:14px/1.5 sans-serif">${esc(body)}</pre><p><a href="${this.d.appUrl}/app/admin/tickets/${ticket.ticketId}">Open ticket #${ticket.number}</a></p>`,
        })
        .catch(() => undefined);
    }
    return ticket;
  }

  async getForUser(user: UserRow, ticketId: string) {
    const ticket = await this.d.tickets.get(ticketId);
    if (!ticket || ticket.userId !== user.userId) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Ticket not found.");
    const messages = await this.d.tickets.messages(ticketId);
    return { ticket, messages };
  }

  async replyAsUser(user: UserRow, ticketId: string, body: string) {
    const { ticket } = await this.getForUser(user, ticketId);
    const text = body.trim();
    if (text.length < 2) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Write a message.");
    const msg = await this.d.tickets.addMessage({ messageId: newId("msg"), ticketId, authorUserId: user.userId, authorRole: "user", body: clip(text, 20_000) });
    if (this.d.supportInbox) {
      void this.d.email.send({ to: this.d.supportInbox, subject: `[${this.d.brand}] Reply on #${ticket.number}: ${ticket.subject}`, text: `${user.email} wrote:\n\n${text}\n\n${this.d.appUrl}/app/admin/tickets/${ticketId}`, html: `<p><b>${esc(user.email)}</b> wrote:</p><pre style="white-space:pre-wrap;font:14px/1.5 sans-serif">${esc(text)}</pre><p><a href="${this.d.appUrl}/app/admin/tickets/${ticketId}">Open ticket</a></p>` }).catch(() => undefined);
    }
    return msg;
  }

  async closeAsUser(user: UserRow, ticketId: string) {
    await this.getForUser(user, ticketId);
    return this.d.tickets.update(ticketId, { status: "closed" });
  }

  // ---- operator side ----

  async replyAsAdmin(admin: UserRow, ticketId: string, body: string, opts: { internal?: boolean; status?: TicketStatus } = {}) {
    const ticket = await this.d.tickets.get(ticketId);
    if (!ticket) throw new ShopManagerAIError(ERROR_CODES.NOT_FOUND, "Ticket not found.");
    const text = body.trim();
    if (text.length < 1) throw new ShopManagerAIError(ERROR_CODES.INVALID_INPUT, "Write a message.");
    const msg = await this.d.tickets.addMessage({ messageId: newId("msg"), ticketId, authorUserId: admin.userId, authorRole: "admin", body: clip(text, 20_000), internal: opts.internal });
    if (opts.status) await this.d.tickets.update(ticketId, { status: opts.status });
    if (!opts.internal) {
      const customer = await this.d.users.get(ticket.userId);
      if (customer) {
        void this.d.email
          .send({
            to: customer.email,
            subject: `Re: [#${ticket.number}] ${ticket.subject}`,
            text: `${this.d.brand} support replied:\n\n${text}\n\nReply or view the ticket: ${this.d.appUrl}/app/support/${ticketId}`,
            html: `<p>${esc(this.d.brand)} support replied to your ticket <b>#${ticket.number}</b>:</p><pre style="white-space:pre-wrap;font:14px/1.5 sans-serif">${esc(text)}</pre><p><a href="${this.d.appUrl}/app/support/${ticketId}">Reply or view the ticket</a></p>`,
          })
          .catch(() => undefined);
      }
    }
    return msg;
  }
}
