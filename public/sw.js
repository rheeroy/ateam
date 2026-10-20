// ATEAM 서비스 워커 — 앱 설치용. 캐시는 하지 않는다 (배포하면 바로 새 화면)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* 그대로 네트워크로 */ });
