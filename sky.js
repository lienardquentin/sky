"use strict";
// The sky over you, drawn where you point the phone. Directions are unit vectors in east-north-up (ENU) coordinates;
// the phone's sensors say which way its screen faces in that same frame, and each object is projected through it.
const A = Astronomy;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const $ = (s) => document.querySelector(s);
const canvas = $("#sky"), g = canvas.getContext("2d"), video = $("#cam");
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
}
addEventListener("resize", resize); resize();

const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem("sky." + k)); return v ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem("sky." + k, JSON.stringify(v)); } catch (e) {} };
const place = load("place", [50.29, 5.10]);  // Ciney, until the phone says where it is

const S = {
  observer: new A.Observer(place[0], place[1], 200), placeName: load("placeName", "Ciney"),
  mode: "drag",                                   // "sensors": follow the phone; "drag": look around with a finger
  view: { az: 180, alt: 35, fov: 75 },            // where the finger has pointed, in drag mode
  camFov: load("camFov", 68),                     // the camera's vertical field of view, degrees
  yawOffset: load("yawOffset", 0),                // the compass's error, found by aligning
  layers: Object.assign({ lines: true, names: true, planets: true, ground: true, sats: true, starlink: false }, load("layers", {})),
  camera: false, target: null, q: null, selected: null, aligning: false, lastCompute: 0,
};

// ---- the catalogue: stars to magnitude 6, the constellation figures and their names ----
let STARS = [], EQJ = null, ENU = null, COLOR = [], SEGS = [], CONS = [];
const eqjVec = (raDeg, decDeg) => { const ra = raDeg * D2R, de = decDeg * D2R, c = Math.cos(de); return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(de)]; };
function bvColor(bv) {  // a star's colour index, blue-white to orange
  const t = Math.max(-0.4, Math.min(2, bv)), k = (t + 0.4) / 0.8, j = (t - 0.4) / 1.6;
  const [r, gg, b] = t < 0.4 ? [0.66 + 0.34 * k, 0.78 + 0.2 * k, 1] : [1, 0.98 - 0.3 * j, 1 - 0.55 * j];
  return `rgb(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0})`;
}
async function loadSky() {
  const d = await fetch("data/sky.json").then((r) => r.json());
  STARS = d.stars;
  EQJ = new Float32Array(STARS.length * 3); ENU = new Float32Array(STARS.length * 3);
  STARS.forEach((s, i) => { EQJ.set(eqjVec(s[0], s[1]), i * 3); COLOR[i] = bvColor(s[3]); });
  for (const [id, segs] of Object.entries(d.lines)) for (const seg of segs) SEGS.push({ id, eqj: seg.map((p) => eqjVec(p[0], p[1])) });
  CONS = d.constellations.map((c) => ({ id: c[0], name: c[1], eqj: eqjVec(c[2], c[3]), rank: c[4] }));
  compute();
}

// ---- where everything is right now, recomputed every 10 seconds (the sky turns 0.04° in that time) ----
const BODIES = [["Sun", "#ffd36b"], ["Moon", "#f3efe2"], ["Mercury", "#cdbba5"], ["Venus", "#fff3d1"], ["Mars", "#ff8f63"],
                ["Jupiter", "#f1dbb4"], ["Saturn", "#ead494"], ["Uranus", "#aee6ea"], ["Neptune", "#86a9ff"]];
