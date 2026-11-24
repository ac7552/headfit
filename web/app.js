import * as THREE from "three";
import { GLTFExporter } from "./vendor/GLTFExporter.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { ATLAS } from "../src/bake.js";
import { hairShell } from "../src/hair.js";
import { readHead, vertexNormals } from "../src/head.js";
import { PINS, pinsFromPoints, SIDE_PINS } from "../src/pins.js";
import { FRONT_CLICKS, SIDE_CLICKS, startFront, startSide } from "../src/start.js";

const MAX_SIDE = 1600; // photos are scaled to at most this many pixels across before pinning
const $ = (id) => document.getElementById(id);

const state = {
  head: null,
  view: "front",
  photos: { front: null, side: null },
  expression: "neutral",
  result: null,
  hairColourSet: false,
  busy: 0,
  pending: null,
};

// ---------- the head data ----------
const headReady = (async () => {
  const header = await (await fetch("../data/ict-head.json")).json();
  const buffer = await (await fetch("../data/ict-head.bin")).arrayBuffer();
  state.head = readHead(header, buffer);
  buildScene(state.head);
})();

// ---------- photos ----------
async function photoFromBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * k), height = Math.round(bitmap.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { width, height, url: canvas.toDataURL("image/jpeg", 0.92), imageData: ctx.getImageData(0, 0, width, height), scale: k };
}

$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const photo = await photoFromBlob(file);
  photo.pins = null;
  photo.clicks = [];
  photo.facing = $("side-facing").value;
  state.photos[state.view] = photo;
  e.target.value = "";
  resetZoom();
  draw();
  promptClick();
});

