/* tx-ebm-calc Service Worker
 * 快取應用 shell（index.html / engine.js / manifest）。
 * 圖示與 Google Fonts 等不列入必載 shell，避免缺檔導致 install 失敗。
 */
const CACHE = 'tx-ebm-calc-v1';
const SHELL = [
  './',
  'index.html',
  'engine.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨來源（字型等）交給網路

  // 導覽：stale-while-revalidate（離線可用、上線即更新）
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // 其餘同源靜態資源：cache-first
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
}
