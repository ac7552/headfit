// Fits the ICT head to pins on one or two photos, with geometry only:
//   1. a camera per photo from the pins (least squares, see camera.js)
//   2. a first bend of the head from the pins an expression doesn't move (eye corners, nose, brows, ears)
//   3. expression weights from what's left at the mouth, lids and chin (ICT's ARKit shapes: an animation rig)
//   4. the full bend (a 3D thin-plate spline) carrying every pin's spot on the head onto its ray through the photo
// The result has the photo's expression (to lay the photo on) and a neutral copy (to show).

import { fitPerspective, FRONT_ROTATION, project, ray, refineCamera, scaleAt, sideRotation } from "./camera.js";
import { posed } from "./head.js";
import { apply3, det3, leastSquares, nearestRotation, transpose3 } from "./linalg.js";
import { CURVES, PINS, pointOf, regionFor, SIDE_PINS } from "./pins.js";
import { similarityFit, thinPlate } from "./warp.js";

// Read by least squares from the mouth and lid pins. jawOpen is read on its own, from the gap between the lips:
// a long chin or full lips look like an open jaw to least squares.
export const EXPRESSIONS = [
  "mouthSmile_L", "mouthSmile_R",
  "mouthUpperUp_L", "mouthUpperUp_R",
  "eyeBlink_L", "eyeBlink_R",
  "eyeSquint_L", "eyeSquint_R",
];

// Pins an expression barely moves: these bend the head before the expression is read.
const STEADY = new Set([
  "eyeOuterRight", "eyeInnerRight", "eyeInnerLeft", "eyeOuterLeft",
  "browOuterRight", "browMiddleRight", "browInnerRight", "browInnerLeft", "browMiddleLeft", "browOuterLeft",
  "noseBridge", "noseBottom", "nostrilRight", "nostrilLeft",
  "jawHighRight", "jawHighLeft",
  "earOuterRight", "earTopRight", "earLobeRight", "earOuterLeft", "earTopLeft", "earLobeLeft",
]);
const CAMERA_PINS = ["eyeOuterRight", "eyeInnerRight", "eyeInnerLeft", "eyeOuterLeft", "noseBottom",
  "nostrilRight", "nostrilLeft", "noseBridge", "mouthRight", "mouthLeft", "lipTop", "chin"];

// The same spot named on the side photo and on the front photo, so the two photos can be combined.
const SAME_SPOT = {
  noseBottom: "noseBottom", noseBridge: "noseBridge", lipTop: "lipTop", lipBottom: "lipBottom", chin: "chin",
};
const sideToFront = (name, side) => {
  if (SAME_SPOT[name]) return SAME_SPOT[name];
  if (name === "eyeOuter") return side === "left" ? "eyeOuterLeft" : "eyeOuterRight";
  if (name === "mouthCorner") return side === "left" ? "mouthLeft" : "mouthRight";
  return null;
};

export const DEFAULTS = {
  distance: 120, // cm from camera to face, when not known (a photo taken by someone else, not at arm's length)
  stiffness: 0.3, // thin-plate smoothing (cm): higher lets pins miss more and bends less
  expressionRidge: 4, // pull of each expression weight toward zero, in pixel^2 per pin
  readExpression: true,
  rounds: 3, // outline pins are matched again after each bend
  poseRounds: 4, // with two photos: cameras posed again on the bent head
};

