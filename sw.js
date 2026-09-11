const CACHE = "desktopbutler-mobile-v025";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./tts_patch.js",
  "./tts_controller_v025.js",
  "./supabase_config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  if(event.request.method!=="GET") return;
  event.respondWith(
    fetch(event.request).then(resp=>{
      const clone=resp.clone();
      if(new URL(event.request.url).origin===self.location.origin){
        caches.open(CACHE).then(c=>c.put(event.request,clone));
      }
      return resp;
    }).catch(()=>caches.match(event.request).then(x=>x||caches.match("./index.html")))
  );
});
