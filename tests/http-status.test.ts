import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test, before, after, describe } from "node:test";
import { db } from "../src/lib/db";

// Run with npm run test:http. Requires a current production build and uses
// only the isolated *_test database selected by scripts/test.ts.
describe(
  "HTTP status on the production build",
  { skip: process.env.HTTP_STATUS_TEST !== "1" },
  () => {
    const run = `http-${randomUUID()}`;
    const slug = (name: string) => `${run}-${name}`;
    let base: string;
    let child: ChildProcess | undefined;
    let safeDatabase = false;

    before(async () => {
      assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
      safeDatabase = true;
      for (const active of [true, false]) {
        const key = active ? "active" : "hidden";
        await db.product.create({
          data: {
            slug: slug(key),
            name: slug(key),
            subtitle: "Hoa kiểm thử HTTP",
            description: "Hoa kiểm thử",
            category: "Bó hoa",
            occasion: "Sinh nhật",
            color: "Đỏ",
            image: "/images/roses.webp",
            images: [],
            active,
            variants: {
              create: { name: "S", sku: slug(key), price: 100000, stock: 1 },
            },
          },
        });
        await db.taxonomy.create({
          data: {
            slug: slug(key),
            name: slug(key),
            kind: "COLLECTION",
            description: "",
            productIds: [],
            active,
          },
        });
        await db.content.create({
          data: {
            slug: slug(key),
            title: slug(key),
            body: "Nội dung kiểm thử",
            kind: "article",
            active,
          },
        });
      }
      await db.taxonomy.create({
        data: {
          slug: slug("size"),
          name: slug("size"),
          kind: "SIZE",
          description: "",
          productIds: [],
        },
      });

      const socket = createServer();
      socket.listen(0, "127.0.0.1");
      await once(socket, "listening");
      const address = socket.address();
      assert(address && typeof address !== "string");
      const port = address.port;
      await new Promise<void>((resolve, reject) =>
        socket.close((error) => (error ? reject(error) : resolve())),
      );
      base = `http://127.0.0.1:${port}`;
      child = spawn(
        process.execPath,
        [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            NODE_ENV: "production",
            VERCEL: "0",
            APP_URL: base,
          },
          stdio: "ignore",
        },
      );
      let launchError: Error | undefined;
      child.on("error", (error) => {
        launchError = error;
      });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (launchError) throw launchError;
        assert.equal(
          child.exitCode,
          null,
          "Next server exited before becoming ready",
        );
        try {
          const response = await fetch(`${base}/manifest.webmanifest`, {
            signal: AbortSignal.timeout(2000),
          });
          if (response.status === 200) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.fail("Next server did not become ready; run npm run build first");
    });

    after(async () => {
      try {
        if (child?.pid && child.exitCode === null) {
          const exited = once(child, "exit");
          child.kill();
          await exited;
        }
      } finally {
        if (safeDatabase) {
          await db.productVariant.deleteMany({
            where: { product: { slug: { startsWith: run } } },
          });
          await db.product.deleteMany({ where: { slug: { startsWith: run } } });
          await db.taxonomy.deleteMany({
            where: { slug: { startsWith: run } },
          });
          await db.content.deleteMany({ where: { slug: { startsWith: run } } });
        }
        await db.$disconnect();
      }
    });

    async function check(path: string, status: number, init?: RequestInit) {
      const response = await fetch(`${base}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        ...init,
      });
      assert.equal(response.status, status, `${init?.method ?? "GET"} ${path}`);
      return response.text();
    }

    test("absent machine-readable resources return real 404 for GET and HEAD", async () => {
      for (const path of [
        "/llms.txt",
        "/.well-known/ard.json",
        "/.well-known/ai-catalog.json",
        `/${slug("image")}.png`,
      ]) {
        await check(path, 404);
        assert.equal(await check(path, 404, { method: "HEAD" }), "");
        await check(path, 404, { headers: { "User-Agent": "Googlebot" } });
      }
    });

    test("unknown routes and trailing segments do not render a fallback page with 200", async () => {
      for (const path of [
        `/${slug("missing")}`,
        `/flowers/${slug("missing")}`,
        `/collections/${slug("missing")}`,
        "/about/extra",
        "/flowers/extra/extra",
        `/flowers/${slug("active")}/extra`,
        `/collections/${slug("active")}/extra`,
        `/${slug("active")}/extra`,
        "/auth/unknown",
        "/auth/login/extra",
        "/account/unknown",
        "/account/orders/extra",
        "/membership/invoices",
        "/membership/invoices/id/extra",
        "/track-order/extra",
      ])
        await check(path, 404);
    });

    test("hidden products and content, hidden collections and size taxonomies return 404", async () => {
      for (const path of [
        `/flowers/${slug("hidden")}`,
        `/collections/${slug("hidden")}`,
        `/${slug("hidden")}`,
        `/collections/${slug("size")}`,
      ])
        await check(path, 404);
    });

    test("active products, collections and CMS pages keep HTTP 200 and concrete metadata", async () => {
      for (const path of [
        `/flowers/${slug("active")}`,
        `/collections/${slug("active")}`,
        `/${slug("active")}`,
      ]) {
        const body = await check(path, 200);
        assert.match(
          body,
          new RegExp(`<title>[^<]*${slug("active")}[^<]*</title>`),
        );
      }
      const product = await check(`/flowers/${slug("active")}`, 200);
      assert.match(product, /application\/ld\+json/);
      assert.match(product, /"@type":"Product"/);
    });

    test("existing public pages and authenticated entry points remain reachable", async () => {
      for (const path of [
        "/",
        "/flowers",
        "/collections",
        "/collections/sinh-nhat",
        "/about",
        "/delivery",
        "/returns",
        "/privacy",
        "/cham-hoa",
        "/membership",
        "/streak",
        "/cart",
        "/checkout",
        "/favorites",
        "/notifications",
        "/track-order",
        "/account",
        "/account/orders",
        "/account/profile",
        "/account/membership",
        "/account/addresses",
        "/account/rewards",
        "/account/notifications",
        "/auth",
        "/auth/login?next=/q/test",
        "/auth/register",
        "/auth/forgot",
        "/auth/reset?token=test",
        "/auth/verify?token=test",
        "/auth/google-mfa",
        "/orders/test-id",
        "/q/test-token",
        "/membership/invoices/test-id",
      ])
        await check(path, 200);
      for (const path of [
        "/robots.txt",
        "/sitemap.xml",
        "/manifest.webmanifest",
        "/sw.js",
        "/icon.svg",
        "/google9602e66580806845.html",
      ])
        await check(path, 200);
    });
  },
);