function toEnu(rot, v) {  // J2000 equator → the horizon here (x north, y west, z up) → east, north, up
  const X = rot[0][0] * v[0] + rot[1][0] * v[1] + rot[2][0] * v[2];
  const Y = rot[0][1] * v[0] + rot[1][1] * v[1] + rot[2][1] * v[2];
  const Z = rot[0][2] * v[0] + rot[1][2] * v[1] + rot[2][2] * v[2];
  return [-Y, X, Z];
}
const altAzVec = (alt, az) => [Math.sin(az * D2R) * Math.cos(alt * D2R), Math.cos(az * D2R) * Math.cos(alt * D2R), Math.sin(alt * D2R)];
const vecAltAz = (v) => [Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D, (Math.atan2(v[0], v[1]) * R2D + 360) % 360];
function compute() {
  if (!EQJ) return;
  const t = A.MakeTime(new Date()), rot = A.Rotation_EQJ_HOR(t, S.observer).rot;
  for (let i = 0; i < STARS.length; i++) ENU.set(toEnu(rot, [EQJ[i * 3], EQJ[i * 3 + 1], EQJ[i * 3 + 2]]), i * 3);
  for (const s of SEGS) s.enu = s.eqj.map((v) => toEnu(rot, v));
  for (const c of CONS) c.enu = toEnu(rot, c.eqj);
  S.bodies = BODIES.map(([name, color]) => {
    const body = A.Body[name], eq = A.Equator(body, t, S.observer, true, true), h = A.Horizon(t, S.observer, eq.ra, eq.dec, "");
    let mag = null, phase = null;
    try { const il = A.Illumination(body, t); mag = il.mag; phase = il.phase_fraction; } catch (e) {}
    return { kind: "body", name, color, enu: altAzVec(h.altitude, h.azimuth), dist: eq.dist, mag, phase, ra: eq.ra, dec: eq.dec };
  });
  S.sunAlt = vecAltAz(S.bodies[0].enu)[0];
  const sv = A.GeoVector(A.Body.Sun, t, true), sn = Math.hypot(sv.x, sv.y, sv.z); S.sunDir = [sv.x / sn, sv.y / sn, sv.z / sn];
  S.lastCompute = performance.now();
}

// ---- the phone's orientation: the browser's angles → a rotation, smoothed so the labels don't shiver ----
function matFromEuler(a, b, c) {  // W3C device orientation: columns are the phone's x, y, z axes in east-north-up
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(c), sG = Math.sin(c);
  return [[cA * cG - sA * sB * sG, -cB * sA, cG * sA * sB + cA * sG],
          [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
          [-cB * sG, sB, cB * cG]];
}
function m2q(m) {
  const tr = m[0][0] + m[1][1] + m[2][2]; let s;
  if (tr > 0) { s = Math.sqrt(tr + 1) * 2; return [0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]; }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; return [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s]; }
  if (m[1][1] > m[2][2]) { s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; return [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s]; }
  s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; return [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s];
}
function q2m([w, x, y, z]) {
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t), n = Math.hypot(...r); return r.map((v) => v / n); }
  const th = Math.acos(d), s = Math.sin(th), k1 = Math.sin((1 - t) * th) / s, k2 = Math.sin(t * th) / s;
  return a.map((v, i) => v * k1 + b[i] * k2);
}
let absoluteSeen = false;
function onOrientation(e, absolute) {
  if (e.alpha == null) return;
  let alpha = e.alpha;
  if (e.webkitCompassHeading != null) { alpha = 360 - e.webkitCompassHeading; absolute = true; }  // iPhone: a real compass heading
  if (absolute) absoluteSeen = true; else if (absoluteSeen) return;  // prefer the north-referenced events when there are any
  S.target = m2q(matFromEuler(alpha * D2R, e.beta * D2R, e.gamma * D2R));
  S.absolute = absolute;
}
addEventListener("deviceorientationabsolute", (e) => onOrientation(e, true));
addEventListener("deviceorientation", (e) => onOrientation(e, e.absolute === true));

// ---- the view: which way the screen's right, up and back point, and how many pixels a radian is ----
const yaw = (v, deg) => { const p = deg * D2R, c = Math.cos(p), s = Math.sin(p); return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]; };
function view() {
  if (S.mode === "sensors" && S.q) {
    const m = q2m(S.q), th = (screen.orientation ? screen.orientation.angle : window.orientation || 0) * D2R, c = Math.cos(th), s = Math.sin(th);
    const dx = [m[0][0], m[1][0], m[2][0]], dy = [m[0][1], m[1][1], m[2][1]], dz = [m[0][2], m[1][2], m[2][2]];
    const right = dx.map((v, i) => v * c - dy[i] * s), up = dx.map((v, i) => v * s + dy[i] * c);  // the screen turns with the phone
    return { right: yaw(right, S.yawOffset), up: yaw(up, S.yawOffset), back: yaw(dz, S.yawOffset), f: H / 2 / Math.tan((S.camFov * D2R) / 2) };
  }
  const az = S.view.az * D2R, alt = S.view.alt * D2R;
  return { right: [Math.cos(az), -Math.sin(az), 0], up: [-Math.sin(az) * Math.sin(alt), -Math.cos(az) * Math.sin(alt), Math.cos(alt)],
           back: [-Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), -Math.sin(alt)], f: H / 2 / Math.tan((S.view.fov * D2R) / 2) };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function project(V, v) {
  const depth = -dot(v, V.back);
  if (depth <= 0.02) return null;
  return [W / 2 + (dot(v, V.right) / depth) * V.f, H / 2 - (dot(v, V.up) / depth) * V.f];
}
const onScreen = (p, m = 0) => p && p[0] > -m && p[0] < W + m && p[1] > -m && p[1] < H + m;

