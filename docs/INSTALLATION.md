# Installing Dreamscape

Public app: **https://dreamscapeapp.vercel.app/**

## iPhone and iPad

1. Open the address in Safari.
2. Tap Share, then Add to Home Screen.
3. Keep Open as Web App enabled if that option appears.
4. Tap Add. Open Dreamscape using its new Home Screen icon.

The app's Install button opens the same guide. No App Store account is needed.
See [Apple's instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios).

## Android and desktop

Supported browsers offer Install Dreamscape in the app's installation dialog.
If a native prompt is unavailable, use the browser's Install app or Add to Home
screen command. Private browsing can prevent installation.

## Offline use

Visit online first. Open Install and wait for “ready to reopen offline” before
disconnecting. The app can then launch, analyze locally available files, display
orbs, play audio and export JSON without a network connection. File providers
such as iCloud Drive may need internet to download a selected file first.

Only the app shell, manifest and icons/launch images are cached. Songs,
microphone recordings, reports, API requests and third-party resources are not
cached. Analysis results and the library remain session-only; export results
before closing or reloading. Browser storage eviction can remove the offline copy.

## Updates

A new release downloads and verifies all app assets before it becomes ready.
Choose Update and reload when convenient. The app reminds you to export current
session results first. No update forces a reload of an active analysis session.
Superseded Dreamscape caches are removed when the new worker activates.

The cache version includes the app assets and worker logic. Before committing any
change to these files, run:

```sh
node scripts/sync-offline-version.mjs
sh scripts/check.sh
```

Icon source: `icons/dreamscape.svg`. Portrait launch artwork source: `launch.svg`.
Apple launch images cover 390x844, 393x852, 402x874, 430x932 and 440x956 logical
portrait screens at 3x pixel density. Other screen sizes and orientations use the
platform's normal launch behavior. Android uses the manifest icon/background.