fetch("samples/index.json").then((r) => r.json()).then((list) => {
  const sel = $("sample");
  for (const s of list) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.label} (${s.about})`;
    sel.append(o);
  }
});

$("sample").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  await headReady;
  const [blob, tem] = await Promise.all([
    fetch(`samples/${id}.jpg`).then((r) => r.blob()),
    fetch(`samples/${id}.json`).then((r) => r.json()),
  ]);
  const photo = await photoFromBlob(blob);
  const k = photo.scale;
  // Samples carry their pins; a Face Research Lab style template (189 points) works too.
  photo.pins = tem.pins
    ? Object.fromEntries(Object.entries(tem.pins).map(([name, [x, y]]) => [name, [x * k, y * k]]))
    : pinsFromPoints(tem.points.map(([x, y]) => [x * k, y * k])).pins;
  if (tem.distance) $("distance").value = tem.distance >= 80 ? "120" : "45";
  photo.clicks = null;
  setView("front");
  state.photos.front = photo;
  state.photos.side = null;
  e.target.value = "";
  resetZoom();
  draw();
  say("A made-up face, with its pins where they truly are. Drag any of them to see the head follow.");
  refit();
});

// ---------- views ----------
function setView(view) {
  state.view = view;
  for (const t of document.querySelectorAll(".tab")) {
    const on = t.dataset.view === view;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-selected", on);
  }
  $("side-facing-row").hidden = view !== "side";
  resetZoom();
  draw();
  const p = state.photos[view];
  if (!p) say(view === "side" ? "A side photo makes the nose, chin and the back of the head truer. Choose one, or skip it." : "");
  else if (p.clicks && p.clicks.length < 3) promptClick();
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => setView(t.dataset.view));

$("side-facing").addEventListener("change", (e) => {
  const p = state.photos.side;
  if (p) {
    p.facing = e.target.value;
    if (p.pins) refit();
  }
});
$("distance").addEventListener("change", () => refit());
$("ears").addEventListener("change", () => {
  draw();
  refit();
});
$("replace").addEventListener("click", () => {
  const p = state.photos[state.view];
  if (!p) return;
  p.pins = null;
  p.clicks = [];
  draw();
  promptClick();
});

// ---------- the photo with its pins ----------
const svg = $("photo");
const NS = "http://www.w3.org/2000/svg";
let box = null; // viewBox [x, y, w, h]

function resetZoom() {
  const p = state.photos[state.view];
  box = p ? [0, 0, p.width, p.height] : [0, 0, 100, 100];
  if (p) {
    // Fit the photo into the square stage.
    const s = Math.max(p.width, p.height);
    box = [(p.width - s) / 2, (p.height - s) / 2, s, s];
  }
}

function pinDefs(view) {
  return view === "side" ? SIDE_PINS : PINS;
}
const earsHidden = () => $("ears").checked;

function draw() {
  const p = state.photos[state.view];
  $("empty").hidden = !!p;
  svg.replaceChildren();
  if (!p) return;
  svg.setAttribute("viewBox", box.join(" "));
  const img = document.createElementNS(NS, "image");
  img.setAttribute("href", p.url);
  img.setAttribute("width", p.width);
  img.setAttribute("height", p.height);
  svg.append(img);
  const r = 6.5 * (box[2] / (svg.clientWidth || 600));
  const marks = p.pins ? Object.entries(p.pins) : (p.clicks || []).map((c, i) => [`click${i}`, c]);
  for (const [name, at] of marks) {
    const def = pinDefs(state.view).find((d) => d.name === name);
    if (def && def.group === "ears" && earsHidden()) continue;
    const g = document.createElementNS(NS, "g");
    g.classList.add("pin");
    if (def && (def.outline || def.curve)) g.classList.add("slides");
    if (state.active === name) g.classList.add("is-active");
    g.dataset.name = name;
    const c = document.createElementNS(NS, "circle");
    c.classList.add("head");
    c.setAttribute("cx", at[0]);
    c.setAttribute("cy", at[1]);
    c.setAttribute("r", r);
    c.setAttribute("stroke-width", r * 0.3);
    g.append(c);
    const title = document.createElementNS(NS, "title");
    title.textContent = def ? def.label : "";
    g.append(title);
    svg.append(g);
  }
}

function toImage(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [q.x, q.y];
}

function promptClick() {
  const p = state.photos[state.view];
  if (!p || !p.clicks) return;
  const steps = state.view === "side" ? SIDE_CLICKS : FRONT_CLICKS;
  svg.classList.toggle("is-placing", p.clicks.length < steps.length);
  if (p.clicks.length < steps.length) say(`Click ${steps[p.clicks.length].label} (${p.clicks.length + 1} of ${steps.length}).`);
}

let drag = null;
svg.addEventListener("pointerdown", (e) => {
  const p = state.photos[state.view];
  if (!p) return;
  const pin = e.target.closest(".pin");
  if (pin && p.pins) {
    state.active = pin.dataset.name;
    drag = { kind: "pin", name: pin.dataset.name };
    const def = pinDefs(state.view).find((d) => d.name === pin.dataset.name);
    if (def) say(`${def.label}${def.outline || def.curve ? ": blue pins slide along the outline, so only how far out it sits matters" : ""}.`);
  } else {
    drag = { kind: "pan", from: [e.clientX, e.clientY], box: box.slice(), moved: false };
  }
  svg.setPointerCapture(e.pointerId);
  draw();
});
svg.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.kind === "pin") {
    state.photos[state.view].pins[drag.name] = toImage(e);
    draw();
  } else {
    const k = box[2] / svg.clientWidth;
    const dx = (e.clientX - drag.from[0]) * k, dy = (e.clientY - drag.from[1]) * k;
    if (Math.hypot(dx, dy) > 3 * k) drag.moved = true;
    box = [drag.box[0] - dx, drag.box[1] - dy, box[2], box[3]];
    draw();
  }
});
svg.addEventListener("pointerup", async (e) => {
  const p = state.photos[state.view];
  const d = drag;
  drag = null;
  if (!d || !p) return;
  if (d.kind === "pin") {
    refit();
    return;
  }
  if (d.moved || !p.clicks) return;
  const steps = state.view === "side" ? SIDE_CLICKS : FRONT_CLICKS;
  if (p.clicks.length >= steps.length) return;
  p.clicks.push(toImage(e));
  if (p.clicks.length === steps.length) {
    await headReady;
    const start = state.view === "side" ? startSide(state.head, p.clicks, p.facing) : startFront(state.head, p.clicks);
    p.pins = start.pins;
    p.clicks = null;
    svg.classList.remove("is-placing");
    say("Now drag each pin onto its spot. Zoom with the wheel; drag the photo to move it. Red pins are spots, blue pins slide along an outline.");
    refit();
  } else promptClick();
  draw();
});
svg.addEventListener("wheel", (e) => {
  if (!state.photos[state.view]) return;
  e.preventDefault();
  const [x, y] = toImage(e);
  const k = Math.exp(e.deltaY * 0.0015);
  box = [x - (x - box[0]) * k, y - (y - box[1]) * k, box[2] * k, box[3] * k];
  draw();
}, { passive: false });

function say(text) {
  $("status").textContent = text;
}

// ---------- fitting (in a worker) ----------
const worker = new Worker("worker.js", { type: "module" });
let ticket = 0;
worker.onmessage = ({ data }) => {
  state.busy--;
  if (data.id !== ticket) return; // an older request
  if (data.error) {
    say(data.error);
    return;
  }
  state.result = data;
  showResult();
};

function refit() {
  const front = state.photos.front;
  if (!front || !front.pins) return;
  const views = [], images = [];
  const pinsOf = (photo, defs) => Object.fromEntries(Object.entries(photo.pins).filter(([name]) => {
    const def = defs.find((d) => d.name === name);
    return def && !(def.group === "ears" && earsHidden());
  }));
  const distance = Number($("distance").value);
  views.push({ kind: "front", width: front.width, height: front.height, pins: pinsOf(front, PINS), distance });
  images.push(front.imageData);
  const side = state.photos.side;
  if (side && side.pins) {
    views.push({ kind: "side", facing: side.facing, width: side.width, height: side.height, pins: pinsOf(side, SIDE_PINS), distance });
    images.push(side.imageData);
  }
  ticket++;
  state.busy++;
  $("readout").textContent = "Fitting…";
  worker.postMessage({ id: ticket, views, images, paint: true });
}

// ---------- the 3D view ----------
const viewer = $("viewer");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewer.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#d5dade");
const camera = new THREE.PerspectiveCamera(26, 1, 1, 1000);
camera.position.set(0, 4, 78);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa1a6, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(20, 30, 60);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.5);
rim.position.set(-30, 10, -40);
scene.add(rim);

const group = new THREE.Group();
group.name = "head";
scene.add(group);
const meshes = {};
let skinCanvas = null;

function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  draw();
}
window.addEventListener("resize", resize);

function partGeometry(head, part, uvScale = 1, keep = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(part.source.length * 3), 3));
  const uv = Float32Array.from(part.uv);
  if (uvScale !== 1) for (let i = 0; i < uv.length; i += 2) uv[i] *= uvScale;
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  let tris = part.triangles;
  if (keep) {
    const kept = [];
    for (let t = 0; t < tris.length; t += 3) if (keep(tris[t], tris[t + 1], tris[t + 2])) kept.push(tris[t], tris[t + 1], tris[t + 2]);
    tris = kept;
  }
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(tris), 1));
  return g;
}

// Upper lashes only: the lower strips, drawn without a lash texture, read as a dark smudge under the eye.
function upperLashes(head, part) {
  const P = head.positions;
  const eyeY = 3.6; // middle of the eyeballs in the template, cm
  return (a, b, c) => (P[part.source[a] * 3 + 1] + P[part.source[b] * 3 + 1] + P[part.source[c] * 3 + 1]) / 3 > eyeY;
}

// The eyeball's UVs put the front of the eye at (0.5, 0.5), with about 0.11 of UV per 6 mm: an iris of 5.9 mm
// radius and a pupil of 2 mm.
function irisTexture(colour) {
  const N = 512, c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  g.fillStyle = "#e9e3dc";
  g.fillRect(0, 0, N, N);
  const [r, gr, b] = colour.map((x) => Math.round(x));
  const R = 0.108 * N, P = 0.036 * N, m = N / 2;
  const shade = (k) => `rgb(${Math.round(r * k)},${Math.round(gr * k)},${Math.round(b * k)})`;
  const grad = g.createRadialGradient(m, m, P, m, m, R);
  grad.addColorStop(0, shade(0.7));
  grad.addColorStop(0.55, shade(1.05));
  grad.addColorStop(0.88, shade(0.85));
  grad.addColorStop(1, shade(0.35));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(m, m, R, 0, Math.PI * 2);
  g.fill();
  // Fibres: faint radial streaks.
  g.globalAlpha = 0.18;
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + Math.random() * 0.05;
    g.strokeStyle = i % 2 ? shade(1.5) : shade(0.5);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * P, m + Math.sin(a) * P);
    g.lineTo(m + Math.cos(a) * R * 0.95, m + Math.sin(a) * R * 0.95);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = "#0a0a0c";
  g.beginPath();
  g.arc(m, m, P, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hairGrain() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 150 + Math.random() * 105;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grain = hairGrain();

function buildScene(head) {
  skinCanvas = document.createElement("canvas");
  skinCanvas.width = 2048;
  skinCanvas.height = 1024;
  const sctx = skinCanvas.getContext("2d");
  sctx.fillStyle = "#cfc6bf";
  sctx.fillRect(0, 0, 2048, 1024);
  const skinTex = new THREE.CanvasTexture(skinCanvas);
  skinTex.colorSpace = THREE.SRGBColorSpace;
  skinTex.anisotropy = 4;
  const looks = {
    skin: new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.7, name: "skin" }),
    mouth: new THREE.MeshStandardMaterial({ color: "#4a2224", roughness: 0.9, name: "mouth" }),
    eyeSocketL: new THREE.MeshStandardMaterial({ color: "#c9a99a", roughness: 0.8, name: "eyeSocket" }),
    eyeSocketR: null,
    gums: new THREE.MeshStandardMaterial({ color: "#b8646b", roughness: 0.6, name: "gums" }),
    teeth: new THREE.MeshStandardMaterial({ color: "#ebe4d6", roughness: 0.35, name: "teeth" }),
    // ICT's eyeball is drawn as one ball with the iris painted at the middle of its UVs; ICT's separate iris
    // disc sits under a clear cornea that needs Unreal's eye shader, so it is left out.
    scleraL: new THREE.MeshStandardMaterial({ map: irisTexture([80, 60, 45]), roughness: 0.15, name: "eye" }),
    scleraR: null,
    // ICT's lashes are strips meant for a lash texture with see-through gaps; drawn thin by dithering instead.
    lashesL: new THREE.MeshStandardMaterial({ color: "#1d1714", roughness: 0.8, side: THREE.DoubleSide, alphaHash: true, opacity: 0.45, name: "lashes" }),
    lashesR: null,
  };
  looks.eyeSocketR = looks.eyeSocketL;
  looks.scleraR = looks.scleraL;
  looks.lashesR = looks.lashesL;
  for (const part of head.parts) {
    const mat = looks[part.name];
    if (!mat) continue;
    const geo = partGeometry(head, part, part.name === "skin" ? 1 / ATLAS.tiles : 1,
      part.name.startsWith("lashes") ? upperLashes(head, part) : null);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = part.name;
    mesh.userData.part = part;
    meshes[part.name] = mesh;
    group.add(mesh);
  }
  setPositions(head.positions);
  resize();
}

function setPositions(P) {
  // Normals from the shared vertices, so the UV seams don't show in the shading.
  const N = vertexNormals(state.head, P, Object.keys(meshes).filter((k) => meshes[k].userData.part));
  for (const mesh of Object.values(meshes)) {
    const part = mesh.userData.part;
    if (!part) continue;
    const g = mesh.geometry;
    if (!g.attributes.normal) g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(part.source.length * 3), 3));
    const a = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < part.source.length; i++) {
      const v = part.source[i];
      for (let k = 0; k < 3; k++) {
        a.array[i * 3 + k] = P[v * 3 + k];
        n.array[i * 3 + k] = N[v * 3 + k];
      }
    }
    a.needsUpdate = true;
    n.needsUpdate = true;
    g.computeBoundingSphere();
  }
  updateHair(P);
}

function currentPositions() {
  const r = state.result;
  if (!r) return state.head.positions;
  return state.expression === "photo" ? r.fitted : r.neutral;
}

function updateHair(P) {
  if (meshes.hair) {
    group.remove(meshes.hair);
    meshes.hair.geometry.dispose();
    delete meshes.hair;
  }
  const shell = hairShell(state.head, P, $("hair").value);
  if (!shell) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(shell.position, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(shell.uv, 2));
  const col = new Float32Array((shell.position.length / 3) * 4);
  for (let i = 0; i < shell.alpha.length; i++) {
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
    col[i * 4 + 3] = shell.alpha[i];
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 4));
  g.setIndex(new THREE.BufferAttribute(shell.index, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: $("hair-colour").value, map: grain, roughness: 0.85, vertexColors: true, alphaHash: true, name: "hair",
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "hair";
  meshes.hair = mesh;
  group.add(mesh);
}

const hex = (c) => "#" + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");

function showResult() {
  const r = state.result;
  setPositions(currentPositions());
  if (r.texture) {
    const ctx = skinCanvas.getContext("2d");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.texture.data), r.texture.width, r.texture.height), 0, 0);
    meshes.skin.material.map.needsUpdate = true;
    meshes.eyeSocketL.material.color.set(hex(r.tone.map((x) => x * 0.9)));
    meshes.scleraL.material.map = irisTexture(r.iris);
    meshes.scleraL.material.needsUpdate = true;
    if (r.hair && !state.hairColourSet) {
      $("hair-colour").value = hex(r.hair);
      if (meshes.hair) meshes.hair.material.color.set(hex(r.hair));
    }
  }
  $("download").disabled = false;
  const expr = Object.entries(r.weights).map(([k, w]) => `${k} ${w.toFixed(2)}`).join(", ");
  const n = r.report.pins.length;
  $("readout").textContent =
    `Fitted to ${n} pins, ${r.report.meanPixels.toFixed(1)} px off on average. ` +
    (expr ? `Expression read from the photo: ${expr}. ` : "No expression read: the face looks neutral. ") +
    `${r.ms.fit} ms to fit, ${r.ms.paint ?? 0} ms to paint.`;
}

for (const b of document.querySelectorAll("[data-expression]")) {
  b.addEventListener("click", () => {
    state.expression = b.dataset.expression;
    for (const x of document.querySelectorAll("[data-expression]")) {
      x.classList.toggle("is-on", x === b);
      x.setAttribute("aria-checked", x === b);
    }
    if (state.head) setPositions(currentPositions());
  });
}
$("hair").addEventListener("change", () => state.head && updateHair(currentPositions()));
$("hair-colour").addEventListener("input", (e) => {
  state.hairColourSet = true;
  if (meshes.hair) meshes.hair.material.color.set(e.target.value);
});

$("download").addEventListener("click", async () => {
  const exporter = new GLTFExporter();
  const copy = group.clone(true);
  copy.scale.setScalar(0.01); // glTF is in metres
  const glb = await exporter.parseAsync(copy, { binary: true });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  a.download = "head.glb";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

window.headfit = { state, refit, setView, camera, controls }; // for tests and poking around
