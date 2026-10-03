const $ = (id) => document.getElementById(id);
const dialog = $("install-dialog");
const standalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;
const ios =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt = null;
let registration = null;
let offlineReady = false;
let reloadRequested = false;
let applyingUpdate = false;
let updateTimer = null;

function syncLaunchChrome() {
  const light = document.documentElement.dataset.theme === "light";
  document.querySelector('meta[name="theme-color"]').content = light
    ? "#f5f4f1"
    : "#111214";
  document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
  ).content = light ? "default" : "black-translucent";
}
new MutationObserver(syncLaunchChrome).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
syncLaunchChrome();

function connectivity() {
  const badge = $("connectivity-status");
  badge.hidden = navigator.onLine;
  badge.textContent = offlineReady ? "Offline · ready" : "Offline";
  $("installation-status").textContent = offlineReady
    ? "The app is ready to reopen offline on this device."
    : "Offline setup needs a successful visit on HTTPS or localhost. If it fails, try again online.";
}

function syncInstallUI() {
  $("install-button").hidden = standalone();
  $("install-confirm").hidden = !installPrompt || standalone();
  $("install-instructions").innerHTML = standalone()
    ? "<p>You’re using the installed Dreamscape app.</p>"
    : ios
      ? "<ol><li>Open Dreamscape in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li><li>Keep <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.</li></ol>"
      : installPrompt
        ? "<p>Install Dreamscape to open it in its own window, directly from your home screen or app launcher.</p>"
        : "<p>Open your browser’s menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong> if available. On iPhone or iPad, use Safari’s Share menu.</p>";
}

$("install-button").addEventListener("click", () => {
  syncInstallUI();
  connectivity();
  dialog.showModal();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  syncInstallUI();
});
$("install-confirm").addEventListener("click", async () => {
  const prompt = installPrompt;
  if (!prompt) return;
  $("install-confirm").disabled = true;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    $("installation-status").textContent =
      choice.outcome === "accepted"
        ? "Installation accepted. Look for Dreamscape in your app launcher."
        : "You can install later from your browser’s menu.";
  } catch {
    $("installation-status").textContent =
      "Use your browser’s Install app or Add to Home screen option.";
  } finally {
    installPrompt = null;
    $("install-confirm").disabled = false;
    syncInstallUI();
  }
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("install-button").hidden = true;
  if (dialog.open) dialog.close();
});
matchMedia("(display-mode: standalone)").addEventListener(
  "change",
  syncInstallUI,
);
window.addEventListener("online", connectivity);
window.addEventListener("offline", connectivity);

function showUpdate() {
  $("app-update").hidden = false;
}
$("dismiss-update").addEventListener("click", () => {
  $("app-update").hidden = true;
});
$("apply-update").addEventListener("click", () => {
  if (applyingUpdate) return;
  if (!registration?.waiting) {
    location.reload();
    return;
  }
  applyingUpdate = true;
  reloadRequested = true;
  $("apply-update").disabled = true;
  registration.waiting.postMessage({ type: "APPLY_UPDATE" });
  updateTimer = setTimeout(() => {
    reloadRequested = false;
    applyingUpdate = false;
    $("apply-update").disabled = false;
    $("update-title").textContent =
      "Update is taking longer. Try again when ready.";
  }, 15000);
});

async function cacheStatus() {
  try {
    if (!registration?.active) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
    }, 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      offlineReady = event.data?.type === "CACHE_READY";
      connectivity();
    };
    registration.active.postMessage({ type: "CACHE_STATUS" }, [channel.port2]);
  } catch {
    /* Offline status stays conservative if storage is unavailable. */
  }
}

async function register() {
  if (!("serviceWorker" in navigator) || !isSecureContext) return;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    if (registration.waiting) showUpdate();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller)
          showUpdate();
        if (worker.state === "activated") cacheStatus();
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      cacheStatus();
      if (reloadRequested) {
        clearTimeout(updateTimer);
        location.reload();
      } else if (applyingUpdate === false && offlineReady) {
        $("update-title").textContent =
          "Dreamscape was updated in another window.";
        showUpdate();
      }
    });
    cacheStatus();
    registration.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && navigator.onLine)
        registration.update().catch(() => {});
    });
  } catch {
    $("installation-status").textContent =
      "Offline setup is unavailable right now. The online app still works; try again later.";
  }
}
syncInstallUI();
connectivity();
register();