export function fitHead(head, views, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const base = head.positions;
  const front = views.find((v) => v.kind !== "side");
  if (!front) throw new Error("a front photo is needed");
  const all = views.map((view) => prepareView(head, view));

  // 1. Cameras, from the template's own spots (the template is close enough to pose a face).
  all.forEach((v, i) => (v.camera = o.cameras?.[i] || poseCamera(head, v, base, o)));

  // 2. First bend: steady pins only, no expression.
  const steady = (name) => STEADY.has(name);
  let warp1 = bend(head, all, base, base, o, { only: steady, rounds: 2 });
  const bent1 = warp1.all(base);

  // 3. Expression, read from the front photo against the first bend.
  const weights = o.readExpression ? readExpression(head, all.find((v) => v.kind !== "side"), bent1, warp1, o) : {};
  if (o.expressionWeights) Object.assign(weights, o.expressionWeights);

  // 4. Full bend of the posed template.
  const pose = posed(head, weights);
  let warp = bend(head, all, pose, pose, o, { rounds: o.rounds });
  let fitted = warp.all(pose);
  // With two photos, a camera posed a little wrong leaves the photos disagreeing about where a spot is. Pose each
  // camera again on the bent head, bend again, a few times (bundle adjustment, by alternation).
  if (all.length > 1 && !o.cameras) {
    for (let round = 0; round < o.poseRounds; round++) {
      for (const v of all) v.camera = poseCamera(head, v, fitted, o, v.camera);
      warp = bend(head, all, pose, fitted, o, { rounds: o.rounds });
      fitted = warp.all(pose);
    }
  }
  keepEyesRound(head, pose, warp, fitted);

  // The neutral copy: take the expression back out, as the bend's linear part carries it.
  const neutral = Float32Array.from(fitted);
  const L = warp.linear;
  for (const [name, w] of Object.entries(weights)) {
    if (!w) continue;
    const { index, delta } = head.expressions.get(name);
    for (let i = 0; i < index.length; i++) {
      const d = [delta[i * 3] * w, delta[i * 3 + 1] * w, delta[i * 3 + 2] * w];
      const v = index[i] * 3;
      neutral[v] -= L[0] * d[0] + L[1] * d[1] + L[2] * d[2];
      neutral[v + 1] -= L[3] * d[0] + L[4] * d[1] + L[5] * d[2];
      neutral[v + 2] -= L[6] * d[0] + L[7] * d[1] + L[8] * d[2];
    }
  }

  return {
    fitted, // matches the photo (expression and all): lay the photo onto this
    neutral, // the same face with the expression taken out
    weights,
    warp,
    views: all.map((v) => ({ kind: v.kind, facing: v.facing, camera: v.camera, width: v.width, height: v.height })),
    report: report(head, all, fitted),
  };
}

function prepareView(head, view) {
  const side = view.kind === "side";
  const facing = view.facing || "left";
  const defs = side ? SIDE_PINS : PINS;
  const pins = [];
  for (const def of defs) {
    const at = view.pins[def.name];
    if (!at) continue;
    const out = def.outline
      ? { ...def.outline, out: side && facing === "right" ? [-def.outline.out[0], def.outline.out[1]] : def.outline.out }
      : null;
    pins.push({ def, name: def.name, at, outline: out, curve: def.curve || null, weight: def.weight ?? 1 });
  }
  return { ...view, kind: side ? "side" : "front", facing, side: side ? facing : null, pins };
}

function poseCamera(head, v, positions, o, from = null) {
  const pts = [], px = [], w = [];
  for (const p of v.pins) {
    if (p.outline || p.curve) continue;
    if (v.kind === "front" && !from && !CAMERA_PINS.includes(p.name)) continue;
    pts.push(pointOf(p.def, head, positions, v.side));
    px.push(p.at);
    w.push(p.weight);
  }
  if (pts.length < 4) throw new Error(`${v.kind} photo: place at least 4 pins on the eyes, nose and mouth`);
  if (from) return refineCamera(from, pts, px, w);
  const baseR = v.kind === "side" ? sideRotation(v.facing) : FRONT_ROTATION;
  return fitPerspective(pts, px, {
    distance: v.distance ?? o.distance, width: v.width, height: v.height, weights: w, base: baseR,
  });
}

// One bend: control points from pins (point and outline) and anchors, thin-plate spline from `from` positions.
// `current` is where the head is now (used to find outline vertices); both arrays share vertex numbering.
function bend(head, views, from, current, o, { only = null, rounds = 1 } = {}) {
  let warp = null;
  let now = current;
  for (let round = 0; round < rounds; round++) {
    const ctrl = []; // { v | point, from, to, w }
    // Point pins, combined across photos where the same spot is pinned on both.
    const byName = new Map();
    for (const v of views) {
      for (const p of v.pins) {
        if (p.outline || p.curve) continue;
        const key = v.kind === "side" ? sideToFront(p.name, v.side) || `side:${p.name}` : p.name;
        if (only && !only(key)) continue;
        if (!byName.has(key)) byName.set(key, { def: p.def, side: v.side, rays: [], weight: p.weight });
        byName.get(key).rays.push(ray(v.camera, p.at));
      }
    }
    for (const [, s] of byName) {
      const X0 = pointOf(s.def, head, from, s.side);
      const Xn = pointOf(s.def, head, now, s.side);
      ctrl.push({ from: X0, to: nearestOnRays(s.rays, Xn), w: s.weight });
    }
    // Outline and curve pins.
    for (const v of views) {
      for (const p of v.pins) {
        if (!p.outline && !p.curve) continue;
        if (only && !only(p.name)) continue;
        const hit = p.curve ? curveTarget(head, v, p, now) : outlineTarget(head, v, p, now);
        if (!hit) continue;
        ctrl.push({ from: [from[hit.v * 3], from[hit.v * 3 + 1], from[hit.v * 3 + 2]], to: hit.to, w: p.weight });
      }
    }
    if (ctrl.length < 4) return identityWarp();
    // Anchors keep the back of the head and the neck in the template's shape, carried by the pins' similarity.
    const aff = similarityFit(ctrl.map((c) => c.from), ctrl.map((c) => c.to), ctrl.map((c) => c.w));
    for (const v of anchors(head)) {
      if (views.some((w) => w.kind === "side") && head._profileAnchors?.has(v)) continue;
      const X = [from[v * 3], from[v * 3 + 1], from[v * 3 + 2]];
      ctrl.push({ from: X, to: aff.at(X), w: 0.5 });
    }
    warp = thinPlate(ctrl.map((c) => c.from), ctrl.map((c) => c.to), {
      stiffness: o.stiffness, weights: ctrl.map((c) => c.w),
    });
    if (round < rounds - 1) now = warp.all(from);
  }
  return warp;
}

