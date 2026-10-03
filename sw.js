// Generated release data is refreshed with node scripts/sync-offline-version.mjs.
// BEGIN RELEASE
const RELEASE = "0664aaccecd611a6";
const ASSET_HASHES = {
  "/": "b3a748952817fcd1ea0687fb21f082c9486f2cc18b5a52c366728ece02fccc39",
  "/app.js": "967fa3b8d4c9aa011db342dd71e207728368f50d8d0b1875b85310f7b84c0425",
  "/experience.js": "dba528b7c87cf2a2ee48e850e49d1be3a270d71e7de1f511f0464c0b475d33cd",
  "/orb.js": "48908282872e4969b554265df895473a1d23b93dacc959f28a377e16e5f50238",
  "/pwa.js": "6008a03730767ac6ce872a4dca31de7ded0cd2badced5f7503eb349e0a53dc65",
  "/styles.css": "538a3c1f97162cb01d97574857c517113c47e59bddf1852e5729829ee63dfcc3",
  "/manifest.webmanifest": "94ea98637a4de46afa693047015fc0469c1fbefe12e7b61cf07cc7e214ecfa47",
  "/icons/apple-touch-icon.png": "01de442071804c2f205703aca1cbfa6105d4a90ba26f3bb1726144e049c3c388",
  "/icons/dreamscape.svg": "9502164c12da36f080da098681db039dd52c01adedab955d9b51c86a47918301",
  "/icons/icon-192.png": "4d1671dd8c5e3366d96eff9894bfdf835c566da736f7c607b832c9c353678e0f",
  "/icons/icon-512.png": "956c4b50ad1b183f1a968e4833b534458ce16ac0fa9edf0f5dabf48b46fb4379",
  "/icons/icon-maskable-512.png": "956c4b50ad1b183f1a968e4833b534458ce16ac0fa9edf0f5dabf48b46fb4379",
  "/icons/launch-1170x2532.png": "dc28a744a89450a841a2b824b713b8491db114eeb306c5fce13cbea41a7c4017",
  "/icons/launch-1179x2556.png": "a4c1ff76804c9161c6a4326c880c21628d1186ebee18ba4ee1295c30d456aa9a",
  "/icons/launch-1206x2622.png": "76536eb252a4e7ba17e12f77e72c1202940b79d14d028c20ae5a8009cfe9a662",
  "/icons/launch-1290x2796.png": "694b7eba20467916490eb6ee1fa92eb691c15dad03374af1141a6e9c637b4e77",
  "/icons/launch-1320x2868.png": "5c0fe8bb0384a2be94d99af3a02092ae1cde47e668107a66f37d240c2065e920"
};
// END RELEASE
const CACHE_PREFIX = "dreamscape-shell-";
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const assetPaths = new Set(Object.keys(ASSET_HASHES));

async function installShell() {
  try {
    // Verify the whole release before writing it, so interrupted/mixed deployments
    // leave the previous working version active.
    const responses = await Promise.all(
      Object.entries(ASSET_HASHES).map(async ([path, expected]) => {
        const response = await fetch(path, { cache: "reload" });
        if (!response.ok || response.redirected)
          throw new Error("App asset unavailable");
        const bytes = await response.clone().arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const actual = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (actual !== expected)
          throw new Error("App release changed during download");
        return [path, response];
      }),
    );
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      responses.map(([path, response]) => cache.put(path, response)),
    );
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}
self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "APPLY_UPDATE") {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === "CACHE_STATUS" && event.ports[0]) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const complete = (
          await Promise.all([...assetPaths].map((path) => cache.match(path)))
        ).every(Boolean);
        event.ports[0].postMessage({
          type: complete ? "CACHE_READY" : "CACHE_UNAVAILABLE",
          release: RELEASE,
        });
      })(),
    );
  }
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const path = url.pathname === "/index.html" ? "/" : url.pathname;
  if (!assetPaths.has(path)) return;
  if (request.mode !== "navigate" && url.search) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(path);
      if (cached) return cached;
      // Restore evicted files only when the bytes belong to this exact release.
      try {
        const response = await fetch(path, { cache: "reload" });
        if (!response.ok || response.redirected)
          throw new Error("Asset unavailable");
        const bytes = await response.clone().arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const actual = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (actual !== ASSET_HASHES[path]) throw new Error("Different release");
        await cache.put(path, response.clone());
        return response;
      } catch {}
      if (request.mode === "navigate") {
        return new Response(
          `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconnect Dreamscape</title><body style="margin:0;padding:15vh 24px;background:#111214;color:#f0f0f2;font:16px -apple-system,sans-serif;text-align:center"><h1>Let’s reconnect.</h1><p>Your offline app files need refreshing. Connect to the internet, then refresh the app.</p><button style="padding:14px 24px;border-radius:12px;border:0" onclick="if(navigator.onLine){navigator.serviceWorker.getRegistration().then(async r=>{if(r)await r.unregister();location.reload();});}else{document.querySelector('p').textContent='Connect to the internet before refreshing.';}">Refresh app</button></body></html>`,
          {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      return new Response(
        "Dreamscape’s offline files need refreshing. Connect to the internet and reopen the app.",
        {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    })(),
  );
});
