import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("public/sw.js", "utf8");
function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const entries = new Map<string, Map<string, Response>>();
  const requests: string[] = [];
  let skips = 0,
    claims = 0,
    offline = false;
  const key = (request: string | Request) =>
    typeof request === "string" ? request : request.url;
  const caches = {
    keys: async () => [...entries.keys()],
    delete: async (name: string) => entries.delete(name),
    open: async (name: string) => {
      if (!entries.has(name)) entries.set(name, new Map());
      const data = entries.get(name)!;
      return {
        addAll: async (paths: string[]) => {
          for (const path of paths) data.set(path, new Response(path));
        },
        match: async (request: string | Request) =>
          data.get(key(request))?.clone(),
        put: async (request: string | Request, response: Response) => {
          data.set(key(request), response);
        },
        keys: async () => [...data.keys()],
        delete: async (request: string | Request) => data.delete(key(request)),
      };
    },
    match: async (request: string | Request) => {
      for (const data of entries.values())
        if (data.has(key(request))) return data.get(key(request))!.clone();
    },
  };
  runInNewContext(source, {
    URL,
    caches,
    fetch: async (request: Request) => {
      requests.push(request.url);
      if (offline || request.url.endsWith("/offline"))
        throw new Error("Offline");
      return new Response("fresh network content");
    },
    self: {
      location: { origin: "https://shop.test" },
      addEventListener: (type: string, fn: (event: any) => void) => {
        handlers[type] = fn;
      },
      skipWaiting: async () => {
        skips++;
      },
      clients: {
        claim: async () => {
          claims++;
        },
      },
    },
  });
  return {
    entries,
    caches,
    requests,
    stats: () => ({ skips, claims }),
    setOffline: () => {
      offline = true;
    },
    lifecycle: async (type: string) => {
      let pending: Promise<unknown> | undefined;
      handlers[type]({
        waitUntil: (value: Promise<unknown>) => {
          pending = value;
        },
      });
      await pending;
    },
    fetch: (path: string, mode = "cors", method = "GET") => {
      let response: Promise<Response> | undefined;
      handlers.fetch({
        request: { url: new URL(path, "https://shop.test").href, method, mode },
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      return response;
    },
  };
}

test("SW never serves stale Next.js layout chunks, CSS or HMR from Cache Storage", async () => {
  const sw = worker();
  for (const path of [
    "/_next/static/chunks/app/admin/layout.js",
    "/_next/static/css/app/layout.css",
    "/_next/static/webpack/update.hot-update.js",
  ]) {
    const cache = await sw.caches.open("fleurious-public-v4");
    await cache.put(
      new Request("https://shop.test" + path),
      new Response("old navigation"),
    );
    assert.equal(
      sw.fetch(path),
      undefined,
      "Browser HTTP caching must handle Next resources",
    );
  }
});

test("SW upgrade evicts old Fleurious chunks and claims open clients immediately", async () => {
  const sw = worker();
  await sw.caches.open("fleurious-public-v3");
  await sw.caches.open("fleurious-public-v4");
  await sw.caches.open("unrelated-app");
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  assert.deepEqual(await sw.caches.keys(), [
    "unrelated-app",
    "fleurious-public-v5",
  ]);
  assert.deepEqual(sw.stats(), { skips: 1, claims: 1 });
});

test("SW still caches public images and retains the offline page", async () => {
  const sw = worker();
  await sw.lifecycle("install");
  assert.equal(
    await (await sw.fetch("/images/flower.jpg"))!.text(),
    "fresh network content",
  );
  assert.equal(
    await (await sw.fetch("/images/flower.jpg"))!.text(),
    "fresh network content",
  );
  assert.equal(sw.requests.length, 1);
  assert.equal(
    await (await sw.fetch("/offline", "navigate"))!.text(),
    "/offline.html",
  );
});

test("SW does not cache authenticated responses or intercept writes", () => {
  const sw = worker();
  for (const path of [
    "/api/me",
    "/api/admin/orders",
    "/q/token",
    "/api/payments/sepay/webhook",
  ]) {
    assert.equal(sw.fetch(path), undefined);
    assert.equal(sw.fetch(path, "cors", "POST"), undefined);
  }
});

test("offline fallback serves its branded logo and Vietnamese fonts without a network connection", async () => {
  const sw = worker();
  await sw.lifecycle("install");
  sw.setOffline();
  for (const path of [
    "/logo.svg",
    "/icon.svg",
    "/fonts/Lora-Regular.ttf",
    "/fonts/BeVietnamPro-Regular.ttf",
  ]) {
    const response = await sw.fetch(path + "?v=2");
    assert.equal(await response!.text(), path);
  }
  assert.equal(sw.requests.length, 0);
  assert.equal(
    await (await sw.fetch("/checkout", "navigate"))!.text(),
    "/offline.html",
  );
});

test("browsing many product images cannot evict the offline page, logo or fonts", async () => {
  const sw = worker();
  await sw.lifecycle("install");
  for (let i = 0; i < 90; i++) await sw.fetch(`/images/flower-${i}.webp`);
  const images = await sw.caches.open("fleurious-public-v5-images");
  assert.equal((await images.keys()).length, 80);
  sw.setOffline();
  assert.equal(
    await (await sw.fetch("/offline.html"))!.text(),
    "/offline.html",
  );
  assert.equal(await (await sw.fetch("/logo.svg"))!.text(), "/logo.svg");
  assert.equal(
    await (await sw.fetch("/fonts/Lora-Regular.ttf"))!.text(),
    "/fonts/Lora-Regular.ttf",
  );
});
