// Service worker for Goodminton.
// Strategi: nettverk først, cache som offline-fallback. Kun same-origin
// statiske filer caches — API-kall (worker-proxy, Firebase, cup2000) går
// alltid rett på nett. Dermed forverres ikke cache-problemene på GitHub
// Pages: nye deployer plukkes opp ved neste last med nett.
var CACHE = 'goodminton-v2';
var ASSETS = ['/', '/index.html', '/style.css', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) { return c.addAll(ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function(r) {
      if (r.ok) {
        var kopi = r.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, kopi); });
      }
      return r;
    }).catch(function() {
      return caches.match(e.request).then(function(m) {
        if (m) return m;
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      });
    })
  );
});

self.addEventListener('push', function(e) {
  var d;
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { title: 'Goodminton', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Goodminton', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url || 'https://goodminton.no' }
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || 'https://goodminton.no';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        if (c.url.indexOf('goodminton.no') !== -1 && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