function identityWarp() {
  return { at: (X) => X.slice(), all: (p) => Float32Array.from(p), linear: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 0, 0] };
}

// Least-squares point nearest to all rays, pulled a little toward `prior` (so one ray keeps the prior's depth).
function nearestOnRays(rays, prior) {
  const M = new Float64Array(9), b = new Float64Array(3);
  const tiny = 1e-3;
  for (const { origin: q, direction: d } of rays) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const m = (i === j ? 1 : 0) - d[i] * d[j];
        M[i * 3 + j] += m;
        b[i] += m * q[j];
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    M[i * 3 + i] += tiny;
    b[i] += tiny * prior[i];
  }
  // 3x3 solve
  const A = Array.from(M);
  const inv = invert3(A);
  return apply3(inv, Array.from(b));
}

function invert3(A) {
  const d = det3(A);
  const c = (i, j) => A[i * 3 + j];
  return [
    (c(1, 1) * c(2, 2) - c(1, 2) * c(2, 1)) / d, (c(0, 2) * c(2, 1) - c(0, 1) * c(2, 2)) / d, (c(0, 1) * c(1, 2) - c(0, 2) * c(1, 1)) / d,
    (c(1, 2) * c(2, 0) - c(1, 0) * c(2, 2)) / d, (c(0, 0) * c(2, 2) - c(0, 2) * c(2, 0)) / d, (c(0, 2) * c(1, 0) - c(0, 0) * c(1, 2)) / d,
    (c(1, 0) * c(2, 1) - c(1, 1) * c(2, 0)) / d, (c(0, 1) * c(2, 0) - c(0, 0) * c(2, 1)) / d, (c(0, 0) * c(1, 1) - c(0, 1) * c(1, 0)) / d,
  ];
}

// The outline vertex for an outline pin: in a band along the outline at the pin, the vertex furthest outward.
// Returns { v, to }: v moved straight outward (in the photo) until it reaches the pin.
function outlineTarget(head, view, pin, positions) {
  const verts = regionFor(head, pin.outline.region, view.side);
  if (!verts || !verts.length) return null;
  const cam = view.camera;
  const [ox, oy] = pin.outline.out;
  const tx = -oy, ty = ox; // along the outline
  const s = scaleAt(cam, [positions[verts[0] * 3], positions[verts[0] * 3 + 1], positions[verts[0] * 3 + 2]]);
  const band = 0.45 * s; // 4.5 mm either side
  let best = -1, bestOut = -Infinity, bestP = null;
  for (const v of verts) {
    const X = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const p = project(cam, X);
    const along = (p[0] - pin.at[0]) * tx + (p[1] - pin.at[1]) * ty;
    if (Math.abs(along) > band) continue;
    const out = p[0] * ox + p[1] * oy;
    if (out > bestOut) {
      bestOut = out;
      best = v;
      bestP = p;
    }
  }
  if (best < 0) return null;
  const gap = (pin.at[0] - bestP[0]) * ox + (pin.at[1] - bestP[1]) * oy; // pixels, outward positive
  const X = [positions[best * 3], positions[best * 3 + 1], positions[best * 3 + 2]];
  const sc = scaleAt(cam, X);
  const dir = apply3(transpose3(cam.R), [ox, oy, 0]);
  return { v: best, to: [X[0] + (dir[0] * gap) / sc, X[1] + (dir[1] * gap) / sc, X[2] + (dir[2] * gap) / sc] };
}