// ---- drawing ----
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const dirName = (az) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(az / 45) % 8];
let shown = [];  // what was drawn where, for taps
function draw() {
  requestAnimationFrame(draw);
  if (!EQJ) return;
  if (performance.now() - S.lastCompute > 10000) compute();
  if (S.mode === "sensors" && S.target) S.q = S.q ? slerp(S.q, S.target, 0.18) : S.target;
  const V = view(); S.V = V; shown = [];
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!S.camera) {  // no camera: a sky of its own, bluer while the Sun is up
    const day = Math.max(0, Math.min(1, (S.sunAlt + 12) / 18));
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, mix("#05070e", "#2b5f9e", day)); grd.addColorStop(1, mix("#0d1426", "#7fb2e0", day));
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  if (S.layers.ground) drawGround(V);
  drawHorizon(V);
  if (S.layers.lines) drawLines(V);
  drawStars(V);
  if (S.layers.names) drawConstellationNames(V);
  if (S.layers.sats) { updateSats(); drawSats(V); }
  if (S.layers.planets) drawBodies(V);
  drawSelected(V);
  const fwd = V.back.map((v) => -v), [alt, az] = vecAltAz(fwd);
  $("#looking").textContent = `${dirName(az)[0].toUpperCase() + dirName(az).slice(1)} ${Math.round(az)}° · ${alt >= 0 ? "up" : "down"} ${Math.abs(Math.round(alt))}°`;
}
function mix(a, b, t) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; }
function drawGround(V) {
  // the ground as one shape: cells of 10° below the horizon, the ones in front of the camera
  g.beginPath();
  for (let az = 0; az < 360; az += 10) for (let alt = 0; alt > -90; alt -= 10) {
    const c = [[alt, az], [alt, az + 10], [alt - 10, az + 10], [alt - 10, az]].map(([a, z]) => project(V, altAzVec(a, z)));
    if (c.some((p) => !p)) continue;
    g.moveTo(c[0][0], c[0][1]); for (let i = 1; i < 4; i++) g.lineTo(c[i][0], c[i][1]); g.closePath();
  }
  g.fillStyle = S.camera ? "rgba(10,14,24,.35)" : "rgba(14,20,18,.82)"; g.fill("nonzero");
}
function drawHorizon(V) {
  g.beginPath(); let pen = false;
  for (let az = 0; az <= 360; az += 2) { const p = project(V, altAzVec(0, az)); if (!p) { pen = false; continue; } pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); pen = true; }
  g.strokeStyle = "rgba(242,196,109,.55)"; g.lineWidth = 1.2; g.stroke();
  g.font = "600 13px ui-sans-serif, system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "#f2c46d";
  DIRS.forEach((d, i) => { const p = project(V, altAzVec(0, i * 45)); if (onScreen(p)) g.fillText(d, p[0], p[1] + 18); });
}
function drawLines(V) {
  g.beginPath();
  for (const s of SEGS) for (let i = 1; i < s.enu.length; i++) {
    const a = project(V, s.enu[i - 1]), b = project(V, s.enu[i]);
    if (!a || !b || (!onScreen(a, 200) && !onScreen(b, 200))) continue;
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
  }
  g.strokeStyle = "rgba(150,185,255,.38)"; g.lineWidth = 1; g.stroke();
}
function drawStars(V) {
  const fov = S.mode === "sensors" ? S.camFov : S.view.fov, limit = S.camera ? 5 : 6, zoom = Math.max(1, 70 / fov);
  const labelLimit = fov < 45 ? 3.5 : 2.1, taken = new Set();
  g.font = "12.5px ui-sans-serif, system-ui, sans-serif"; g.textAlign = "left";
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i]; if (s[2] > limit) break;  // sorted brightest first
    const v = [ENU[i * 3], ENU[i * 3 + 1], ENU[i * 3 + 2]], p = project(V, v);
    if (!onScreen(p, 4)) continue;
    const r = Math.max(0.55, (2.9 - 0.5 * s[2]) * Math.sqrt(zoom)), below = v[2] < 0;
    g.globalAlpha = (below ? 0.35 : 1) * Math.min(1, 1.35 - s[2] * 0.15);
    g.fillStyle = COLOR[i]; g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill();
    if (s[2] < 1.5) { g.globalAlpha *= 0.18; g.beginPath(); g.arc(p[0], p[1], r * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    if (s[2] < 4.5) shown.push({ kind: "star", i, x: p[0], y: p[1] });
    if (S.layers.names && s[4] && s[2] < labelLimit) {
      const cell = `${Math.round(p[0] / 90)},${Math.round(p[1] / 24)}`;  // one label per patch of screen
      if (taken.has(cell)) continue; taken.add(cell);
      g.fillStyle = below ? "rgba(238,241,248,.4)" : "rgba(238,241,248,.85)"; g.fillText(s[4], p[0] + r + 5, p[1] + 4);
    }
  }
}
function drawConstellationNames(V) {
  g.font = "600 10.5px ui-sans-serif, system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "rgba(150,185,255,.62)";
  const fov = S.mode === "sensors" ? S.camFov : S.view.fov;
  for (const c of CONS) {
    if (c.rank > (fov < 50 ? 3 : 2)) continue;
    const p = project(V, c.enu); if (!onScreen(p)) continue;
    g.save(); g.translate(p[0], p[1]); g.letterSpacing = "2px"; g.fillText(c.name.toUpperCase(), 0, 0); g.restore();
  }
}
function drawBodies(V) {
  g.textAlign = "left";
  for (const b of S.bodies || []) {
    const p = project(V, b.enu); if (!onScreen(p, 20)) continue;
    const big = b.name === "Sun" || b.name === "Moon", r = big ? Math.max(7, 0.26 * D2R * V.f) : 4.5, below = b.enu[2] < 0;
    g.globalAlpha = below ? 0.45 : 1;
    if (b.name === "Moon") drawMoon(p, r, b.phase ?? 0.5);
    else { g.fillStyle = b.color; g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill(); g.globalAlpha *= 0.25; g.beginPath(); g.arc(p[0], p[1], r * 2.6, 0, 7); g.fill(); g.globalAlpha = below ? 0.45 : 1; }
    g.font = "600 14px ui-sans-serif, system-ui, sans-serif"; g.fillStyle = b.color; g.fillText(b.name, p[0] + r + 7, p[1] + 5);
    g.globalAlpha = 1;
    shown.push({ kind: "body", b, x: p[0], y: p[1], r });
  }
}
function drawMoon(p, r, lit) {
  g.fillStyle = "#3a3d47"; g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill();
  // the lit part: half the disc plus (or minus) an ellipse, which is all a phase is
  g.fillStyle = "#f3efe2"; g.beginPath();
  g.arc(p[0], p[1], r, -Math.PI / 2, Math.PI / 2, false);
  g.ellipse(p[0], p[1], Math.abs(1 - 2 * lit) * r, r, 0, Math.PI / 2, -Math.PI / 2, lit < 0.5);
  g.fill();
}
function drawSelected(V) {
  const sel = S.selected; if (!sel) return;
  const v = sel.vec(), p = project(V, v);
  g.strokeStyle = "#f2c46d"; g.lineWidth = 2;
  if (onScreen(p, -10)) { g.beginPath(); g.arc(p[0], p[1], 16, 0, 7); g.stroke(); return; }
  // off screen: an arrow at the edge, pointing the way to turn
  const x = dot(v, V.right), y = dot(v, V.up), ang = Math.atan2(-y, x), m = 46;
  const ex = W / 2 + Math.cos(ang) * (W / 2 - m), ey = H / 2 + Math.sin(ang) * (H / 2 - m);
  g.save(); g.translate(ex, ey); g.rotate(ang); g.fillStyle = "#f2c46d";
  g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-3, 0); g.lineTo(-8, 10); g.closePath(); g.fill(); g.restore();
}

