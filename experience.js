import { drawThumbnail, disposeDetachedOrbs, resetOrb } from "./orb.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const timeLabel = (s) =>
  `${Math.floor(Math.max(0, s || 0) / 60)}:${String(Math.floor(Math.max(0, s || 0) % 60)).padStart(2, "0")}`;
export const ui = {
  route: "now",
  exports: [],
  history: [],
  settings: {
    theme: "system",
    autoRotate: true,
    reducedMotion: false,
    quality: "auto",
  },
};
const routes = [
  ["now", "Now Playing", "◉"],
  ["library", "Library", "▤"],
  ["compare", "Compare", "⇄"],
  ["collision", "Collision", "⋈"],
  ["study", "Study", "◎"],
  ["room", "Room", "⌁"],
  ["cleanser", "Cleanser", "≋"],
  ["history", "History", "◷"],
  ["exports", "Exports", "↗"],
  ["settings", "Settings", "⚙"],
];
let api;
let lastNowKey = "";
const title = (eyebrow, heading, copy = "") =>
  `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1></div></div>${copy ? `<p class="body-copy" style="margin-bottom:28px">${copy}</p>` : ""}`;
const empty = (heading, copy, action = true) =>
  `<div class="empty-state"><span class="empty-glyph" aria-hidden="true">◌</span><h3>${heading}</h3><p>${copy}</p>${action ? '<button class="button primary" data-ui="import">Choose audio</button>' : ""}</div>`;
const score = (label, value) =>
  `<div><div class="score-value">${value}</div><div class="score-label">${label}</div></div>`;
const unit = (v, suffix = "", digits = 0) =>
  Number.isFinite(v) ? v.toFixed(digits) + suffix : "Unavailable";
const details = (r) => {
  const m = api.metrics(r);
  return `<details class="detail"><summary>Explore the audio measurements</summary><dl><dt>Average RMS amplitude</dt><dd>${unit(m.rmsMean, "", 4)}</dd><dt>Spectral brightness</dt><dd>${unit(m.centroidMean, " Hz")}</dd><dt>Attack density</dt><dd>${unit(m.attackDensity * 100, "%", 1)}</dd><dt>Spectral flatness</dt><dd>${unit(m.flatnessMean, "", 3)}</dd><dt>Repetition index</dt><dd>${unit(m.repetitionIndex, "", 3)}</dd><dt>Modulation rate</dt><dd>${unit(m.modulationHz, " Hz", 2)}</dd><dt>Estimated tonal center</dt><dd>${esc(r.advanced?.estimated_key || "Unclear")} ${esc(r.advanced?.estimated_scale || "")}</dd></dl><p>Focus, hype, chill and task fit are rules-based estimates from these acoustic characteristics. They do not measure your cognitive response.</p></details>`;
};
const activeSelector = () =>
  `<label class="select-label" style="max-width:480px;margin-bottom:24px">Active sound<select data-select="active" aria-label="Active sound">${api
    .reports()
    .map(
      (r) =>
        `<option value="${esc(r.id)}" ${r.id === api.active()?.id ? "selected" : ""}>${esc(r.name)}</option>`,
    )
    .join("")}</select></label>`;
const picker = (side, selected) =>
  `<label class="select-label">Track ${side === "left" ? "A" : "B"}<select data-select="${side}" aria-label="Track ${side === "left" ? "A" : "B"}">${api
    .reports()
    .map(
      (r) =>
        `<option value="${esc(r.id)}" ${r.id === selected?.id ? "selected" : ""}>${esc(r.name)}</option>`,
    )
    .join("")}</select></label>`;
