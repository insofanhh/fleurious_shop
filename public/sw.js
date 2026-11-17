const CACHE = "fleurious-public-v5";
const IMAGE_CACHE = `${CACHE}-images`;
const OFFLINE_ASSETS = [
  "/offline.html",
  "/icon.svg",
  "/logo.svg",
  "/fonts/Lora-Regular.ttf",
  "/fonts/BeVietnamPro-Regular.ttf",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      // Replace older cache-first workers without waiting for every PWA tab to close.
      // This only updates the cache policy; it does not reload an open checkout.
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith("fleurious-public-") &&
                k !== CACHE &&
                k !== IMAGE_CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  // Let Next.js and the HTTP cache manage JS/CSS. Dev chunk URLs are reused after
  // edits: serving a cached layout chunk alongside fresh HTML breaks hydration.
  // Pin the static fallback, its logo and fonts independently of the image cache.
  if (OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then(
          async (cache) =>
            (await cache.match(url.pathname)) ?? fetch(event.request),
        ),
    );
    return;
  }
  // Never cache application HTML, authenticated APIs, QR, checkout, payment, account or admin data.
  if (/^\/(images|icons|media)\//.test(url.pathname)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(event.request, response.clone());
          const keys = await cache.keys();
          if (keys.length > 80) await cache.delete(keys[0]);
        }
        return response;
      }),
    );
    return;
  }
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.open(CACHE).then((cache) => cache.match("/offline.html")),
      ),
    );
});
self.addEventListener("push", (event) => {
  let data = {
    title: "Fleurious",
    body: "Có một cập nhật dành cho bạn.",
    url: "/account",
  };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url },
      tag: "fleurious-update",
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url ?? "/account",
    self.location.origin,
  );
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(target.href));
});
