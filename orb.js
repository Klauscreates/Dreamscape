// Geometry is a deterministic radial field derived from measured audio. The
// material and lighting are illustrative; they do not encode additional measures.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const profiles = new WeakMap();
const renderers = new Map();
const cameras = new WeakMap();
const vertexSource = `
precision highp float;
attribute vec3 position;
uniform vec4 shape;
uniform vec3 bands;
uniform vec3 dynamics;
uniform vec3 camera;
uniform vec2 viewport;
uniform float clock;
uniform float layer;
uniform float formation;
uniform float offset;
varying vec3 normal;
varying vec3 world;
varying float relief;
mat3 rotation(float a,float b){
 return mat3(cos(a),0.,-sin(a),0.,1.,0.,sin(a),0.,cos(a))*
 mat3(1.,0.,0.,0.,cos(b),sin(b),0.,-sin(b),cos(b));
}
float radius(vec3 n){
 float organization=shape.w;
 float ridges=sin(n.x*shape.x+shape.z)*cos(n.y*shape.y-shape.z)*sin(n.z*(3.+organization*4.)+.6);
 float fold=sin((n.x+n.z)*7.+sin(n.y*5.)*1.8+shape.z);
 float detail=sin(n.x*23.+shape.z)*cos(n.y*19.-shape.z)*sin(n.z*17.);
 float breath=sin(clock*.8)*(.008+bands.x*.016);
 return 1.+ridges*(.11+bands.y*.18)+fold*(.025+bands.x*.08)+detail*(.006+bands.z*.024)
 + breath + dynamics.x*.1 + sin(n.y*9.-clock*3.)*dynamics.y*.025;
}
vec3 surface(vec3 n){return n*radius(n);}
void main(){
 vec3 n=normalize(position);
 vec3 tangent=normalize(cross(n,abs(n.y)>.95?vec3(1.,0.,0.):vec3(0.,1.,0.)));
 vec3 bitangent=cross(n,tangent);
 vec3 p=surface(n);
 vec3 a=surface(normalize(n+tangent*.004))-p;
 vec3 b=surface(normalize(n+bitangent*.004))-p;
 mat3 rot=rotation(camera.x,camera.y);
 normal=normalize(rot*cross(a,b));
 if(dot(normal,rot*n)<0.) normal=-normal;
 p*=mix(.25,1.,formation)*(1.+layer*.055);
 p.x*=1.+dynamics.z*.16;
 p=rot*p;
 world=p;
 relief=radius(n);
 float perspective=3.9/(3.9-p.z);
 float aspect=viewport.x/viewport.y;
 gl_Position=vec4((p.x*camera.z*.59*perspective+offset)/aspect,p.y*camera.z*.59*perspective,-p.z*.12,1.);
 gl_PointSize=(1.4+bands.z*2.)*min(viewport.y/400.,2.);
}
`;
const fragmentSource = `
precision highp float;
varying vec3 normal;
varying vec3 world;
varying float relief;
uniform float layer;
uniform float tint;
uniform vec3 dynamics;
void main(){
 vec3 n=normalize(normal);
 vec3 eye=normalize(vec3(0.,0.,4.)-world);
 float facing=abs(dot(n,eye));
 float fresnel=pow(1.-facing,2.4);
 vec3 light=normalize(vec3(-.7,1.1,1.8));
 float diffuse=max(dot(n,light),0.);
 float spec=pow(max(dot(reflect(-light,n),eye),0.),48.);
 float soft=pow(max(dot(reflect(-normalize(vec3(.8,-.6,1.)),n),eye),0.),12.);
 vec3 cool=mix(vec3(.20,.30,.38),vec3(.39,.54,.60),tint);
 vec3 warm=vec3(.68,.48,.30);
 vec3 base=mix(cool,warm,clamp(world.y*.35-world.x*.28+.22,0.,.8));
 vec3 color=base*(.28+diffuse*.8)+vec3(.77,.87,.94)*spec*.85+vec3(.68,.76,.82)*soft*.3;
 color+=mix(vec3(.38,.57,.69),vec3(.71,.58,.42),tint)*fresnel*.85;
 color+=base*dynamics.x*.12;
 if(layer>1.5){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vec3(.66,.78,.84),(.12+dynamics.y*.6)*(1.-d*2.));}
 else if(layer>.5){gl_FragColor=vec4(color*.85+vec3(.15,.19,.22),.07+fresnel*.2);}
 else{gl_FragColor=vec4(color,.96);}
}
`;