function renderNow() {
  const r = api.active();
  const key = r?.id || "empty";
  $("track-title").textContent = r ? r.name : "Drop a sound into Dreamscape";
  $("track-eyebrow").textContent = r
    ? "Your audio fingerprint"
    : "Start with a sound";
  $("player").hidden = !r;
  $("orb-mode").textContent = api.live.isBuilding
    ? "Mapping sound…"
    : api.live.isPlaying
      ? "Live audio"
      : "Audio fingerprint";
  if (!r && !api.live.isBuilding)
    $("orb-mode").textContent = "Awaiting a sound";
  $("orb-caption").textContent = r
    ? "Shape from sound. Light as interpretation."
    : "A dormant form. Yours is waiting.";
  if (lastNowKey === key) return;
  lastNowKey = key;
  if (!r) {
    $("now-insights").innerHTML = "";
    return;
  }
  const s = api.stateScore(r),
    e = api.energy(r);
  $("now-insights").innerHTML =
    `<div class="section-head"><div><h3>Under the surface</h3><p>The character of this sound, in a few considered details.</p></div><a class="text-button" href="#study">Explore study fit ↗</a></div><div class="insight-grid"><article class="surface"><p class="eyebrow">State · estimated</p><h3>A sense of its character.</h3><div class="score-row">${["Focus", "Hype", "Chill"].map((label) => score(label, s.entries.find((x) => x.label === label)?.score ?? "—")).join("")}</div><p class="body-copy">Based on loudness, attacks, repetition and texture. These scores describe the audio profile.</p>${details(r)}</article><article class="surface"><p class="eyebrow">Energy · audio profile</p><h3>${esc(e.label)} energy</h3><div class="score-row">${score("Intensity / 100", e.energyScore)}${score("Impact / 100", e.shockScore)}${score("95th percentile RMS", e.peakEnergy.toFixed(3))}</div><canvas id="energy-curve" class="energy-curve" aria-label="Measured energy across the track"></canvas><p class="compact-note">RMS energy across the track. The playhead follows playback.</p></article></div>`;
}
function library() {
  const reports = api.reports();
  return (
    title(
      "Your collection",
      "A library of sound.",
      "Available in this session. Export an analysis to keep a copy before closing the page.",
    ) +
    (reports.length
      ? `<div class="track-list">${reports.map((r) => `<article class="track-row"><canvas data-thumbnail="${esc(r.id)}" aria-hidden="true"></canvas><div class="track-info"><h3>${esc(r.name)}</h3><p>${timeLabel(r.duration_s)} · ${r.channels === 1 ? "Mono" : "Stereo"} · ${(r.sample_rate_hz / 1000).toFixed(1)} kHz</p><p>${new Date(r.analyzed_at).toLocaleString()} · Energy ${api.energy(r).energyScore}/100</p></div><span class="pill">${esc(api.stateScore(r).entries[0].label)} estimate</span><button class="button small" data-ui="open-track" data-id="${esc(r.id)}">Listen ↗</button></article>`).join("")}</div>`
      : empty(
          "Your collection starts here.",
          "Add one or several audio files. Each analyzed sound gets its own visual fingerprint.",
        ))
  );
}
function compare(collision = false) {
  const [a, b] = api.pair();
  const intro = title(
    collision
      ? "Experimental · sound similarity"
      : "Two sounds. Two perspectives.",
    collision ? "When sounds meet." : "Hear the difference.",
    collision
      ? "A visual interpretation of acoustic similarity. The score compares sound signatures only."
      : "Choose two analyzed sounds to explore their brightness, attacks and repeating patterns.",
  );
  if (!a || !b)
    return (
      intro +
      empty(
        "Bring two sounds together.",
        a
          ? "One track is ready. Add another sound to compare them."
          : "Add at least two audio files to explore their differences.",
      )
    );
  const controls = `<div class="split-view"><div class="surface">${picker("left", a)}${!collision ? '<canvas id="compare-left" class="compare-orb" tabindex="0" aria-label="Track A orb. Drag to rotate."></canvas>' : ""}</div><div class="surface">${picker("right", b)}${!collision ? '<canvas id="compare-right" class="compare-orb" tabindex="0" aria-label="Track B orb. Drag to rotate."></canvas>' : ""}</div></div>`;
  if (collision) {
    const c = api.collision(a, b);
    return (
      intro +
      controls +
      `<div class="collision-stage"><canvas id="collision-canvas" tabindex="0" aria-label="Two interacting sound fingerprints. Drag to rotate and scroll to zoom."></canvas></div><div class="collision-result"><span class="pill">Experimental</span><div class="score-value">${c.score}<small style="font-size:18px;color:var(--muted)"> / 100</small></div><h3>${esc(c.label)}</h3><p class="body-copy">Similarity in brightness, modulation, phase stability, repetition and dominant frequency. Greater overlap draws the forms closer.</p></div>`
    );
  }
  const x = api.metrics(a),
    y = api.metrics(b);
  const rows = [
    ["Brightness", unit(x.centroidMean, " Hz"), unit(y.centroidMean, " Hz")],
    [
      "Attack density",
      unit(x.attackDensity * 100, "%", 1),
      unit(y.attackDensity * 100, "%", 1),
    ],
    [
      "Repetition index",
      unit(x.repetitionIndex, "", 3),
      unit(y.repetitionIndex, "", 3),
    ],
    [
      "MFCC recurrence",
      unit(x.recurrenceAffinity, "", 3),
      unit(y.recurrenceAffinity, "", 3),
    ],
    [
      "Tonal center",
      a.advanced?.estimated_key + " " + a.advanced?.estimated_scale,
      b.advanced?.estimated_key + " " + b.advanced?.estimated_scale,
    ],
  ];
  return (
    intro +
    controls +
    `<div class="surface" style="margin-top:20px"><h3>The details that set them apart.</h3><table class="metric-table"><thead><tr><th>Audio property</th><th>Track A</th><th>Track B</th></tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="compact-note">Values describe acoustic differences; neither track is ranked as better.</p></div>`
  );
}
function study() {
  const r = api.active();
  const intro = title(
    "Study Sound Coach",
    "Find your rhythm.",
    "Task-fit estimates based on the track's measured characteristics.",
  );
  if (!r)
    return (
      intro +
      empty(
        "A little structure for your study time.",
        "Analyze a track to explore its estimated fit for reading, writing, coding, memorization and recovery.",
      )
    );
  const c = api.coach(r);
  return (
    intro +
    activeSelector() +
    `<div class="surface"><h3>${esc(c.headline)}</h3><div class="task-list">${c.tasks.map((t) => `<div class="task-item"><h3>${esc(t.label)}</h3><div><p>${t.score >= 75 ? "High" : t.score >= 50 ? "Moderate" : "Lower"} estimated fit, based on the audio profile.</p><div class="meter"><span style="width:${t.score}%"></span></div></div><div class="task-score">${t.score}</div></div>`).join("")}</div>${details(r)}</div>`
  );
}
function room() {
  return (
    title(
      "Spatial listening",
      "Find your quiet.",
      "See the sound around you. Compare a few places, then settle into yours.",
    ) +
    `<article class="surface"><div class="room-top"><div><span class="pill" id="room-state">Microphone off</span><h3 id="room-title" style="margin-top:12px">Listen to your space.</h3><p id="room-description" class="compact-note">Start a scan to measure the sound around you.</p></div><div class="room-actions"><button class="button primary" data-action="start-room-scan">Start Room Scan</button><button class="button" data-action="stop-room-scan" disabled>Stop</button></div></div><div id="room-error" class="error-banner" role="status" hidden></div><canvas id="room-heatmap" class="heatmap-canvas" role="img" aria-label="Live frequency activity over time; low frequencies at bottom, high at top"></canvas><div class="legend"><span>Frequency ↑ · Time →</span><span class="legend-scale">Quieter <i></i> Stronger</span></div><p class="compact-note">Microphone levels are relative to this device. Voice-range activity can include instruments and other sounds.</p><div id="room-metrics" class="room-metrics"></div><div class="room-summary"><div><p class="eyebrow">What to notice</p><ul id="room-noises"></ul></div><div><p class="eyebrow">Estimated task fit</p><p id="room-advice" class="body-copy"></p></div></div><h3>Your places</h3><p class="compact-note">Let the sound settle for a few seconds at each location before marking it.</p><div class="marker-form"><label for="spot-label">Location<input id="spot-label" type="text" maxlength="40" placeholder="Desk, couch, window…" value=""></label><button class="button" data-action="mark-room-spot" disabled>Mark this spot</button></div><div id="room-spots" class="spot-list"></div><p id="room-best" class="compact-note"></p></article>`
  );
}
export function updateRoomUI() {
  if (ui.route !== "room" || !$("room-state")) return;
  const s = api.room,
    has = s.rollingFrames.length > 0,
    r = s.summary;
  $("room-state").textContent = s.pending
    ? "Requesting microphone…"
    : s.isScanning
      ? "● Listening live"
      : has
        ? "Last scan"
        : "Microphone off";
  $("room-title").textContent = has
    ? r.chaosScore > 65
      ? "An active, changing space."
      : r.speechScore > 55
        ? "Prominent voice-range activity."
        : "A steadier sound environment."
    : "Listen to your space.";
  $("room-description").textContent = has
    ? "These estimates reflect the most recent microphone samples."
    : "Start a scan to measure the sound around you.";
  $("room-error").hidden = !s.error;
  $("room-error").textContent = s.error || "";
  const availability = api.roomAvailability();
  document.querySelector('[data-action="start-room-scan"]').disabled =
    s.isScanning || s.pending || !availability.supported;
  document.querySelector('[data-action="stop-room-scan"]').disabled =
    !s.isScanning && !s.pending;
  document.querySelector('[data-action="mark-room-spot"]').disabled =
    !s.isScanning || !has;
  if (!availability.supported) {
    $("room-error").hidden = false;
    $("room-error").textContent = availability.reason;
  }
  $("room-metrics").innerHTML = [
    ["Focus estimate", r.focusFit],
    ["Interruption estimate", r.chaosScore],
    ["Voice-range activity", r.speechScore],
    ["Low-frequency activity", r.rumbleScore],
  ]
    .map(([label, v]) => score(label, has ? v : "—"))
    .join("");
  $("room-noises").innerHTML = has
    ? `<li>${r.speechScore > 48 ? "Activity is elevated in the voice frequency range." : "No dominant voice-range activity in the recent window."}</li><li>${r.chaosScore > 55 ? "Frequent changes and spikes are present." : "Sound levels are comparatively steady."}</li><li>${r.rumbleScore > 54 ? "Low-frequency energy is elevated." : "Low-frequency energy is relatively subdued."}</li>`
    : "<li>Your first scan will appear here.</li>";
  const advice = has ? api.roomAdvice(r) : null;
  $("room-advice").textContent = has
    ? `${advice.bestTask.label}: ${advice.bestTask.score}/100 estimated fit. Compare locations on the same device for a more useful relative reading.`
    : "Task suggestions appear after the microphone has collected samples.";
  $("room-spots").innerHTML = s.spots
    .map(
      (p) =>
        `<div class="spot"><strong>${esc(p.label)}</strong><p>Focus estimate ${p.focusFit} · Interruptions ${p.chaosScore}</p></div>`,
    )
    .join("");
  $("room-best").textContent = s.spots.length
    ? r.bestSeat
    : "No locations marked yet.";
}
function cleanser() {
  const reports = api.reports(),
    c = api.cleanser(reports);
  return (
    title(
      "Playlist Cleanser",
      "Make room for focus.",
      "Review the audio characteristics that may make a track more distracting during study.",
    ) +
    (reports.length
      ? `<div class="track-list">${c.tracks
          .map(
            (t) =>
              `<article class="surface"><div class="section-head" style="margin:0 0 15px"><h3>${esc(t.name)}</h3><span class="pill">${t.disruption >= 62 ? "Potential distraction" : t.support >= 64 ? "Steadier study option" : "Mixed profile"}</span></div><p class="body-copy">Estimated support ${t.support}/100 · Estimated disruption ${t.disruption}/100</p><div class="meter"><span style="width:${t.disruption}%"></span></div><details class="detail"><summary>Why this estimate?</summary><p>Calculated from attack density, spectral changes, zero-crossing rate, spectral spread, impact and brightness.</p><dl>${Object.entries(
                api.metrics(reports.find((r) => r.id === t.id)),
              )
                .filter(([k]) =>
                  [
                    "attackDensity",
                    "fluxMean",
                    "zcrMean",
                    "centroidMean",
                  ].includes(k),
                )
                .map(
                  ([k, v]) =>
                    `<dt>${{ attackDensity: "Attack density", fluxMean: "Spectral change", zcrMean: "Zero-crossing rate", centroidMean: "Brightness (Hz)" }[k]}</dt><dd>${unit(v, "", 3)}</dd>`,
                )
                .join("")}</dl></details></article>`,
          )
          .join("")}</div>`
      : empty(
          "Curate your study soundtrack.",
          "Choose several audio files to compare their estimated support and disruption.",
        ))
  );
}
function settings() {
  return (
    title("Make it yours", "A calmer kind of control.") +
    `<div class="surface"><div class="setting-row"><div><h3>Appearance</h3><p>Follow your device, or choose your own.</p></div><select data-setting="theme" aria-label="Appearance">${["system", "dark", "light"].map((v) => `<option value="${v}" ${ui.settings.theme === v ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</select></div><label class="setting-row"><div><h3>Slow orb rotation</h3><p>Let the fingerprint gently turn.</p></div><input type="checkbox" data-setting="autoRotate" ${ui.settings.autoRotate ? "checked" : ""}></label><label class="setting-row"><div><h3>Reduce motion</h3><p>Keep camera controls; suppress ambient movement.</p></div><input type="checkbox" data-setting="reducedMotion" ${ui.settings.reducedMotion ? "checked" : ""}></label><div class="setting-row"><div><h3>Visual quality</h3><p>Lower resolution uses less graphics power.</p></div><select data-setting="quality" aria-label="Visual quality"><option value="auto" ${ui.settings.quality === "auto" ? "selected" : ""}>Adaptive</option><option value="low" ${ui.settings.quality === "low" ? "selected" : ""}>Low power</option></select></div><p class="compact-note">Only display preferences are saved on this device. Uploaded audio and analyses stay in the current session.</p></div>`
  );
}
function exportsPage() {
  const can = api.reports().length || api.room.rollingFrames.length;
  return (
    title("Take the details with you", "Your analysis, yours to keep.") +
    `<div class="surface"><h3>Analysis JSON</h3><p class="body-copy" style="margin:12px 0 22px">Download the measured features, interpreted scores, selected comparison, room summary and marked locations for this session.</p><button class="button primary" data-ui="export" ${can ? "" : "disabled"}>Download analysis JSON ↗</button><p class="compact-note">${can ? "Includes the current session. Audio files are not included." : "Analyze audio or scan a room to enable export."}</p></div><div class="section-head"><h3>Session exports</h3></div>${ui.exports.length ? ui.exports.map((d) => `<div class="export-log">Analysis JSON · ${esc(d)}</div>`).join("") : empty("No exports yet.", "Downloads made during this session will be listed here.", false)}`
  );
}
export function renderExperience() {
  if (!api) return;
  renderNow();
  $("now-view").hidden = ui.route !== "now";
  $("track-results").hidden = ui.route === "now";
  $("page-name").textContent =
    routes.find((r) => r[0] === ui.route)?.[1] || "Explore";
  document.querySelectorAll("[data-route]").forEach((el) => {
    const active = el.dataset.route === ui.route;
    el.classList.toggle("active", active);
    active
      ? el.setAttribute("aria-current", "page")
      : el.removeAttribute("aria-current");
  });
  if (ui.route === "now") {
    $("track-results").innerHTML = "";
    disposeDetachedOrbs();
    return;
  }
  const views = {
    library,
    compare: () => compare(),
    collision: () => compare(true),
    study,
    room,
    cleanser,
    settings,
    exports: exportsPage,
    history: () =>
      title(
        "This session",
        "Your listening trail.",
        "Analysis history lasts until this page closes.",
      ) +
      (ui.history.length
        ? '<div class="track-list">' +
          ui.history
            .map(
              (h) =>
                `<article class="surface"><h3>${esc(h.name)}</h3><p class="compact-note">Analyzed ${esc(new Date(h.date).toLocaleString())} · ${timeLabel(h.duration)}</p><button class="text-button" data-ui="open-track" data-id="${esc(h.id)}">Open analysis ↗</button></article>`,
            )
            .join("") +
          "</div>"
        : empty(
            "A fresh listening session.",
            "Analyze a sound to start your history.",
          )),
    more: () =>
      title("Explore", "A little deeper.") +
      `<div class="surface nav-group">${routes
        .filter((r) => !["now", "library", "room", "study"].includes(r[0]))
        .map((r) => navLink(r))
        .join("")}</div>`,
  };
  $("track-results").innerHTML =
    '<div class="page">' + (views[ui.route] || views.library)() + "</div>";
  updateRoomUI();
  document.querySelectorAll("[data-thumbnail]").forEach((c) =>
    drawThumbnail(
      c,
      api.reports().find((r) => r.id === c.dataset.thumbnail),
    ),
  );
  disposeDetachedOrbs();
}
function navLink(r) {
  return `<a class="nav-link" href="#${r[0]}" data-route="${r[0]}" aria-label="${r[1]}" title="${r[1]}"><span class="nav-icon" aria-hidden="true">${r[2]}</span><span class="nav-label">${r[1]}</span></a>`;
}
function applyTheme() {
  document.documentElement.dataset.theme =
    ui.settings.theme === "system"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : ui.settings.theme;
}
export function mountExperience(engine) {
  api = engine;
  try {
    const stored = JSON.parse(
      localStorage.getItem("dreamscape-preferences") || "{}",
    );
    for (const k of Object.keys(ui.settings))
      if (typeof stored[k] === typeof ui.settings[k])
        ui.settings[k] = stored[k];
  } catch {}
  applyTheme();
  matchMedia("(prefers-color-scheme: light)").addEventListener(
    "change",
    applyTheme,
  );
  $("main-nav").innerHTML =
    '<div class="nav-group">' +
    routes.slice(0, 7).map(navLink).join("") +
    '</div><div class="nav-group"><span class="nav-group-label">Your workspace</span>' +
    routes.slice(7).map(navLink).join("") +
    "</div>";
  $("mobile-nav").innerHTML = [
    routes[0],
    routes[1],
    routes[5],
    routes[4],
    ["more", "More", "•••"],
  ]
    .map(navLink)
    .join("");
  const route = () => {
    const hash = location.hash.slice(1) || "now";
    ui.route = [...routes.map((r) => r[0]), "more"].includes(hash)
      ? hash
      : "now";
    renderExperience();
    scrollTo({ top: 0, behavior: "instant" });
  };
  window.addEventListener("hashchange", route);
  $("import-button").addEventListener("click", () => {
    location.hash = "now";
    $("audio-files").click();
  });
  $("drop-zone").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $("audio-files").click();
    }
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ui]");
    if (!el) return;
    if (el.dataset.ui === "import") {
      location.hash = "now";
      $("audio-files").click();
    }
    if (el.dataset.ui === "open-track") {
      api.select(el.dataset.id);
      location.hash = "now";
    }
    if (el.dataset.ui === "export") api.export();
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.select) {
      el.dataset.select === "active"
        ? api.select(el.value)
        : api.selectPair(el.dataset.select, el.value);
    }
    if (el.dataset.setting) {
      ui.settings[el.dataset.setting] =
        el.type === "checkbox" ? el.checked : el.value;
      try {
        localStorage.setItem(
          "dreamscape-preferences",
          JSON.stringify(ui.settings),
        );
      } catch {}
      applyTheme();
    }
  });
  $("reset-orb").addEventListener("click", () => resetOrb($("hero-orb")));
  $("fullscreen-button").addEventListener("click", async () => {
    const stage = $("orb-stage");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else stage.classList.toggle("expanded");
    } catch {
      stage.classList.toggle("expanded");
    }
    $("fullscreen-button").setAttribute(
      "aria-label",
      document.fullscreenElement || stage.classList.contains("expanded")
        ? "Exit fullscreen"
        : "Expand visualization",
    );
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("orb-stage").classList.remove("expanded");
  });
  route();
}

export function drawPlayer(position) {
  if (!api) return;
  const r = api.active();
  if (!r) return;
  $("seek").value = position;
  $("seek").max = r.duration_s;
  $("seek").setAttribute(
    "aria-valuetext",
    timeLabel(position) + " of " + timeLabel(r.duration_s),
  );
  $("elapsed").textContent = timeLabel(position);
  $("duration").textContent = timeLabel(r.duration_s);
  $("orb-mode").textContent = api.live.isBuilding
    ? "Mapping sound…"
    : api.live.isPlaying
      ? "Live audio"
      : "Audio fingerprint";
  $("orb-play-btn").textContent = api.live.isPlaying ? "Ⅱ" : "▶";
  $("orb-play-btn").setAttribute(
    "aria-label",
    api.live.isPlaying ? "Pause" : "Play",
  );
  const draw = (canvas, values, bars) => {
    if (!canvas || !canvas.getClientRects().length) return;
    const rect = canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2),
      w = rect.width,
      h = rect.height;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...values, 0.00001);
    if (bars) {
      for (let i = 0; i < values.length; i++) {
        const x = (i / values.length) * w;
        ctx.fillStyle = x / w < position / r.duration_s ? "#b6c9d9" : "#68717e";
        const height = Math.max(1, (values[i] / max) * (h - 4));
        ctx.fillRect(
          x,
          (h - height) / 2,
          Math.max(1, w / values.length - 1),
          height,
        );
      }
    } else {
      ctx.strokeStyle = getComputedStyle(
        document.documentElement,
      ).getPropertyValue("--accent");
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / Math.max(values.length - 1, 1)) * w,
          y = h - 5 - (v / max) * (h - 10);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = "#e7edf1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo((position / r.duration_s) * w, 0);
    ctx.lineTo((position / r.duration_s) * w, h);
    ctx.stroke();
  };
  draw($("waveform"), r.waveform || [], true);
  if (!r.energy_curve) {
    const f = r.features || [];
    r.energy_curve = Array.from(
      { length: Math.min(240, f.length) },
      (_, i) => f[Math.floor((i * f.length) / Math.min(240, f.length))].rms,
    );
  }
  draw($("energy-curve"), r.energy_curve, false);
}