// A pin on a curve of the head (the jaw line): the nearest point of the curve as the photo shows it, moved
// straight across the curve to the pin. Returns the nearer vertex of that stretch of curve.
function curveTarget(head, view, pin, positions) {
  const ids = CURVES[pin.curve];
  const cam = view.camera;
  const pts = ids.map((v) => project(cam, [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]));
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1e-9;
    const t = Math.max(0, Math.min(1, ((pin.at[0] - a[0]) * ab[0] + (pin.at[1] - a[1]) * ab[1]) / l2));
    const q = [a[0] + t * ab[0], a[1] + t * ab[1]];
    const d = Math.hypot(pin.at[0] - q[0], pin.at[1] - q[1]);
    if (!best || d < best.d) best = { d, i, t, q, ab, l: Math.sqrt(l2) };
  }
  const v = best.t < 0.5 ? ids[best.i] : ids[best.i + 1];
  const nrm = [-best.ab[1] / best.l, best.ab[0] / best.l];
  const gap = (pin.at[0] - best.q[0]) * nrm[0] + (pin.at[1] - best.q[1]) * nrm[1];
  const X = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const sc = scaleAt(cam, X);
  const dir = apply3(transpose3(cam.R), [nrm[0], nrm[1], 0]);
  return { v, to: [X[0] + (dir[0] * gap) / sc, X[1] + (dir[1] * gap) / sc, X[2] + (dir[2] * gap) / sc], gap };
}

// Back of the head, crown and neck: spread-out vertices the pins don't reach, kept in shape.
export function anchors(head) {
  if (head._anchors) return head._anchors;
  const P = head.positions;
  const pool = [];
  for (let v = 9409; v < head.skinVertexCount; v++) {
    const y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (z < -1.5 || y > 9 || y < -11) pool.push(v);
  }
  // Farthest-point sampling.
  const count = 28;
  const chosen = [pool[0]];
  const dist = new Float64Array(pool.length).fill(Infinity);
  while (chosen.length < count) {
    const c = chosen[chosen.length - 1];
    let far = 0, at = 0;
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i];
      const d = Math.hypot(P[v * 3] - P[c * 3], P[v * 3 + 1] - P[c * 3 + 1], P[v * 3 + 2] - P[c * 3 + 2]);
      if (d < dist[i]) dist[i] = d;
      if (dist[i] > far) {
        far = dist[i];
        at = v;
      }
    }
    chosen.push(at);
  }
  head._anchors = chosen;
  // With a side photo, the skull's outline is pinned there, so anchors on the profile's line give way.
  head._profileAnchors = new Set(chosen.filter((v) => Math.abs(P[v * 3]) < 2.5 && P[v * 3 + 1] > -12));
  return chosen;
}

// Expression weights by least squares on the pins an expression moves, linearised at the first bend.
function readExpression(head, view, bent, warp1, o) {
  const cam = view.camera;
  const L = warp1.linear;
  const names = EXPRESSIONS.filter((n) => head.expressions.has(n));
  // Delta of each expression at a pin's spot (mean over its vertices), as a map vertex -> delta.
  const lookup = names.map((n) => {
    const { index, delta } = head.expressions.get(n);
    const m = new Map();
    for (let i = 0; i < index.length; i++) m.set(index[i], [delta[i * 3], delta[i * 3 + 1], delta[i * 3 + 2]]);
    return m;
  });
  const rows = [], rhs = [];
  for (const p of view.pins) {
    if (p.outline || p.curve || (p.def.group !== "mouth" && p.def.group !== "lids")) continue;
    const ids = p.def.point(head, null);
    const X = pointOf(p.def, head, bent, null);
    const q = project(cam, X);
    const J = jacobian(cam, X);
    const sw = Math.sqrt(p.weight);
    const cols = lookup.map((m) => {
      const d = [0, 0, 0];
      for (const v of ids) {
        const e = m.get(v);
        if (e) for (let k = 0; k < 3; k++) d[k] += e[k] / ids.length;
      }
      const Ld = apply3(L, d);
      return [J[0] * Ld[0] + J[1] * Ld[1] + J[2] * Ld[2], J[3] * Ld[0] + J[4] * Ld[1] + J[5] * Ld[2]];
    });
    rows.push(cols.map((c) => sw * c[0]));
    rhs.push(sw * (p.at[0] - q[0]));
    rows.push(cols.map((c) => sw * c[1]));
    rhs.push(sw * (p.at[1] - q[1]));
  }
  if (!rows.length) return {};
  // Non-negative least squares by an active set: drop weights that come out below zero and solve again.
  let active = names.map((_, i) => i);
  let w = [];
  for (let it = 0; it < names.length; it++) {
    const k = active.length;
    const A = new Float64Array(rows.length * k);
    rows.forEach((r, i) => active.forEach((j, c) => (A[i * k + c] = r[j])));
    const x = leastSquares(A, rhs, rows.length, k, o.expressionRidge * Math.max(1, rows.length / 2) / 10);
    const neg = active.filter((_, c) => x[c] < 0);
    w = active.map((j, c) => [j, x[c]]);
    if (!neg.length) break;
    active = active.filter((j) => !neg.includes(j));
    if (!active.length) break;
  }
  const out = {};
  for (const [j, x] of w) if (x > 0.02) out[names[j]] = Math.min(1, x);
  const open = jawOpening(head, view, bent);
  if (open > 0.02) out.jawOpen = Math.min(1, open);
  return out;
}