// ---- satellites: orbits from CelesTrak, positions worked out on the phone (SGP4) ----
const SAT = { list: [], next: 0, epoch: null };
const NAMES = { "ISS (ZARYA)": "ISS", "HST": "Hubble", "CSS (TIANHE)": "Tiangong" };
const STARS_OF_THE_SHOW = new Set(["ISS", "Hubble", "Tiangong"]);
async function tle(group) {
  // CelesTrak updates a few times a day and asks to be fetched rarely: keep a copy for 6 hours, and the last good one for when it's down
  const key = "tle." + group, cached = load(key, null);
  if (cached && Date.now() - cached.at < 6 * 3600e3) return cached.text;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { signal: ctl.signal }); clearTimeout(timer);
    const text = await r.text();
    if (!r.ok || !text.includes("\n1 ")) throw new Error("bad");
    save(key, { at: Date.now(), text }); return text;
  } catch (e) {
    if (cached) return cached.text;
    if (group === "visual") return fetch("data/visual.tle").then((r) => r.text());  // the copy that ships with the page
    throw e;
  }
}
function parseTle(text, group) {
  const L = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean), out = [];
  for (let i = 0; i + 2 < L.length + 1; i++) {
    if (!L[i + 1]?.startsWith("1 ") || !L[i + 2]?.startsWith("2 ")) continue;
    try {
      const satrec = satellite.twoline2satrec(L[i + 1], L[i + 2]), raw = L[i].trim();
      const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
      out.push({ name: NAMES[raw] || raw, satrec, group, epoch: new Date(Date.UTC(year, 0, 1) + (satrec.epochdays - 1) * 864e5) });
    } catch (e) {}
    i += 2;
  }
  return out;
}
async function loadSats() {
  try {
    const groups = ["visual", ...(S.layers.starlink ? ["starlink"] : [])], lists = [];
    for (const gr of groups) lists.push(parseTle(await tle(gr), gr));
    const seen = new Set();  // a satellite in both groups is drawn once
    SAT.list = lists.flat().filter((s) => !seen.has(s.satrec.satnum) && seen.add(s.satrec.satnum));
    SAT.next = 0; SAT.epoch = new Date(Math.max(...SAT.list.map((s) => +s.epoch)));
  } catch (e) { toast("Couldn't load the satellites' orbits. Try again later."); }
}
function sunlit(r) {  // outside Earth's shadow (a cylinder behind the Earth, away from the Sun)
  if (!S.sunDir) return true;
  const d = r.x * S.sunDir[0] + r.y * S.sunDir[1] + r.z * S.sunDir[2];
  if (d > 0) return true;
  return Math.hypot(r.x - d * S.sunDir[0], r.y - d * S.sunDir[1], r.z - d * S.sunDir[2]) > 6371;
}
const observerGd = () => ({ latitude: S.observer.latitude * D2R, longitude: S.observer.longitude * D2R, height: (S.observer.height || 0) / 1000 });
function placeSat(s, date, gmst = satellite.gstime(date), gd = observerGd()) {
  const pv = satellite.propagate(s.satrec, date);
  if (!pv || !pv.position) { s.enu = null; return; }
  const la = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, gmst));
  s.enu = altAzVec(la.elevation * R2D, la.azimuth * R2D); s.range = la.rangeSat; s.lit = sunlit(pv.position);
  s.height = satellite.eciToGeodetic(pv.position, gmst).height; s.speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
}
function updateSats() {
  const n = SAT.list.length; if (!n) return;
  const date = new Date(), gmst = satellite.gstime(date), gd = observerGd(), t0 = performance.now();
  // the famous ones and the picked one every frame; the rest in turns, within 6 ms a frame
  for (const s of SAT.list) if (STARS_OF_THE_SHOW.has(s.name)) placeSat(s, date, gmst, gd);
  if (S.selected?.sat) placeSat(S.selected.sat, date, gmst, gd);
  for (let k = 0; k < n && (k < 40 || performance.now() - t0 < 6); k++) { placeSat(SAT.list[SAT.next], date, gmst, gd); SAT.next = (SAT.next + 1) % n; }
}
function drawSats(V) {
  const dark = S.sunAlt < -6;
  g.font = "600 13px ui-sans-serif, system-ui, sans-serif"; g.textAlign = "left";
  for (const s of SAT.list) {
    if (!s.enu) continue;
    const p = project(V, s.enu); if (!onScreen(p, 10)) continue;
    const star = STARS_OF_THE_SHOW.has(s.name), seen = s.lit && dark && s.enu[2] > 0, below = s.enu[2] < 0;
    const r = star ? 4 : s.group === "starlink" ? 1.4 : 2.2;
    g.globalAlpha = below ? 0.3 : seen ? 1 : 0.45;
    g.fillStyle = seen ? "#fff6d8" : s.lit ? "#cfe0ff" : "#7d879c";
    g.beginPath(); g.moveTo(p[0], p[1] - r - 1); g.lineTo(p[0] + r + 1, p[1]); g.lineTo(p[0], p[1] + r + 1); g.lineTo(p[0] - r - 1, p[1]); g.closePath(); g.fill();  // a small diamond
    if (star) { g.fillStyle = seen ? "#fff6d8" : "#b8c6e0"; g.fillText(s.name, p[0] + r + 7, p[1] + 5); }
    g.globalAlpha = 1;
    shown.push({ kind: "sat", s, x: p[0], y: p[1], r: star ? 6 : 0 });
  }
  if (S.selected?.sat) drawPath(V, S.selected.sat);
}
function drawPath(V, s) {
  // where it's heading: the next 4 minutes, a dot every 20 seconds
  if (!s.path || performance.now() - s.pathAt > 5000) {
    const now = Date.now(); s.path = []; s.pathAt = performance.now();
    for (let k = 1; k <= 12; k++) { const t = new Date(now + k * 20000), c = { satrec: s.satrec }; placeSat(c, t); if (c.enu) s.path.push(c.enu); }
  }
  g.fillStyle = "#f2c46d";
  s.path.forEach((v, k) => { const p = project(V, v); if (!onScreen(p)) return; g.globalAlpha = 1 - k / 13; g.beginPath(); g.arc(p[0], p[1], 2.2, 0, 7); g.fill(); });
  g.globalAlpha = 1;
}
function sunAltAt(date) { const t = A.MakeTime(date), eq = A.Equator(A.Body.Sun, t, S.observer, true, true); return A.Horizon(t, S.observer, eq.ra, eq.dec, "").altitude; }
function nextPass(s) {
  // the next time it's at least 10° up, in sunlight, while the sky here is dark: up to three days ahead, in 20-second steps
  const step = 20000, start = Date.now(), gd = observerGd(), sun = new Map();
  const dark = (t) => { const k = Math.floor(t / 300000); if (!sun.has(k)) sun.set(k, sunAltAt(new Date(k * 300000)) < -6); return sun.get(k); };
  let pass = null;
  for (let t = start; t < start + 3 * 864e5; t += step) {
    const c = { satrec: s.satrec }; placeSat(c, new Date(t), satellite.gstime(new Date(t)), gd);
    const [alt, az] = c.enu ? vecAltAz(c.enu) : [-90, 0], ok = alt >= 10 && c.lit && dark(t);
    if (ok && !pass) pass = { start: new Date(t), from: az, max: alt };
    else if (ok) { pass.max = Math.max(pass.max, alt); pass.to = az; pass.end = new Date(t); }
    else if (pass) return pass;
  }
  return pass;
}
const dayWord = (d) => { const today = new Date(); today.setHours(0, 0, 0, 0); const k = Math.floor((d - today) / 864e5); return k === 0 ? "Today" : k === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "long" }); };
function satCard(s) {
  placeSat(s, new Date());
  const dark = S.sunAlt < -6, up = s.enu && s.enu[2] > 0;
  const status = !s.lit ? "In the Earth's shadow: invisible right now" : !up ? "In sunlight, below your horizon" : dark ? "In sunlight against a dark sky: look for a steady moving star" : "In sunlight, but your sky is too bright to see it";
  const rows = [["Where", s.enu ? where(s.enu) : ""], ["Now", status], ["Height", `${Math.round(s.height)} km`],
                ["Speed", `${(s.speed * 3600).toLocaleString(undefined, { maximumFractionDigits: 0 })} km/h`], ["Distance", `${Math.round(s.range).toLocaleString()} km from you`], ["Next pass", "working it out…"]];
  const orbits = `Orbit data from ${SAT.epoch ? SAT.epoch.toLocaleDateString() : "?"}.`;
  card(s.group === "starlink" ? "Starlink satellite" : "Satellite", s.name, rows, orbits);
  setTimeout(() => {  // the pass search takes a moment: the card shows first
    if (S.selected?.sat !== s) return;
    const p = nextPass(s);
    rows[5][1] = p ? `${dayWord(p.start)} ${fmtTime(p.start)}, from the ${dirName(p.from)} to the ${dirName(p.to ?? p.from)}, up to ${Math.round(p.max)}° (${Math.max(1, Math.round(((p.end || p.start) - p.start) / 60000))} min)` : "None visible in the next three days";
    card(s.group === "starlink" ? "Starlink satellite" : "Satellite", s.name, rows, orbits);
  }, 30);
}

