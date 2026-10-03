import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const root = new URL("../", import.meta.url);
const source = fs.readFileSync(new URL("sw.js", root), "utf8");
function worker(fault = false) {
  const stores = new Map([["dreamscape-shell-previous", new Map()]]);
  const listeners = {};
  let skipCalls = 0;
  let faultEnabled = fault;
  const context = {
    URL,
    Response,
    Uint8Array,
    crypto: webcrypto,
    fetch: async (pathname) => {
      if (faultEnabled && pathname === "/styles.css")
        return new Response("wrong deployment");
      return new Response(
        fs.readFileSync(
          new URL(pathname === "/" ? "index.html" : pathname.slice(1), root),
        ),
      );
    },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (key) => stores.delete(key),
      open: async (key) => {
        if (!stores.has(key)) stores.set(key, new Map());
        const entries = stores.get(key);
        return {
          put: async (key, value) => entries.set(key, value.clone()),
          match: async (key) => entries.get(key)?.clone(),
        };
      },
    },
    self: {
      location: { origin: "https://dreamscape.test" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {
        skipCalls++;
      },
      addEventListener: (type, callback) => {
        listeners[type] = callback;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  function event(type, input = {}) {
    let work = Promise.resolve();
    let response;
    listeners[type]({
      ...input,
      waitUntil: (p) => {
        work = p;
      },
      respondWith: (p) => {
        response = p;
      },
    });
    return { work, response };
  }
  return {
    stores,
    event,
    fail: () => {
      faultEnabled = true;
    },
    skipCalls: () => skipCalls,
  };
}
const failed = worker(true);
await assert.rejects(failed.event("install").work);
assert.deepEqual(
  [...failed.stores.keys()],
  ["dreamscape-shell-previous"],
  "Failed precache must preserve previous release",
);
const good = worker();
await good.event("install").work;
good.stores.set("another-app-cache", new Map());
assert.equal(good.skipCalls(), 0, "New releases must wait for the user");
await good.event("activate").work;
assert.equal(
  good.stores.size,
  2,
  "Activation cleans only superseded app caches",
);
const entries = [...good.stores.values()][0];
assert.ok(good.stores.has("another-app-cache"));
assert.ok(entries.has("/") && entries.has("/manifest.webmanifest"));
for (const file of [
  "/private.mp3",
  "/api/report",
  "https://other.test/app.js",
]) {
  const url = file.startsWith("http") ? file : "https://dreamscape.test" + file;
  assert.equal(
    good.event("fetch", { request: { url, method: "GET", mode: "cors" } })
      .response,
    undefined,
    "Non-app requests must bypass caching",
  );
}
entries.delete("/styles.css");
const fetchCSS = () =>
  good.event("fetch", {
    request: {
      url: "https://dreamscape.test/styles.css",
      method: "GET",
      mode: "cors",
    },
  }).response;
assert.equal(
  (await fetchCSS()).status,
  200,
  "Evicted assets restore from matching release",
);
entries.delete("/styles.css");
good.fail();
assert.equal(
  (await fetchCSS()).status,
  503,
  "Different release must not mix into active shell",
);
assert.equal(entries.has("/styles.css"), false);
await good.event("message", { data: { type: "APPLY_UPDATE" } }).work;
assert.equal(good.skipCalls(), 1);
console.log(
  "PASS: atomic precache, opt-in updates, cache cleanup, private-request bypass and safe eviction recovery.",
);
