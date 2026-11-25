/* Trip helper✈️ 서비스워커 — 네트워크 우선, 실패하면 캐시 */
const CACHE = 'trip-helper-v15';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/itinerary-parser.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/fonts/NanumSquareRoundR.woff2',
  '/fonts/NanumSquareRoundB.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
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
  if (url.origin !== self.location.origin) return;
  // API 는 항상 네트워크 (오프라인이면 그대로 실패 → 앱이 저장해 둔 내용으로 안내)
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        // 1) 같은 주소를 저장해 두었으면 그대로 (공유 링크 /t/CODE 포함)
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        // 2) 페이지 이동(navigation)이면 앱 껍데기(index.html)를 돌려준다.
        //    /t/SZQA35 처럼 공유 링크 경로로 오프라인 접속해도 앱이 뜨고,
        //    앱이 localStorage 에 저장해 둔 여행 내용을 그린다.
        if (req.mode === 'navigate') {
          const shell = (await caches.match('/index.html', { ignoreSearch: true }))
            || (await caches.match('/', { ignoreSearch: true }));
          if (shell) return shell;
        }
        return new Response('오프라인 상태예요. 연결되면 다시 열어 주세요.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
  );
});