// How open the jaw is, from the gap between the inner lip pins against the gap jawOpen makes in the template.
function jawOpening(head, view, bent) {
  const top = view.pins.find((p) => p.name === "lipUpperInner");
  const bottom = view.pins.find((p) => p.name === "lipLowerInner");
  if (!top || !bottom) return 0;
  const cam = view.camera;
  const a = pointOf(top.def, head, bent, null), b = pointOf(bottom.def, head, bent, null);
  const s = scaleAt(cam, a);
  const gap = Math.hypot(top.at[0] - bottom.at[0], top.at[1] - bottom.at[1]) / s; // cm in the photo
  const rest = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const open = posed(head, { jawOpen: 1 });
  const a1 = pointOf(top.def, head, open, null), b1 = pointOf(bottom.def, head, open, null);
  const full = Math.hypot(a1[0] - b1[0], a1[1] - b1[1], a1[2] - b1[2]) - rest;
  const extra = gap - rest - 0.15; // lips within 1.5 mm of the template's gap read as closed
  return extra > 0 ? extra / full : 0;
}

function jacobian(cam, X) {
  const h = 1e-3;
  const p0 = project(cam, X);
  const J = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const Y = X.slice();
    Y[k] += h;
    const p = project(cam, Y);
    J[k] = (p[0] - p0[0]) / h;
    J[3 + k] = (p[1] - p0[1]) / h;
  }
  return J;
}

// Eyeballs move as solid balls: the bend at their centre, and only the rotation and even scale of its linear part.
function keepEyesRound(head, from, warp, out) {
  const L = warp.linear;
  const scale = Math.cbrt(Math.abs(det3(L)));
  const R = nearestRotation(L).map((x) => x * scale);
  for (const pair of [["scleraL", "irisL"], ["scleraR", "irisR"]]) {
    const verts = new Set();
    for (const name of pair) for (const v of head.part(name).source) verts.add(v);
    const c = [0, 0, 0];
    for (const v of verts) for (let k = 0; k < 3; k++) c[k] += head.positions[v * 3 + k] / verts.size;
    const cFrom = c; // eyes don't move with the expressions used here
    const cTo = warp.at(cFrom);
    for (const v of verts) {
      const d = [from[v * 3] - cFrom[0], from[v * 3 + 1] - cFrom[1], from[v * 3 + 2] - cFrom[2]];
      const r = apply3(R, d);
      out[v * 3] = cTo[0] + r[0];
      out[v * 3 + 1] = cTo[1] + r[1];
      out[v * 3 + 2] = cTo[2] + r[2];
    }
  }
}

// How far each pin's spot ends up from the pin, in pixels.
function report(head, views, fitted) {
  const rows = [];
  for (const v of views) {
    for (const p of v.pins) {
      let q;
      if (p.curve) {
        const hit = curveTarget(head, v, p, fitted);
        rows.push({ view: v.kind, pin: p.name, pixels: Math.abs(hit.gap) });
        continue;
      }
      if (p.outline) {
        const hit = outlineTarget(head, v, p, fitted);
        if (!hit) continue;
        q = project(v.camera, [fitted[hit.v * 3], fitted[hit.v * 3 + 1], fitted[hit.v * 3 + 2]]);
        const gap = (p.at[0] - q[0]) * p.outline.out[0] + (p.at[1] - q[1]) * p.outline.out[1];
        rows.push({ view: v.kind, pin: p.name, pixels: Math.abs(gap) });
      } else {
        q = project(v.camera, pointOf(p.def, head, fitted, v.side));
        rows.push({ view: v.kind, pin: p.name, pixels: Math.hypot(q[0] - p.at[0], q[1] - p.at[1]) });
      }
    }
  }
  const mean = rows.reduce((a, r) => a + r.pixels, 0) / Math.max(rows.length, 1);
  return { pins: rows, meanPixels: mean };
}