// ---- touch: drag to look (or to align), pinch to zoom, tap to ask what something is ----
const pointers = new Map(); let dragged = 0, pinch = null;
canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); dragged = 0;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), fov: S.mode === "sensors" ? S.camFov : S.view.fov }; } });
canvas.addEventListener("pointermove", (e) => {
  const last = pointers.get(e.pointerId); if (!last) return;
  const dx = e.clientX - last[0], dy = e.clientY - last[1]; pointers.set(e.pointerId, [e.clientX, e.clientY]); dragged += Math.abs(dx) + Math.abs(dy);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], f = Math.max(10, Math.min(110, pinch.fov * pinch.d / Math.hypot(a[0] - b[0], a[1] - b[1])));
    if (S.mode === "sensors") S.camFov = f; else S.view.fov = f;
    return;
  }
  const V = S.V; if (!V) return;
  const deg = (px) => Math.atan(px / V.f) * R2D;
  if (S.mode === "sensors") { if (S.aligning) S.yawOffset -= deg(dx); return; }
  S.view.az = (S.view.az - deg(dx) + 360) % 360; S.view.alt = Math.max(-89, Math.min(89, S.view.alt + deg(dy)));
});
const lift = (e) => {
  pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
  if (S.mode === "sensors") save("camFov", Math.round(S.camFov));
  if (dragged < 8 && !S.aligning) tap(e.clientX, e.clientY);
};
canvas.addEventListener("pointerup", lift); canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); pinch = null; });
addEventListener("wheel", (e) => { if (S.mode === "drag") S.view.fov = Math.max(10, Math.min(110, S.view.fov * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: true });

function tap(x, y) {
  let best = null, bd = 30;
  for (const o of shown) { const d = Math.hypot(o.x - x, o.y - y) - (o.r || 0) * 0.5 - (o.kind === "body" ? 6 : 0); if (d < bd) { bd = d; best = o; } }
  if (!best) { S.selected = null; $("#card").hidden = true; return; }
  if (best.kind === "sat") { const s = best.s; S.selected = { vec: () => s.enu || [0, 0, -1], sat: s }; satCard(s); return; }
  if (best.kind === "star") { const i = best.i; S.selected = { vec: () => [ENU[i * 3], ENU[i * 3 + 1], ENU[i * 3 + 2]] }; starCard(i); }
  else { const name = best.b.name; S.selected = { vec: () => S.bodies.find((b) => b.name === name).enu }; bodyCard(name); }
}
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const where = (v) => { const [alt, az] = vecAltAz(v); return alt < 0 ? `Below the horizon (${Math.round(-alt)}° down), ${dirName(az)}` : `${Math.round(alt)}° up, ${dirName(az)} (${Math.round(az)}°)`; };
function card(kind, name, rows, note) {
  const c = $("#card"); c.replaceChildren();
  const h = (t, p = {}) => Object.assign(document.createElement(t), p);
  c.append(h("div", { className: "kind", textContent: kind }), h("h2", { textContent: name }));
  const dl = h("dl"); for (const [k, v] of rows) if (v) dl.append(h("dt", { textContent: k }), h("dd", { textContent: v }));
  c.append(dl); if (note) c.append(h("p", { className: "note", textContent: note }));
  c.hidden = false;
}
function starCard(i) {
  const s = STARS[i], con = A.Constellation(s[0] / 15, s[1]);
  card("Star", s[4] || `A star in ${con.name}`, [["Where", where([ENU[i * 3], ENU[i * 3 + 1], ENU[i * 3 + 2]])], ["Brightness", `magnitude ${s[2].toFixed(1)}${s[2] < 1 ? ", one of the brightest in the sky" : ""}`], ["Constellation", con.name]]);
}
const NOTES = { Sun: "Never look at the Sun, through a lens least of all.", Moon: "", Venus: "The brightest thing in the sky after the Sun and Moon.", Jupiter: "Binoculars show up to four of its moons.", Saturn: "A small telescope shows the rings.", Mars: "", Mercury: "Always close to the Sun: look just after sunset or before sunrise.", Uranus: "Just at the edge of naked-eye visibility.", Neptune: "Needs binoculars or a telescope." };
function bodyCard(name) {
  const b = S.bodies.find((x) => x.name === name), t = A.MakeTime(new Date()), body = A.Body[name];
  const rise = A.SearchRiseSet(body, S.observer, +1, t, 1), set = A.SearchRiseSet(body, S.observer, -1, t, 1);
  const km = b.dist * 149597870.7;
  card(name === "Sun" || name === "Moon" ? name === "Sun" ? "Star" : "Moon" : "Planet", name, [
    ["Where", where(b.enu)],
    ["Rises", rise ? fmtTime(rise.date) : ""], ["Sets", set ? fmtTime(set.date) : ""],
    ["Distance", name === "Moon" ? `${Math.round(km).toLocaleString()} km` : `${b.dist.toFixed(2)} AU · ${(km / 1e6).toFixed(0)} million km`],
    ["Brightness", b.mag != null ? `magnitude ${b.mag.toFixed(1)}` : ""],
    ["Lit", name !== "Sun" && b.phase != null ? `${Math.round(b.phase * 100)}%` : ""]], NOTES[name]);
}

// ---- starting: the camera, the sensors and the place, or just a finger ----
async function startCamera() {
  $("#start").hidden = true;
  try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch (e) {}
  locate(); keepAwake();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = stream; video.hidden = false; await video.play(); S.camera = true;
  } catch (e) { toast("No camera: the sky is drawn on its own."); }
  S.mode = "sensors";
  setTimeout(() => { if (!S.target) { S.mode = "drag"; toast("No motion sensors here: drag to look around."); } else if (!S.absolute) toast("This phone's compass isn't available: align with the button at the top."); }, 2500);
}
function startDrag() { $("#start").hidden = true; locate(); }
function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((p) => {
    const { latitude: la, longitude: lo } = p.coords;
    S.observer = new A.Observer(la, lo, p.coords.altitude || 0); S.placeName = `${la.toFixed(2)}°, ${lo.toFixed(2)}°`;
    save("place", [la, lo]); save("placeName", S.placeName); $("#place").textContent = S.placeName; compute();
  }, () => {}, { timeout: 15000, maximumAge: 600000 });
}
let wake = null;
async function keepAwake() { try { wake = await navigator.wakeLock?.request("screen"); } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.mode === "sensors") keepAwake(); });
function toast(t) { document.querySelector(".toast")?.remove(); const d = Object.assign(document.createElement("div"), { className: "toast", textContent: t }); document.body.append(d); setTimeout(() => d.remove(), 5000); }

