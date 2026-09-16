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

const ADMIN = "admin@example.com";

async function setup() {
  dataDir = mkdtempSync(join(tmpdir(), "sm-posts-"));
  const config = loadConfig({
    SHOPMANAGER_DEMO: "1",
    DATA_DIR: dataDir,
    APP_URL: "http://localhost:3000",
    EMAIL_PROVIDER: "console",
    ADMIN_EMAILS: ADMIN,
  } as any);
  container = await buildContainer(config, { dbPath: ":memory:" });
  app = buildApp(container);
}

afterEach(() => {
  container?.closeDb();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function signIn(email: string): Promise<string> {
  const login = await app.request("/api/account/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const { devLink } = (await login.json()) as { devLink: string };
  const url = new URL(devLink);
  const verify = await app.request(url.pathname + url.search, { redirect: "manual" });
  return (verify.headers.get("set-cookie") ?? "").split(";")[0]!;
}

const post = (over: Record<string, unknown> = {}) => ({
  slug: "first-post",
  title: "First post",
  description: "A description.",
  body: [{ type: "p", text: "Hello." }],
  status: "published",
  ...over,
});

async function save(cookie: string, body: unknown, path = "/api/panel/posts") {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("posts api", () => {
  it("keeps drafts out of the public feed and publishes the rest", async () => {
    await setup();
    const cookie = await signIn(ADMIN);

    expect((await save(cookie, post())).status).toBe(200);
    expect((await save(cookie, post({ slug: "draft-post", title: "Draft", status: "draft" }))).status).toBe(200);

    const publicList = (await (await app.request("/api/posts")).json()) as { posts: { slug: string }[] };
    expect(publicList.posts.map((p) => p.slug)).toEqual(["first-post"]);

    expect((await app.request("/api/posts/draft-post")).status).toBe(404);

    const adminList = (await (await app.request("/api/panel/posts", { headers: { cookie } })).json()) as { posts: unknown[] };
    expect(adminList.posts).toHaveLength(2);
  });

  it("requires an admin session to read drafts or write", async () => {
    await setup();
    expect((await app.request("/api/panel/posts")).status).toBe(401);

    const plain = await signIn("someone@example.com");
    expect((await app.request("/api/panel/posts", { headers: { cookie: plain } })).status).toBe(403);
    expect((await save(plain, post())).status).toBe(403);
  });

  it("normalises the slug and defaults the publish date", async () => {
    await setup();
    const cookie = await signIn(ADMIN);

    const res = await save(cookie, post({ slug: "  Hello World!  " }));
    const { post: saved } = (await res.json()) as { post: { slug: string; publishedAt: string } };
    expect(saved.slug).toBe("hello-world");
    expect(saved.publishedAt).toBeTruthy();
  });

  it("imports a JSON file, replacing posts that share a slug", async () => {
    await setup();
    const cookie = await signIn(ADMIN);
    await save(cookie, post({ title: "Original" }));

    const res = await save(
      cookie,
      { posts: [post({ title: "Replaced" }), post({ slug: "second", title: "Second" })] },
      "/api/panel/posts/import",
    );
    const body = (await res.json()) as { imported: string[]; errors: unknown[] };
    expect(body.imported).toEqual(["first-post", "second"]);
    expect(body.errors).toEqual([]);

    const list = (await (await app.request("/api/posts")).json()) as { posts: { slug: string; title: string }[] };
    expect(list.posts).toHaveLength(2);
    expect(list.posts.find((p) => p.slug === "first-post")?.title).toBe("Replaced");
  });

  it("reports a bad entry without discarding the rest of the import", async () => {
    await setup();
    const cookie = await signIn(ADMIN);

    // A slug made only of punctuation cannot produce a URL, so it must fail on its own.
    const res = await save(cookie, [post(), post({ slug: "---" })], "/api/panel/posts/import");
    const body = (await res.json()) as { imported: string[]; errors: { slug: string }[] };
    expect(body.imported).toEqual(["first-post"]);
    expect(body.errors.map((e) => e.slug)).toEqual(["---"]);
  });

  it("round-trips image blocks and the SEO fields", async () => {
    await setup();
    const cookie = await signIn(ADMIN);

    await save(
      cookie,
      post({
        body: [{ type: "image", src: "/a.png", alt: "An image", caption: "Caption" }],
        heroImage: "/hero.png",
        heroImageAlt: "Hero",
        canonicalUrl: "https://example.com/original/",
        tags: ["SEO"],
        noindex: true,
        schemaType: "Article",
        twitterCard: "summary",
      }),
    );

    const { post: saved } = (await (await app.request("/api/posts/first-post")).json()) as { post: any };
    expect(saved.body[0]).toMatchObject({ type: "image", src: "/a.png", alt: "An image" });
    expect(saved.heroImage).toBe("/hero.png");
    expect(saved.canonicalUrl).toBe("https://example.com/original/");
    expect(saved.tags).toEqual(["SEO"]);
    expect(saved.noindex).toBe(true);
    expect(saved.schemaType).toBe("Article");
    expect(saved.twitterCard).toBe("summary");
  });

  it("deletes a post", async () => {
    await setup();
    const cookie = await signIn(ADMIN);
    await save(cookie, post());

    const del = await app.request("/api/panel/posts/first-post", { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect((await app.request("/api/posts/first-post")).status).toBe(404);
    expect((await app.request("/api/panel/posts/first-post", { method: "DELETE", headers: { cookie } })).status).toBe(404);
  });
});
