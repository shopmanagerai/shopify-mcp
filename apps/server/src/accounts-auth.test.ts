import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { buildContainer, type Container } from "./container.js";
import { buildApp } from "./app.js";
import type { Hono } from "hono";

let container: Container;
let app: Hono;
let dataDir: string;

async function setup(env: Record<string, string> = {}) {
  dataDir = mkdtempSync(join(tmpdir(), "sm-auth-"));
  const config = loadConfig({ SHOPMANAGER_DEMO: "1", DATA_DIR: dataDir, APP_URL: "http://localhost:3000", EMAIL_PROVIDER: "console", ADMIN_EMAILS: "boss@example.com", ...env } as any);
  container = await buildContainer(config, { dbPath: ":memory:" });
  await container.shopService.ensureDemoShop();
  app = buildApp(container);
}
afterEach(() => {
  container?.closeDb();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, cookie?: string) => app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path: string, cookie: string) => app.request(path, { headers: { cookie } });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("password auth", () => {
  it("signs up, signs in, rejects wrong password, and changes password", async () => {
    await setup();
    const su = await post("/api/account/signup", { email: "New@Example.com", password: "hunter22", name: "New" });
    expect(su.status).toBe(200);
    const suBody = (await su.json()) as any;
    expect(suBody.devLink).toMatch(/verify\?token=/); // confirmation email (dev echo)
    const c1 = cookieOf(su);
    const me = (await (await get("/api/account/me", c1)).json()) as any;
    expect(me.user.email).toBe("new@example.com");
    expect(me.user.hasPassword).toBe(true);
    expect(me.user.emailVerified).toBe(false);

    expect((await post("/api/account/signup", { email: "new@example.com", password: "another11" })).status).toBe(409);
    expect((await post("/api/account/signup", { email: "weak@example.com", password: "short" })).status).toBe(400);

    const bad = await post("/api/account/login-password", { email: "new@example.com", password: "wrong111" });
    expect(bad.status).toBe(401);
    const good = await post("/api/account/login-password", { email: "new@example.com", password: "hunter22" });
    expect(good.status).toBe(200);
    const c2 = cookieOf(good);

    expect((await post("/api/account/password", { current: "nope1234", next: "newpass99" }, c2)).status).toBe(403);
    expect((await post("/api/account/password", { current: "hunter22", next: "newpass99" }, c2)).status).toBe(200);
    expect((await post("/api/account/login-password", { email: "new@example.com", password: "hunter22" })).status).toBe(401);
    expect((await post("/api/account/login-password", { email: "new@example.com", password: "newpass99" })).status).toBe(200);

    // Opening the confirmation link marks the email verified.
    const verify = await app.request(new URL(suBody.devLink).pathname + new URL(suBody.devLink).search, { redirect: "manual" });
    expect(verify.headers.get("location")).toBe("/app?verified=1");
    const me2 = (await (await get("/api/account/me", cookieOf(verify))).json()) as any;
    expect(me2.user.emailVerified).toBe(true);
  });

  it("forgot-password link signs in and lands on settings; unknown emails get the same answer", async () => {
    await setup();
    await post("/api/account/signup", { email: "f@example.com", password: "forgot123" });
    const r = (await (await post("/api/account/password/forgot", { email: "f@example.com" })).json()) as any;
    expect(r.devLink).toMatch(/verify\?token=/);
    const res = await app.request(new URL(r.devLink).pathname + new URL(r.devLink).search, { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/app/settings?reset=1");
    const c = cookieOf(res);
    expect((await post("/api/account/password", { next: "reset4567" }, c)).status).toBe(403); // has a password: current required
    const unknown = await post("/api/account/password/forgot", { email: "nobody@example.com" });
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as any).devLink).toBeUndefined();
  });

  it("locks out after repeated failures", async () => {
    await setup();
    await post("/api/account/signup", { email: "lock@example.com", password: "lockme123" });
    for (let i = 0; i < 10; i++) await post("/api/account/login-password", { email: "lock@example.com", password: "wrong" + i });
    expect((await post("/api/account/login-password", { email: "lock@example.com", password: "lockme123" })).status).toBe(429);
  });
});