// ---- the buttons ----
$("#go-camera").addEventListener("click", startCamera);
$("#go-drag").addEventListener("click", startDrag);
$("#red").addEventListener("click", (e) => { const on = document.body.classList.toggle("red"); e.currentTarget.setAttribute("aria-pressed", String(on)); });
$("#menu").addEventListener("click", (e) => { const s = $("#sheet"); s.hidden = !s.hidden; e.currentTarget.setAttribute("aria-pressed", String(!s.hidden)); $("#fov").value = Math.round(S.camFov); });
$("#align").addEventListener("click", () => {
  if (S.mode !== "sensors") { toast("Aligning is for the camera view: in this view, drag to look around."); return; }
  S.aligning = !S.aligning; $("#align").setAttribute("aria-pressed", String(S.aligning)); $("#align-banner").hidden = !S.aligning;
  if (!S.aligning) save("yawOffset", S.yawOffset);
});
$("#align-done").addEventListener("click", () => $("#align").click());
document.querySelectorAll("[data-layer]").forEach((box) => { box.checked = S.layers[box.dataset.layer];
  box.addEventListener("change", () => { S.layers[box.dataset.layer] = box.checked; save("layers", S.layers); if (box.dataset.layer === "starlink") loadSats(); }); });
$("#find-iss").addEventListener("click", () => {
  const iss = SAT.list.find((s) => s.name === "ISS");
  if (!iss) { toast("The satellites haven't loaded yet."); return; }
  $("#sheet").hidden = true; $("#menu").setAttribute("aria-pressed", "false");
  placeSat(iss, new Date()); S.selected = { vec: () => iss.enu || [0, 0, -1], sat: iss }; satCard(iss);
});
$("#fov").addEventListener("input", (e) => { S.camFov = +e.target.value; save("camFov", S.camFov); });
$("#place").textContent = S.placeName;
setInterval(() => ($("#clock").textContent = fmtTime(new Date())), 1000);
$("#clock").textContent = fmtTime(new Date());
loadSky().then(() => { requestAnimationFrame(draw); loadSats(); });
