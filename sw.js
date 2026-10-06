"use strict";

// Lets the app shell itself still load with zero connectivity, e.g.
// airplane mode.
//
// Only same-origin requests and pdf.js (loaded from cdnjs) are handled
// here - MyTime-roster/weather calls and any future flight-data API are
// left alone entirely (never intercepted, never cached) so their own
// timeout/error handling in app.js keeps working exactly as before.
//
// Strategy: network-first, falling back to whatever was cached the last
// time each file loaded successfully. This - not a fixed precache list -
// is what keeps the existing "?v=N" cache-busting convention working
// without having to also update a version list in here on every change:
// a new "?v=N" is simply a new URL the first online load caches, while
// the old one is left behind, unused.
const CACHE_NAME = "pilotdashboard-shell-v1";
const CDNJS_HOST = "cdnjs.cloudflare.com";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(["./", "./index.html", "./manifest.webmanifest"]).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isAppShell = url.origin === self.location.origin;
  const isPdfJs = url.hostname === CDNJS_HOST;
  if (!isAppShell && !isPdfJs) return; // not ours to handle - straight to the network, uncached

  event.respondWith(
    // cache: "no-store" - "network-first" above the Cache API is pointless
    // if this fetch() itself quietly answers from Safari's own HTTP cache
    // instead of actually hitting the network (observed: a just-deployed
    // index.html not showing up for several minutes even while online).
    // The *offline* fallback (catch below) still uses the Cache API as
    // intended - only this always-prefer-fresh fetch is affected.
    fetch(req, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
      )
  );
});