describe("support tickets and admin panel", () => {
  it("customer opens a ticket, admin replies, customer sees it; non-admin is refused", async () => {
    await setup();
    const cust = cookieOf(await post("/api/account/signup", { email: "cust@example.com", password: "custpass1" }));
    const boss = cookieOf(await post("/api/account/signup", { email: "boss@example.com", password: "bosspass1" }));

    const created = await post("/api/account/support", { subject: "Cannot connect Cursor", body: "I pasted the token but Cursor says unauthorized.", category: "connection" }, cust);
    expect(created.status).toBe(200);
    const ticket = ((await created.json()) as any).ticket;
    expect(ticket.number).toBeGreaterThan(1000);
    expect(ticket.status).toBe("open");

    expect((await get("/api/panel/overview", cust)).status).toBe(403);
    const ov = (await (await get("/api/panel/overview", boss)).json()) as any;
    expect(ov.stats.users).toBe(2);
    expect(ov.stats.tickets.open).toBe(1);

    const list = (await (await get("/api/panel/tickets?status=open", boss)).json()) as any;
    expect(list.tickets[0].userEmail).toBe("cust@example.com");

    expect((await post(`/api/panel/tickets/${ticket.ticketId}/reply`, { body: "Private: looks like a stale token.", internal: true }, boss)).status).toBe(200);
    expect((await post(`/api/panel/tickets/${ticket.ticketId}/reply`, { body: "Please create a new token and try again.", status: "waiting" }, boss)).status).toBe(200);

    const mine = (await (await get(`/api/account/support/${ticket.ticketId}`, cust)).json()) as any;
    expect(mine.ticket.status).toBe("waiting");
    expect(mine.messages.map((m: any) => m.authorRole)).toEqual(["user", "admin"]); // internal note hidden
    expect(mine.messages[1].body).toContain("new token");

    expect((await post(`/api/account/support/${ticket.ticketId}/reply`, { body: "That fixed it, thanks." }, cust)).status).toBe(200);
    expect((await post(`/api/account/support/${ticket.ticketId}/close`, {}, cust)).status).toBe(200);
    const closed = (await (await get(`/api/account/support/${ticket.ticketId}`, cust)).json()) as any;
    expect(closed.ticket.status).toBe("closed");

    // another customer cannot read it
    const other = cookieOf(await post("/api/account/signup", { email: "other@example.com", password: "otherpass1" }));
    expect((await get(`/api/account/support/${ticket.ticketId}`, other)).status).toBe(404);
  });

  it("admin can grant a plan manually and it projects onto the customer's stores", async () => {
    await setup();
    const cust = cookieOf(await post("/api/account/signup", { email: "grant@example.com", password: "grantpass1" }));
    const boss = cookieOf(await post("/api/account/signup", { email: "boss@example.com", password: "bosspass1" }));
    await post("/api/account/shops/connect", { shop: "demo" }, cust);
    const me = (await (await get("/api/account/me", cust)).json()) as any;
    expect(me.plan.state).toBe("FREE");

    const r = await post(`/api/panel/users/${me.user.userId}/plan`, { seats: 10, note: "Partner deal" }, boss);
    expect(r.status).toBe(200);
    const me2 = (await (await get("/api/account/me", cust)).json()) as any;
    expect(me2.plan.state).toBe("AGENCY_ACTIVE");
    expect(me2.plan.tier).toBe("growth");
    expect(me2.shops[0].entitlement).toBe("AGENCY_ACTIVE");

    const detail = (await (await get(`/api/panel/users/${me.user.userId}`, boss)).json()) as any;
    expect(detail.user.notes).toBe("Partner deal");
    expect(detail.shops[0].proSeat).toBe(true);

    await post(`/api/panel/users/${me.user.userId}/plan`, { seats: null }, boss);
    const me3 = (await (await get("/api/account/me", cust)).json()) as any;
    expect(me3.plan.state).toBe("FREE");
    expect(me3.shops[0].entitlement).toBe("FREE");
  });
});
