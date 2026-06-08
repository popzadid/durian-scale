/* Service Worker — offline cache สำหรับ PWA จดตาชั่งทุเรียน */
const VERSION = 'v13';
const CACHE = 'durian-scale-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './fonts.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/Kanit-600-thai.woff2',
  './fonts/Kanit-600-latin.woff2',
  './fonts/Kanit-700-thai.woff2',
  './fonts/Kanit-700-latin.woff2',
  './fonts/Sarabun-400-thai.woff2',
  './fonts/Sarabun-400-latin.woff2',
  './fonts/Sarabun-600-thai.woff2',
  './fonts/Sarabun-600-latin.woff2',
  './fonts/Sarabun-700-thai.woff2',
  './fonts/Sarabun-700-latin.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ตอบเวอร์ชันให้หน้าแอปเมื่อถูกถาม
self.addEventListener('message', (e) => {
  if (e.data === 'GET_VERSION') {
    const reply = { type: 'VERSION', version: VERSION };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source) e.source.postMessage(reply);
  }
});

// cache-first สำหรับไฟล์แอป, network fallback
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
