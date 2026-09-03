// Oxyzen Luxury Music Platform — Background Media & Mobile Notification Controller
const CACHE_NAME = 'oxyzen-media-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients && clients.length > 0) {
        const client = clients[0];
        if (action === 'prev') {
          client.postMessage({ type: 'PREV_TRACK' });
        } else if (action === 'toggle' || action === 'playpause') {
          client.postMessage({ type: 'TOGGLE_PLAY' });
        } else if (action === 'next') {
          client.postMessage({ type: 'NEXT_TRACK' });
        } else if (action === 'like') {
          client.postMessage({ type: 'LIKE_TRACK' });
        } else {
          // Tap on notification body -> bring window to focus
          if ('focus' in client) client.focus();
        }
      } else {
        if (self.clients.openWindow) {
          self.clients.openWindow('/');
        }
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SHOW_MEDIA_NOTIFICATION') {
    const { title, artist, image, isPlaying, isLiked } = event.data;
    const playPauseActionTitle = isPlaying ? '⏸️ Pause' : '▶️ Play';
    const likeActionTitle = isLiked ? '💖 Liked' : '🤍 Like';

    self.registration.showNotification(title || 'Oxyzen Music', {
      body: `${artist || 'Unknown Artist'} • ${isPlaying ? 'Playing' : 'Paused'}`,
      icon: image || '/static/assets/logo.png',
      badge: '/static/assets/logo.png',
      tag: 'oxyzen-media-player',
      silent: true,
      renotify: false,
      actions: [
        { action: 'prev', title: '⏮️ Prev' },
        { action: 'toggle', title: playPauseActionTitle },
        { action: 'next', title: '⏭️ Next' },
        { action: 'like', title: likeActionTitle }
      ]
    }).catch((err) => {
      console.warn('Service worker notification failed:', err);
    });
  } else if (event.data.type === 'CLEAR_MEDIA_NOTIFICATION') {
    self.registration.getNotifications({ tag: 'oxyzen-media-player' }).then((notifications) => {
      notifications.forEach((n) => n.close());
    });
  }
});
