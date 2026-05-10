// Elefante — minimal service worker
//
// Goals:
//   1. Satisfy Chrome's PWA install requirement (needs a registered SW with fetch handler)
//   2. Not break deploys or serve stale content
//
// No caching — all requests go straight to the network.
// skipWaiting + clients.claim ensures a newly deployed SW activates immediately
// on the next page visit, so users never get stuck on a stale version.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

// Empty fetch handler — required for Chrome to recognise this as a PWA-capable SW.
// Without at least one fetch listener, Chrome will not show the install prompt.
// We intentionally do NOT cache anything here.
self.addEventListener('fetch', () => {})
