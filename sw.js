// Keeps the JC Survey Toolkit working with no signal once it has been opened online.
//
// tool/build_web.dart fills in VERSION and PRECACHE after `flutter build web`:
//  * PRECACHE: every file of the app (the RSS templates are not in the web build).
//  * VERSION: changes whenever any file changes, so phones pick up a new release.
//
// Files are served from the phone first (fast and offline). A new release is
// downloaded in the background and used the next time the app is opened.
'use strict';

const VERSION = 'd9b984e9';
const PRECACHE = [
  "./",
  "assets/AssetManifest.bin",
  "assets/AssetManifest.bin.json",
  "assets/FontManifest.json",
  "assets/NOTICES",
  "assets/assets/brand/jc_compass_badge.png",
  "assets/assets/guide/JC_Survey_Toolkit_CSV_Headers.xlsx",
  "assets/assets/guide/JC_Survey_Toolkit_Export_Guide.pdf",
  "assets/assets/tools/JC_TimeMatch.html",
  "assets/fonts/MaterialIcons-Regular.otf",
  "assets/fonts/fallback/Roboto-Regular.ttf",
  "assets/packages/cupertino_icons/assets/CupertinoIcons.ttf",
  "assets/shaders/ink_sparkle.frag",
  "assets/shaders/stretch_effect.frag",
  "canvaskit/canvaskit.js",
  "canvaskit/canvaskit.wasm",
  "canvaskit/chromium/canvaskit.js",
  "canvaskit/chromium/canvaskit.wasm",
  "favicon.png",
  "flutter.js",
  "flutter_bootstrap.js",
  "icons/Icon-192.png",
  "icons/Icon-512.png",
  "icons/Icon-maskable-192.png",
  "icons/Icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "index.html",
  "jcs_store.js",
  "main.dart.js",
  "manifest.json",
  "pdf_view.js",
  "pdfjs/LICENSE.txt",
  "pdfjs/README.txt",
  "pdfjs/pdf.min.mjs",
  "pdfjs/pdf.worker.min.mjs",
  "version.json"
];
const CACHE = 'jcs-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // All or nothing: a half-filled cache must never become the live one.
    await cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('jcs-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the app loads nothing from elsewhere

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isPage = req.mode === 'navigate';
    // The file itself first (this also covers pages shown inside the app, like the
    // Time Match tool). Any other address in the app opens the start page.
    let hit = await cache.match(req, { ignoreSearch: true });
    if (!hit && isPage) hit = await cache.match(new URL('./', self.registration.scope).href);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Keep anything else the app loads (for example the drawing engine for this browser).
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (isPage) {
        const home = await cache.match(new URL('index.html', self.registration.scope).href);
        if (home) return home;
      }
      throw e;
    }
  })());
});
