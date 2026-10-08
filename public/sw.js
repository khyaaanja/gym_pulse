// GymPulse service worker.
// Pages and API responses are per-user and per-gym, so they are never cached here: a shared phone must not
// show one member's dashboard to the next. Only the offline fallback and app icons are cached.
const CACHE = "gympulse-shell-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (PRECACHE.includes(new URL(req.url).pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

// ── Web Push ──────────────────────────────────────────────────────────────────────────────────────────
// Payloads are encrypted end to end by the push service and carry only what the in-app notification shows.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GymPulse", body: event.data ? event.data.text() : "" };
  }
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/app/notifications";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "GymPulse", {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag || undefined,
        data: { url },
        requireInteraction: data.category === "AT_RISK",
      }),
      // Open tabs refresh their bell and show a toast straight away instead of waiting for the next poll.
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: "gp:notification" }))),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/app/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      // navigate() rejects for a tab this worker doesn't control yet; open a fresh window then.
      if (win) return win.focus().then((w) => (w || win).navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});

// The browser rotated this device's subscription: re-register it for the same signed-in session.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch("/api/push", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    })(),
  );
});