export function fingerprint(report) {
  if (!report)
    return {
      bands: [0.28, 0.36, 0.12],
      shape: [4.5, 5.3, 0.8, 0.5],
      tint: 0.25,
      width: 0,
    };
  if (profiles.has(report)) return profiles.get(report);
  const spectrum = report.averageSpectrum || [];
  const step = report.sample_rate_hz / (2 * Math.max(1, spectrum.length - 1));
  const sum = [0, 0, 0];
  for (let i = 1; i < spectrum.length; i++) {
    const hz = i * step;
    if (hz > 16000) break;
    sum[hz < 250 ? 0 : hz < 4000 ? 1 : 2] += spectrum[i] ** 2;
  }
  const total = sum.reduce((a, b) => a + b, 0) || 1;
  const bands = sum.map((v) => Math.sqrt(v / total));
  const f = report.features || [];
  const centroid = mean(f.map((v) => v.spectral_centroid_hz || 0));
  const repetition = report.evidence?.scores?.repetition_index || 0;
  const flat = mean(f.map((v) => v.spectral_flatness || 0));
  // Seed depends on audio characteristics, never the filename or random report ID.
  const seed =
    (centroid * 0.0031 +
      mean(f.map((v) => v.rms || 0)) * 13 +
      (report.duration_s || 0) * 0.017) %
    6.283;
  const tonal = report.advanced?.key_strength || 0;
  const p = {
    bands,
    shape: [
      3 + bands[0] * 5 + tonal,
      4 + bands[1] * 5,
      seed,
      clamp(repetition * 0.8 + (1 - flat) * 0.2, 0, 1),
    ],
    tint: clamp(centroid / 6500, 0, 1),
    width: report.stereo_width || 0,
  };
  profiles.set(report, p);
  return p;
}

export function bindOrb(canvas) {
  if (cameras.has(canvas)) return cameras.get(canvas);
  const c = {
    yaw: 0.35,
    pitch: 0.12,
    zoom: 1,
    actual: [0.35, 0.12, 1],
    pointers: new Map(),
    pinch: 0,
    lastTap: 0,
    dragged: false,
  };
  cameras.set(canvas, c);
  canvas.style.touchAction = "none";
  const reset = () => {
    c.yaw = 0.35;
    c.pitch = 0.12;
    c.zoom = 1;
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button && e.pointerType === "mouse") return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    c.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    c.dragged = false;
    if (c.pointers.size === 2) {
      const [a, b] = [...c.pointers.values()];
      c.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const old = c.pointers.get(e.pointerId);
    if (!old) return;
    e.preventDefault();
    if (Math.hypot(e.clientX - old[0], e.clientY - old[1]) > 2)
      c.dragged = true;
    c.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (c.pointers.size === 2) {
      const [a, b] = [...c.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      c.zoom = clamp((c.zoom * d) / Math.max(c.pinch, 1), 0.55, 1.6);
      c.pinch = d;
    } else {
      c.yaw += (e.clientX - old[0]) * 0.008;
      c.pitch = clamp(c.pitch + (e.clientY - old[1]) * 0.008, -1.5, 1.5);
    }
  });
  const release = (e) => {
    c.pointers.delete(e.pointerId);
    c.pinch = 0;
    if (e.type === "pointerup" && !c.dragged) {
      if (performance.now() - c.lastTap < 300) reset();
      c.lastTap = performance.now();
    }
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
    canvas.addEventListener(type, release),
  );
  canvas.addEventListener("dblclick", reset);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      c.zoom = clamp(c.zoom - e.deltaY * 0.001, 0.55, 1.6);
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (e) => {
    const actions = {
      ArrowLeft: () => (c.yaw -= 0.15),
      ArrowRight: () => (c.yaw += 0.15),
      ArrowUp: () => (c.pitch -= 0.1),
      ArrowDown: () => (c.pitch += 0.1),
      "+": () => (c.zoom = Math.min(1.6, c.zoom + 0.1)),
      "-": () => (c.zoom = Math.max(0.55, c.zoom - 0.1)),
      Home: reset,
    };
    if (actions[e.key]) {
      e.preventDefault();
      actions[e.key]();
    }
  });
  c.reset = reset;
  return c;
}
export function resetOrb(canvas) {
  bindOrb(canvas).reset();
}

function createRenderer(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vertexSource),
    fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(program));
  const vertices = [],
    indices = [],
    u = 96,
    v = 64;
  for (let y = 0; y <= v; y++)
    for (let x = 0; x <= u; x++) {
      const a = (x / u) * Math.PI * 2,
        b = (y / v) * Math.PI;
      vertices.push(
        Math.sin(b) * Math.cos(a),
        Math.cos(b),
        Math.sin(b) * Math.sin(a),
      );
    }
  for (let y = 0; y < v; y++)
    for (let x = 0; x < u; x++) {
      const a = y * (u + 1) + x,
        b = a + u + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const vertex = gl.createBuffer(),
    index = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(indices),
    gl.STATIC_DRAW,
  );
  const names = [
    "shape",
    "bands",
    "dynamics",
    "camera",
    "viewport",
    "clock",
    "layer",
    "formation",
    "tint",
    "offset",
  ];
  const uniforms = Object.fromEntries(
    names.map((n) => [n, gl.getUniformLocation(program, n)]),
  );
  const r = {
    gl,
    program,
    vertex,
    index,
    uniforms,
    count: indices.length,
    vertices: vertices.length / 3,
    last: 0,
    dynamics: [0, 0, 0],
    liveBands: null,
    phase: 0,
    lost: false,
  };
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    r.lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    renderers.delete(canvas);
  });
  return r;
}

