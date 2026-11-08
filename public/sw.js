/**
 * ======================================================================================
 * HACHIHI DELIVERY – PWA CLIENT SERVICE WORKER (V1.3 PRODUCTION-READY)
 * ======================================================================================
 * TÍNH NĂNG VẬN HÀNH & TUÂN THỦ PRODUCTION:
 * 1. Push Notification API: Nhận và hiển thị thông báo đẩy khi có đơn hàng mới điều phối về máy.
 * 2. Caching Tile OpenStreetMap (OSM Tile Usage Policy Compliance):
 *    - Sử dụng bộ nhớ đệm riêng biệt 'hachihi-osm-tiles-v1' với chiến lược CacheFirst.
 *    - Giảm >90% tải truy vấn lên máy chủ tile cộng đồng OpenStreetMap (tile.openstreetmap.org).
 *    - Cho phép tài xế xem lại bản đồ các khu vực đã tải ngay cả khi mất sóng 4G/vào tầng hầm.
 *    - Tự động dọn dẹp (cache trimming) không để vượt quá 800 tile bản đồ.
 * 3. App Shell Offline Cache: Lưu trữ giao diện ứng dụng để mở tức thì.
 * 4. Background Notification Interaction: Chuyển hướng khi tài xế bấm thông báo đơn mới.
 * ======================================================================================
 */

const CACHE_NAME = 'hachihi-app-v1.3';
const TILES_CACHE_NAME = 'hachihi-osm-tiles-v1';
const MAX_TILES_LIMIT = 800; // Giới hạn số lượng tile lưu trong bộ nhớ đệm

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json'
];

/**
 * Hàm tỉa bớt cache cũ khi số lượng file vượt ngưỡng quy định
 */
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const itemsToDelete = keys.length - maxItems;
      for (let i = 0; i < itemsToDelete; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (err) {
    console.warn('[SW] trimCache warning:', err);
  }
}

// 1. Install Event: Cache essential assets and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Caching warning:', err);
      });
    })
  );
});

// 2. Activate Event: Claim clients immediately & clean obsolete caches (ngoại trừ TILES_CACHE)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== TILES_CACHE_NAME) {
              return caches.delete(key);
            }
          })
        );
      })
    ])
  );
});

// 3. Web Push Event (Nhận thông báo đẩy từ Push Server / Web Push API)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Hachihi Delivery', body: event.data.text() };
    }
  }

  const title = data.title || '📦 Đơn Hàng Mới Được Điều Phối!';
  const options = {
    body: data.body || 'Bạn có đơn hàng mới được điều phối về tuyến. Nhấn để xem chi tiết.',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    vibrate: data.vibrate || [200, 100, 200, 100, 200],
    data: data.data || { url: '/', timestamp: Date.now() },
    tag: data.tag || `order-dispatch-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'view_order', title: '👀 Xem đơn hàng' },
      { action: 'close', title: 'Đóng' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 4. Client Message Event
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // Hiển thị thông báo đẩy từ app
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const notificationOptions = {
      body: options.body || 'Có đơn hàng mới điều phối về máy bạn!',
      icon: options.icon || '/icon.svg',
      badge: options.badge || '/icon.svg',
      vibrate: options.vibrate || [250, 120, 250, 120, 350],
      data: options.data || { url: '/' },
      tag: options.tag || `hachihi-order-${Date.now()}`,
      renotify: true,
      requireInteraction: true,
      actions: options.actions || [
        { action: 'view_order', title: '📦 Mở danh sách đơn' },
        { action: 'close', title: '✕ Đóng' }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(title || '📦 Đơn Hàng Mới Được Điều Phối!', notificationOptions)
    );
  }

  // Yêu cầu thông số cache tile bản đồ
  if (event.data.type === 'GET_TILE_CACHE_STATS') {
    caches.open(TILES_CACHE_NAME).then(async (cache) => {
      const keys = await cache.keys();
      const count = keys.length;
      const sizeBytes = count * 22000; // Kích thước trung bình ~22KB/tile PNG
      const replyData = {
        type: 'TILE_CACHE_STATS',
        count,
        sizeBytes,
        maxLimit: MAX_TILES_LIMIT,
        cacheName: TILES_CACHE_NAME,
      };
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage(replyData);
      } else if (event.source) {
        event.source.postMessage(replyData);
      }
    });
  }

  // Xóa cache tile bản đồ theo yêu cầu
  if (event.data.type === 'CLEAR_TILE_CACHE') {
    caches.delete(TILES_CACHE_NAME).then(() => {
      event.source.postMessage({
        type: 'TILE_CACHE_CLEARED_RESULT',
        success: true,
      });
    });
  }
});

// 5. Notification Click Handler: Focus tab or open app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const clickAction = event.action;
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            action: clickAction,
            data: event.notification.data
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// 6. Fetch Handler: Tuân thủ OpenStreetMap Tile Usage Policy + Offline Caching
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);

  // 6A. Bắt các request Tile bản đồ: OpenStreetMap, CartoDB, Google Maps Tiles
  const isMapTile =
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('openstreetmap.fr') ||
    url.hostname.includes('cartocdn.com') ||
    url.hostname.includes('mt.google.com') ||
    url.pathname.match(/\/\d+\/\d+\/\d+\.png/);

  if (isMapTile) {
    // Chiến lược CacheFirst: Kiểm tra trong cache trước, nếu có trả về ngay để bảo vệ server OSM!
    event.respondWith(
      caches.open(TILES_CACHE_NAME).then(async (tileCache) => {
        const cachedResponse = await tileCache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request, {
            mode: 'cors',
            credentials: 'omit',
          });

          if (networkResponse && networkResponse.status === 200) {
            tileCache.put(event.request, networkResponse.clone());
            // Tự động kiểm tra và cắt tỉa không để phình bộ nhớ
            trimCache(TILES_CACHE_NAME, MAX_TILES_LIMIT);
          }
          return networkResponse;
        } catch (networkErr) {
          // Khi ngoại tuyến hoặc mất sóng 4G, trả về cachedResponse nếu có
          if (cachedResponse) return cachedResponse;
          throw networkErr;
        }
      })
    );
    return;
  }

  // 6B. Bỏ qua cache cho các API động (Odoo JSON-RPC, Cloudflare Worker backend)
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/jsonrpc') ||
    url.hostname.includes('erp.hachihi.vn')
  ) {
    return;
  }

  // 6C. App Shell & Static Assets: Stale-While-Revalidate / Network-First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
