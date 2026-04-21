// ============================================================
// Student Portal Service Worker
// Enables real background push notifications on mobile phones
// ============================================================

const CACHE_VERSION = "sp-v1";
const CACHE_ASSETS = ["/", "/index.html"];

// Cache critical assets on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Handle Web Push events (sent from server via Web Push API) ──────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { title: "New Notification", body: event.data?.text() || "" };
  }

  const options = {
    body: data.body || "You have a new academic notification.",
    icon: "/pwa-192x192.png",
    badge: "/pwa-64x64.png",
    vibrate: [200, 100, 200],
    tag: data.tag || "student-notification",
    renotify: true,
    data: {
      url: data.url || "/",
      notificationId: data.notificationId
    },
    actions: [
      { action: "view", title: "View" },
      { action: "dismiss", title: "Dismiss" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "📢 New Notification", options)
  );
});

// ── Handle notification click ────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If student portal is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});

// ── Polling-based push fallback ───────────────────────────────────────────────
// Since this app uses long-polling, we register a background sync
// that checks for new notifications every time connectivity is restored.
self.addEventListener("sync", (event) => {
  if (event.tag === "check-notifications") {
    event.waitUntil(checkForNewNotifications());
  }
});

async function checkForNewNotifications() {
  const studentId = await getFromStore("studentId");
  const token     = await getFromStore("token");
  const tenantId  = await getFromStore("tenantId") || "default-campus";
  const apiBase   = await getFromStore("apiBase")  || "http://localhost:4000";

  if (!studentId || !token) return;

  try {
    const r = await fetch(
      `${apiBase}/notifications?userId=${studentId}&status=delivered`,
      { headers: { "x-tenant-id": tenantId, Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const items = data.notifications || [];
    const prevCount = (await getFromStore("notifCount")) || 0;

    if (items.length > prevCount) {
      const diff = items.length - prevCount;
      const latest = items[0];
      await self.registration.showNotification(latest?.documentTitle || "📢 New Notification", {
        body: latest?.content?.slice(0, 100) || `${diff} new notification${diff > 1 ? "s" : ""}`,
        icon: "/pwa-192x192.png",
        badge: "/pwa-64x64.png",
        vibrate: [200, 100, 200],
        tag: "poll-notification",
        renotify: true
      });
    }

    await setToStore("notifCount", items.length);
  } catch {}
}

// ── Minimal IDB helpers ───────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sp-store", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getFromStore(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function setToStore(key, value) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = resolve;
  });
}