export function drawFingerprint(canvas, report, options = {}) {
  if (!canvas || !canvas.isConnected || !canvas.getClientRects().length) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > innerHeight || rect.width < 2) return;
  if (!renderers.has(canvas)) {
    try {
      renderers.set(canvas, createRenderer(canvas));
    } catch {
      renderers.set(canvas, null);
    }
  }
  const r = renderers.get(canvas);
  if (!r) {
    canvas.setAttribute(
      "aria-label",
      "3D visualization unavailable on this device. Audio analysis and playback remain available.",
    );
    if (!canvas.nextElementSibling?.classList.contains("graphics-fallback")) {
      const p = document.createElement("p");
      p.className = "graphics-fallback";
      p.textContent =
        "3D graphics are unavailable on this device. Your audio analysis is still available.";
      canvas.after(p);
    }
    return;
  }
  if (r.lost) return;
  const now = performance.now(),
    dt = clamp((now - r.last) / 1000, 0, 0.05);
  r.last = now;
  const reduced =
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    options.reducedMotion;
  const c = bindOrb(canvas);
  if (options.autoRotate && !c.pointers.size && !reduced) c.yaw += dt * 0.065;
  const damp = 1 - Math.exp(-dt * 12);
  [c.yaw, c.pitch, c.zoom].forEach(
    (v, i) => (c.actual[i] += (v - c.actual[i]) * damp),
  );
  const activity = options.activity || [0, 0, 0];
  activity.forEach(
    (v, i) =>
      (r.dynamics[i] +=
        (v - r.dynamics[i]) *
        (1 - Math.exp(-dt * (v > r.dynamics[i] ? 12 : 3)))),
  );
  if (!reduced) r.phase += dt * (0.15 + r.dynamics[0] * 1.8);
  const dpr = Math.min(
    devicePixelRatio || 1,
    options.quality === "low" ? 1 : 1.75,
  );
  const w = Math.round(rect.width * dpr),
    h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const { gl, uniforms: un } = r;
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(r.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, r.vertex);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.index);
  const attribute = gl.getAttribLocation(r.program, "position");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const draw = (track, offset, scale) => {
    const p = fingerprint(track);
    const target = options.liveBands || p.bands;
    if (!r.liveBands) r.liveBands = [...p.bands];
    target.forEach((v, i) => (r.liveBands[i] += (v - r.liveBands[i]) * damp));
    gl.uniform4fv(un.shape, p.shape);
    gl.uniform3fv(un.bands, options.right ? p.bands : r.liveBands);
    gl.uniform3fv(un.dynamics, [
      reduced ? 0 : r.dynamics[0],
      reduced ? 0 : r.dynamics[1],
      p.width,
    ]);
    gl.uniform3fv(un.camera, [c.actual[0], c.actual[1], c.actual[2] * scale]);
    gl.uniform2f(un.viewport, w, h);
    gl.uniform1f(un.clock, r.phase);
    gl.uniform1f(
      un.formation,
      options.building ? clamp(options.progress || 0.05, 0.05, 1) : 1,
    );
    gl.uniform1f(un.tint, p.tint);
    gl.uniform1f(un.offset, offset);
    gl.depthMask(true);
    gl.uniform1f(un.layer, 0);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(false);
    gl.uniform1f(un.layer, 1);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_SHORT, 0);
    if (track && !reduced && r.dynamics[1] > 0.035) {
      gl.uniform1f(un.layer, 2);
      gl.drawArrays(gl.POINTS, 0, r.vertices);
    }
    gl.depthMask(true);
  };
  if (options.right) {
    const affinity = (options.similarity || 0) / 100;
    const separation = 0.56 - affinity * 0.2;
    draw(report, -separation, 0.62);
    draw(options.right, separation, 0.62);
  } else draw(report, 0, report ? 1.1 : 0.76);
}

export function drawThumbnail(canvas, report) {
  const p = fingerprint(report),
    ctx = canvas.getContext("2d");
  canvas.width = 168;
  canvas.height = 168;
  ctx.clearRect(0, 0, 168, 168);
  const g = ctx.createRadialGradient(62, 50, 2, 84, 84, 66);
  g.addColorStop(0, "#b9c8cd");
  g.addColorStop(0.35, "#657e89");
  g.addColorStop(0.72, "#394953");
  g.addColorStop(1, "#202630");
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2,
      r =
        54 *
        (1 +
          Math.sin(a * Math.round(p.shape[0]) + p.shape[2]) * 0.09 +
          Math.cos(a * 3) * p.bands[0] * 0.08);
    const x = 84 + Math.cos(a) * r,
      y = 84 + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#b5c9d666";
  ctx.stroke();
}
export function disposeDetachedOrbs(all = false) {
  for (const [canvas, r] of renderers) {
    if (!all && canvas.isConnected) continue;
    if (r) {
      r.gl.deleteBuffer(r.vertex);
      r.gl.deleteBuffer(r.index);
      r.gl.deleteProgram(r.program);
      r.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    renderers.delete(canvas);
  }
}
