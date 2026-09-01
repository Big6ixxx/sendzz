self.addEventListener('install', (_event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Standard fetch handler required for PWA installability criteria
  event.respondWith(fetch(event.request));
});

// Web Push event listener
self.addEventListener('push', (event) => {
  if (event.data) {
    try {
      const data = event.data.json();
      const title = data.title || 'Sendzz Notification';
      const options = {
        body: data.body || '',
        icon: '/Sendz-192.png',
        badge: '/Sendz-192.png',
        data: data.data || {},
        vibrate: [100, 50, 100],
      };
      // Tell any open page as well as showing the notification.
      //
      // A push is the earliest the device knows a withdrawal settled — it is sent the moment
      // the provider webhook lands, while an open page only finds out on its next poll. Without
      // this the notification consistently beat the screen it belongs to, so the user was told
      // their money had arrived by a banner while the app still showed a spinner.
      //
      // The page decides what to do with it; this only relays. Whichever learns first wins.
      event.waitUntil(
        Promise.all([
          self.registration.showNotification(title, options),
          self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
              for (const client of clients) {
                client.postMessage({ type: 'sendzz:push', payload: data });
              }
            })
            .catch(() => {}),
        ])
      );
    } catch (e) {
      const text = event.data.text();
      event.waitUntil(
        self.registration.showNotification('Sendzz Alert', {
          body: text,
          icon: '/Sendz-192.png',
        })
      );
    }
  }
});

// Handle notification click to redirect users
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/dashboard';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('/dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
