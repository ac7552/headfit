// First guesses for every pin from a few clicks, so a person only nudges pins instead of placing 40.
// The template head is posed by a 2D similarity (size, tilt, position) through the clicks, and each pin is put
// where that posed template has its spot.

import { project, sideRotation, FRONT_ROTATION } from "./camera.js";
import { apply3, mul3 } from "./linalg.js";
import { CURVES, PINS, pointOf, regionFor, SIDE_PINS } from "./pins.js";

const mid = (a, b) => a.map((x, k) => (x + b[k]) / 2);
const mp = (head, k) => {
  const v = head.landmarks68[k];
  return [head.positions[v * 3], head.positions[v * 3 + 1], head.positions[v * 3 + 2]];
};

const centroid = (head, verts) => {
  const c = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) c[k] += head.positions[v * 3 + k] / verts.length;
  return c;
};

// What each click means, in order. Front: the middle of each eye, then the middle of the mouth.
export const FRONT_CLICKS = [
  { name: "eyeRight", label: "the middle of the right eye (on the photo's left)", at: (h) => mid(mp(h, 36), mp(h, 39)) },
  { name: "eyeLeft", label: "the middle of the left eye (on the photo's right)", at: (h) => mid(mp(h, 42), mp(h, 45)) },
  { name: "mouth", label: "the middle of the mouth", at: (h) => mid(mp(h, 48), mp(h, 54)) },
];
export const SIDE_CLICKS = [
  { name: "noseTip", label: "the tip of the nose", at: (h) => mp(h, 30) },
  { name: "chin", label: "the bottom of the chin", at: (h) => mp(h, 8) },
  { name: "ear", label: "the middle of the ear", at: (h, side) => centroid(h, regionFor(h, "earSide", side)) },
];

// A scaled orthographic camera from clicks: base rotation, then in-plane rotation and scale by least squares.
function cameraFromClicks(head, clicks, defs, base, side) {
  const model = defs.map((d) => d.at(head, side));
  const flat = model.map((X) => apply3(base, X));
  // Fit p = s * Rz * flat.xy + t (2D similarity, Procrustes).
  const n = clicks.length;
  const mf = [0, 0], mc = [0, 0];
  for (let i = 0; i < n; i++) {
    mf[0] += flat[i][0] / n;
    mf[1] += flat[i][1] / n;
    mc[0] += clicks[i][0] / n;
    mc[1] += clicks[i][1] / n;
  }
  let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i++) {
    const fx = flat[i][0] - mf[0], fy = flat[i][1] - mf[1];
    const cx = clicks[i][0] - mc[0], cy = clicks[i][1] - mc[1];
    a += fx * cx + fy * cy;
    b += fx * cy - fy * cx;
    d += fx * fx + fy * fy;
  }
  const theta = Math.atan2(b, a);
  const s = Math.hypot(a, b) / d;
  const Rz = [Math.cos(theta), -Math.sin(theta), 0, Math.sin(theta), Math.cos(theta), 0, 0, 0, 1];
  const R = mul3(Rz, base);
  const c = apply3(Rz, [mf[0], mf[1], 0]);
  return { R, s, t: [mc[0] - s * c[0], mc[1] - s * c[1]], distance: Infinity };
}

export function startFront(head, clicks) {
  const cam = cameraFromClicks(head, clicks, FRONT_CLICKS, FRONT_ROTATION, null);
  const pins = {};
  const P = head.positions;
  const at = (v) => project(cam, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]).slice(0, 2);
  for (const pin of PINS) {
    if (pin.point) pins[pin.name] = project(cam, pointOf(pin, head, P)).slice(0, 2);
  }
  // Jaw pins at set places along the jaw line (ear, angle, cheek, chin corner on each side).
  const jaw = CURVES.jaw;
  const last = jaw.length - 1; // index k from the right ear matches last - k from the left ear
  const place = { jawHighRight: 3, jawLowRight: 8, jawRight: 11, chinRight: 15 };
  for (const [name, k] of Object.entries(place)) place[name.replace("Right", "Left")] = last - k;
  for (const [name, k] of Object.entries(place)) pins[name] = at(jaw[k]);
  // Ears: the outermost, highest and lowest points of each ear as posed.
  for (const [side, region] of [["Right", "earRight"], ["Left", "earLeft"]]) {
    const pts = regionFor(head, region).map(at);
    const outer = side === "Right" ? (p, q) => p[0] < q[0] : (p, q) => p[0] > q[0];
    pins[`earOuter${side}`] = pts.reduce((a, p) => (outer(p, a) ? p : a));
    pins[`earTop${side}`] = pts.reduce((a, p) => (p[1] < a[1] ? p : a));
    pins[`earLobe${side}`] = pts.reduce((a, p) => (p[1] > a[1] ? p : a));
  }
  return { pins, camera: cam };
}

// Side photo: facing "left" when the nose points to the photo's left.
export function startSide(head, clicks, facing) {
  const side = facing === "left" ? "left" : "right";
  const cam = cameraFromClicks(head, clicks, SIDE_CLICKS, sideRotation(facing), side);
  const P = head.positions;
  const proj = (v) => project(cam, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
  const pins = {};
  for (const pin of SIDE_PINS) {
    if (pin.point) pins[pin.name] = project(cam, pointOf(pin, head, P, side)).slice(0, 2);
  }
  const ear = regionFor(head, "earSide", side).map(proj);
  pins.earTop = ear.reduce((a, p) => (p[1] < a[1] ? p : a)).slice(0, 2);
  pins.earLobe = ear.reduce((a, p) => (p[1] > a[1] ? p : a)).slice(0, 2);
  const front = facing === "left" ? -1 : 1; // photo x direction the face points
  pins.earFront = ear.reduce((a, p) => (p[0] * front > a[0] * front ? p : a)).slice(0, 2);
  pins.earBack = ear.reduce((a, p) => (p[0] * front < a[0] * front ? p : a)).slice(0, 2);
  // Profile outline at set heights of the template.
  const profile = regionFor(head, "profile", side);
  const extreme = (y0, y1, dir) => {
    let best = null;
    for (const v of profile) {
      const y = P[v * 3 + 1];
      if (y < y0 || y > y1) continue;
      const p = proj(v);
      if (!best || p[0] * dir > best[0] * dir) best = p;
    }
    return best.slice(0, 2);
  };
  pins.forehead = extreme(8.5, 9.5, front);
  pins.backOfHead = extreme(2.5, 3.5, -front);
  pins.nape = extreme(-9.5, -8.5, -front);
  pins.throat = extreme(-11.5, -10.5, front);
  let top = null;
  for (const v of profile) {
    const p = proj(v);
    if (!top || p[1] < top[1]) top = p;
  }
  pins.crown = top.slice(0, 2);
  return { pins, camera: cam };
}
