const CACHE = "fleurious-public-v2";
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["/offline.html", "/icon.svg"]))); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("message", event => { if (event.data === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never cache HTML, authenticated API responses, QR, checkout, payment, account or admin data.
  if (/^\/(images|icons|media)\//.test(url.pathname) || /^\/_next\/static\//.test(url.pathname)) { event.respondWith(caches.open(CACHE).then(async cache => { const hit = await cache.match(event.request); if (hit) return hit; const response = await fetch(event.request); if (response.ok) { await cache.put(event.request, response.clone()); const keys = await cache.keys(); if (keys.length > 80) await cache.delete(keys[0]); } return response; })); return; }
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
});
self.addEventListener("push", event => { let data = { title: "Fleurious", body: "Có một cập nhật dành cho bạn.", url: "/account" }; try { data = { ...data, ...event.data.json() }; } catch {} event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: data.url }, tag: "fleurious-update" })); });
self.addEventListener("notificationclick", event => { event.notification.close(); const target = new URL(event.notification.data?.url ?? "/account", self.location.origin); if (target.origin !== self.location.origin) return; event.waitUntil(self.clients.openWindow(target.href)); });
