/*
 * Track Day service worker: web push only.
 * The server sends { title, body, href, tag }. Tapping a notification brings
 * the app forward (or opens it) at `href`.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Track Day", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Track Day";
  // Session reminders (15, 10, 5 minutes) replace one another so the lock screen
  // shows one current reminder. Everything else stacks.
  const tag = data.tag === "reminder" ? "reminder" : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag,
      renotify: Boolean(tag),
      data: { href: data.href || "/alerts" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/alerts";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(href);
            } catch {
              /* cross-origin or not yet controlled: leave the app where it is */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(href);
    })(),
  );
});
