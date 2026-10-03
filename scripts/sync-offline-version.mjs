import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
const sources = [
  "index.html",
  "app.js",
  "experience.js",
  "orb.js",
  "pwa.js",
  "styles.css",
  "manifest.webmanifest",
  ...fs
    .readdirSync(path.join(root, "icons"))
    .sort()
    .map((name) => "icons/" + name),
];
const hashes = Object.fromEntries(
  sources.map((file) => [
    file === "index.html" ? "/" : "/" + file,
    digest(fs.readFileSync(path.join(root, file))),
  ]),
);
const file = path.join(root, "sw.js");
const original = fs.readFileSync(file, "utf8");
const workerLogic = original.replace(
  /\/\/ BEGIN RELEASE[\s\S]*?\/\/ END RELEASE/,
  "// RELEASE DATA",
);
const release = digest(JSON.stringify(hashes) + workerLogic).slice(0, 16);
const replacement = `// BEGIN RELEASE\nconst RELEASE = "${release}";\nconst ASSET_HASHES = ${JSON.stringify(hashes, null, 2)};\n// END RELEASE`;
const next = original.replace(
  /\/\/ BEGIN RELEASE[\s\S]*?\/\/ END RELEASE/,
  replacement,
);
if (process.argv.includes("--check")) {
  if (original !== next) {
    console.error(
      "Offline release is stale. Run node scripts/sync-offline-version.mjs before deploying.",
    );
    process.exit(1);
  }
  console.log(`Offline release ${release} matches its assets.`);
} else {
  fs.writeFileSync(file, next);
  console.log(
    `Prepared offline release ${release} (${sources.length} app assets).`,
  );
}
