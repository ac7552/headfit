// How well the fit does, on made-up heads whose true shape is known.
// For each head: a known smile and pose, pins where they truly are plus a little hand-placing error, then
//   - face shape error (mm, root mean square over the front of the face, after lining up by a similarity),
//     for the plain template, the fit with the camera estimated, and the fit with the true camera
//   - the smile read back
//   - hidden pins: one pin left out at a time, and how far the fitted head puts that spot (% of eye width)
// Run:  node tools/eval_synthetic.mjs [heads] [pixel noise]
import { project } from "../src/camera.js";
import { fitHead } from "../src/fit.js";
import { PINS, pointOf } from "../src/pins.js";
import { LOOKS, madeUpPhoto, seeded } from "../src/synth.js";
import { similarityFit } from "../src/warp.js";
import { nodeHead } from "./node-head.mjs";

const heads = Number(process.argv[2] || 20);
const noise = Number(process.argv[3] || 2);
const head = nodeHead();
const SIZE = 900;
const face = [];
for (let v = 0; v < 6706; v += 7) face.push(v); // ICT's narrow face area
const HIDE = ["eyeOuterRight", "noseBottom", "mouthRight", "lipTop", "lipBottom", "chin", "browMiddleLeft"];

function shapeError(P, T) {
  const sim = similarityFit(face.map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]), face.map((v) => [T[v * 3], T[v * 3 + 1], T[v * 3 + 2]]));
  let s = 0;
  for (const v of face) s += Math.hypot(...sim.at([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]).map((x, k) => x - T[v * 3 + k])) ** 2;
  return Math.sqrt(s / face.length) * 10;
}

const rows = [];
for (let i = 0; i < heads; i++) {
  const smile = i % 3 === 0 ? 0.5 : 0;
  const photo = madeUpPhoto(head, { seed: 100 + i, look: LOOKS[i % LOOKS.length], smile, size: SIZE, distance: i % 4 === 3 ? 45 : 120, draw: false });
  const rand = seeded(500 + i);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const pins = Object.fromEntries(Object.entries(photo.pins).map(([k, [x, y]]) => [k, [x + noise * gauss(), y + noise * gauss()]]));
  const view = { kind: "front", width: SIZE, height: SIZE, pins, distance: photo.camera.distance };
  const fit = fitHead(head, [view]);
  const known = fitHead(head, [view], { cameras: [photo.camera] });
  const eyes = Math.hypot(photo.pins.eyeOuterRight[0] - photo.pins.eyeOuterLeft[0], photo.pins.eyeOuterRight[1] - photo.pins.eyeOuterLeft[1]);
  const hidden = [];
  for (const name of HIDE) {
    const rest = { ...pins };
    delete rest[name];
    const f = fitHead(head, [{ ...view, pins: rest }]);
    const def = PINS.find((p) => p.name === name);
    const cam = f.views[0].camera;
    const d = (P) => {
      const q = project(cam, pointOf(def, head, P));
      return (100 * Math.hypot(q[0] - photo.pins[name][0], q[1] - photo.pins[name][1])) / eyes;
    };
    hidden.push({ name, template: d(head.positions), fitted: d(f.fitted) });
  }
  rows.push({
    template: shapeError(head.positions, photo.truth.neutral),
    fitted: shapeError(fit.neutral, photo.truth.neutral),
    known: shapeError(known.neutral, photo.truth.neutral),
    smile,
    read: ((fit.weights.mouthSmile_L || 0) + (fit.weights.mouthSmile_R || 0)) / 2,
    hidden,
  });
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`${heads} made-up heads, pins placed with ${noise} px of error on ${SIZE} px photos.`);
console.log(`Face shape error (mm): template ${mean(rows.map((r) => r.template)).toFixed(2)}, fitted ${mean(rows.map((r) => r.fitted)).toFixed(2)}, fitted with the true camera ${mean(rows.map((r) => r.known)).toFixed(2)}`);
const smiling = rows.filter((r) => r.smile), straight = rows.filter((r) => !r.smile);
console.log(`Smile 0.5 read as ${mean(smiling.map((r) => r.read)).toFixed(2)} on average; no smile read as ${mean(straight.map((r) => r.read)).toFixed(2)}`);
const all = rows.flatMap((r) => r.hidden);
console.log(`Hidden pins (% of eye width): template ${mean(all.map((h) => h.template)).toFixed(1)}, fitted ${mean(all.map((h) => h.fitted)).toFixed(1)}`);
for (const name of HIDE) {
  const h = all.filter((x) => x.name === name);
  console.log(`  ${name.padEnd(15)} ${mean(h.map((x) => x.template)).toFixed(1).padStart(5)}  ${mean(h.map((x) => x.fitted)).toFixed(1).padStart(5)}`);
}
