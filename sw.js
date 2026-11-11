/* Service worker: cho phép mở app khi offline.
 * Chiến lược: file của app → lấy từ mạng trước, mạng hỏng thì dùng bản đã cache
 * (nên mỗi lần sửa code trên GitHub, app tự lấy bản mới khi có mạng).
 * Tăng CACHE_VERSION khi muốn xoá cache cũ. */
const CACHE_VERSION = "meocards-v2";
const APP_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./modes.js", "./config.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Chỉ xử lý file của chính app; Google API / fonts đi thẳng ra mạng
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE_VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
