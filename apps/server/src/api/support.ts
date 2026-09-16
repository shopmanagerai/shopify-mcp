/** Customer-side support tickets under /api/account/support/*. */
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.js";
import { apiError, requireSession } from "./account.js";
import { TICKET_CATEGORIES } from "../accounts/tickets.js";

export function mountSupportApi(app: Hono, container: Container): void {
  const api = new Hono();

  api.get("/", async (c) => {
    try {
      const { user } = await requireSession(container, c);
      const tickets = await container.tickets.listForUser(user.userId);
      return c.json({ ok: true, tickets, categories: TICKET_CATEGORIES });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const CreateBody = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(20000), category: z.string().max(40).optional(), shopId: z.string().max(200).optional().nullable() });
  api.post("/", async (c) => {
    try {
      const { user } = await requireSession(container, c);
      const body = CreateBody.parse(await c.req.json());
      const ticket = await container.ticketService.create(user, body);
      return c.json({ ok: true, ticket });
    } catch (e) {
      return apiError(c, e);
    }
  });

  api.get("/:ticketId", async (c) => {
    try {
      const { user } = await requireSession(container, c);
      const r = await container.ticketService.getForUser(user, c.req.param("ticketId"));
      return c.json({ ok: true, ...r });
    } catch (e) {
      return apiError(c, e);
    }
  });

  const ReplyBody = z.object({ body: z.string().min(1).max(20000) });
  api.post("/:ticketId/reply", async (c) => {
    try {
      const { user } = await requireSession(container, c);
      const body = ReplyBody.parse(await c.req.json());
      const message = await container.ticketService.replyAsUser(user, c.req.param("ticketId"), body.body);
      return c.json({ ok: true, message });
    } catch (e) {
      return apiError(c, e);
    }
  });

  api.post("/:ticketId/close", async (c) => {
    try {
      const { user } = await requireSession(container, c);
      const ticket = await container.ticketService.closeAsUser(user, c.req.param("ticketId"));
      return c.json({ ok: true, ticket });
    } catch (e) {
      return apiError(c, e);
    }
  });

  app.route("/api/account/support", api);
}
