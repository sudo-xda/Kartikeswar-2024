// Keeps the app opening without internet. Firestore keeps its own offline copy of the data.
// Bump CACHE when app files change so phones pick up the new version.
const CACHE = "kartikeswar-app-v7";
const SHELL = [
    "./",
    "./index.html",
    "./app.css",
    "./app.js",
    "./i18n.js",
    "./vendor/qrcode.js",
    "./firebase-config.js",
    "./manifest.webmanifest",
    "./icon-192.png",
    "./icon-512.png",
    "./guide.html",
    "../data.js"
];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    const isAppFile = url.origin === self.location.origin;
    const isFirebaseSdk = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
    const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
    if (!isAppFile && !isFirebaseSdk && !isFont) return; // never touch Firestore/Auth traffic

    // Serve from cache straight away, refresh the cache in the background
    event.respondWith(
        caches.open(CACHE).then(cache =>
            cache.match(request).then(cached => {
                const network = fetch(request)
                    .then(response => {
                        if (response.ok) cache.put(request, response.clone());
                        return response;
                    })
                    .catch(() => cached);
                return cached || network;
            })
        )
    );
});
