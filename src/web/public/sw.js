// Keeps the app shell on the phone so Fabric opens inside a church with no
// signal. API requests are never cached here; the app keeps its own last-known
// copies and an upload queue (src/web/offline.ts).
const CACHE = "fabric-shell-v2";

// Store the page and the script and style files it names, so the very first
// visit is enough for the app to open offline afterwards.
async function storeShell() {
  const c = await caches.open(CACHE);
  const res = await fetch("/", { cache: "no-cache" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await c.put("/", res);
  const files = [...new Set(html.match(/\/assets\/[^"']+/g) || [])];
  await Promise.all(files.map((f) => c.add(f).catch(() => {})));
}

self.addEventListener("install", (event) => {
  event.waitUntil(storeShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: try the network, fall back to the stored app shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === "/") caches.open(CACHE).then((c) => c.put("/", res.clone()));
          else if (res.ok) caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Built files have content hashes in their names, so a stored copy never goes stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
