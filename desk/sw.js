// Motorwise Desk service worker: offline app shell + push notifications.
const VERSION = "mwdesk-v4";
const SHELL = ["./", "index.html", "manifest.webmanifest", "js/app.js", "js/ui.js", "js/data.js", "js/calc.js", "js/pdf.js", "js/config.js", "js/github.js", "js/website.js",
  "js/vendor/jspdf.umd.min.js", "fonts/AtkinsonHyperlegibleNext-400.ttf", "fonts/AtkinsonHyperlegibleNext-700.ttf", "fonts/AtkinsonHyperlegibleNext-800.ttf",
  "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== "mw-photos").map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // never cache Supabase data or files
  // Network first so updates arrive; fall back to the cached shell when offline.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "Motorwise Desk", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Motorwise Desk", { body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./#today" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url || "./#today";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => { for (const c of cs) { if ("focus" in c) { c.navigate(url); return c.focus(); } } return clients.openWindow(url); }));
});
