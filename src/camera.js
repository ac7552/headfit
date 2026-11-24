// Cameras for one photo each. A camera maps a model point X (cm, head frame) to a pixel:
//   C = R X + T          camera frame: x right, y down the photo, z away from the camera
//   p = f * C.xy / C.z + centre
// With distance = Infinity it is a scaled orthographic camera: p = s * C.xy + centre + t.
// Nothing here is learned: the pose comes from the pins by least squares.

import { apply3, leastSquares, mul3, nearestRotation, rotation, transpose3 } from "./linalg.js";

// Model frame (y up, face toward +z) to a camera looking at the face from the front (y down, z into the photo).
const FRONT = [1, 0, 0, 0, -1, 0, 0, 0, -1];

export function project(cam, X) {
  const C = apply3(cam.R, X);
  if (!Number.isFinite(cam.distance)) return [cam.s * C[0] + cam.t[0], cam.s * C[1] + cam.t[1], C[2]];
  const z = C[2] + cam.T[2];
  return [cam.f * (C[0] + cam.T[0]) / z + cam.cx, cam.f * (C[1] + cam.T[1]) / z + cam.cy, z];
}

// The model-space ray through a pixel: { origin, direction } with direction unit length.
export function ray(cam, p) {
  const Rt = transpose3(cam.R);
  if (!Number.isFinite(cam.distance)) {
    const C = [(p[0] - cam.t[0]) / cam.s, (p[1] - cam.t[1]) / cam.s, 0];
    return { origin: apply3(Rt, C), direction: apply3(Rt, [0, 0, 1]) };
  }
  const d = [(p[0] - cam.cx) / cam.f, (p[1] - cam.cy) / cam.f, 1];
  const l = Math.hypot(...d);
  const origin = apply3(Rt, [-cam.T[0], -cam.T[1], -cam.T[2]]);
  return { origin, direction: apply3(Rt, d.map((x) => x / l)) };
}

// Pixels per cm at a model point, along the photo's x and y: the local scale of the camera.
export function scaleAt(cam, X) {
  if (!Number.isFinite(cam.distance)) return cam.s;
  const C = apply3(cam.R, X);
  return cam.f / (C[2] + cam.T[2]);
}

// Scaled orthographic fit (affine, then the nearest rotation, then a few Gauss-Newton steps).
// points: model points [[x,y,z]...], pixels: [[u,v]...], weights optional. base: a rotation the photo is close to.
export function fitOrthographic(points, pixels, { weights = null, base = FRONT } = {}) {
  const n = points.length;
  const w = weights || new Array(n).fill(1);
  let W = 0;
  const mx = [0, 0, 0], mp = [0, 0];
  for (let i = 0; i < n; i++) {
    W += w[i];
    for (let k = 0; k < 3; k++) mx[k] += w[i] * points[i][k];
    for (let k = 0; k < 2; k++) mp[k] += w[i] * pixels[i][k];
  }
  mx.forEach((_, k) => (mx[k] /= W));
  mp.forEach((_, k) => (mp[k] /= W));
  // Affine rows: p - mp = M (X - mx), solved per photo axis, with a little pull toward the base rotation so a
  // flat set of pins (all near one plane) still gives a sensible depth axis.
  const A = new Float64Array(n * 3), b0 = new Float64Array(n), b1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sqrt(w[i]);
    for (let k = 0; k < 3; k++) A[i * 3 + k] = s * (points[i][k] - mx[k]);
    b0[i] = s * (pixels[i][0] - mp[0]);
    b1[i] = s * (pixels[i][1] - mp[1]);
  }
  let spread = 0;
  for (let i = 0; i < n; i++) spread += w[i] * ((points[i][0] - mx[0]) ** 2 + (points[i][1] - mx[1]) ** 2);
  const rough = Math.sqrt(
    (b0.reduce((a, x) => a + x * x, 0) + b1.reduce((a, x) => a + x * x, 0)) / Math.max(spread, 1e-9),
  );
  const ridge = 1e-3 * spread;
  const r0 = leastSquares(A, b0, n, 3, ridge, base.slice(0, 3).map((x) => x * rough));
  const r1 = leastSquares(A, b1, n, 3, ridge, base.slice(3, 6).map((x) => x * rough));
  const s = (Math.hypot(...r0) + Math.hypot(...r1)) / 2;
  const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
  const l2 = Math.hypot(...r2) || 1;
  let R = nearestRotation([...r0.map((x) => x / s), ...r1.map((x) => x / s), ...r2.map((x) => (x / l2))]);
  let cam = { R, s, t: [0, 0], distance: Infinity };
  const Cm = apply3(R, mx);
  cam.t = [mp[0] - s * Cm[0], mp[1] - s * Cm[1]];
  return refine(cam, points, pixels, w);
}

// Gauss-Newton on rotation (small-angle update), scale or distance, and translation. Numeric Jacobian: tiny problem.
export function refineCamera(cam, points, pixels, weights = null) {
  return refine(cam, points, pixels, weights || new Array(points.length).fill(1));
}

function refine(cam, points, pixels, w, steps = 12) {
  const persp = Number.isFinite(cam.distance);
  const pack = (c) => (persp ? [0, 0, 0, c.T[0], c.T[1], c.T[2]] : [0, 0, 0, c.s, c.t[0], c.t[1]]);
  const unpack = (c, q) => {
    const R = mul3(rotation([q[0], q[1], q[2]]), c.R);
    return persp
      ? { ...c, R, T: [q[3], q[4], q[5]] }
      : { ...c, R, s: q[3], t: [q[4], q[5]] };
  };
  const residual = (c) => {
    const r = [];
    for (let i = 0; i < points.length; i++) {
      const p = project(c, points[i]);
      const sw = Math.sqrt(w[i]);
      r.push(sw * (p[0] - pixels[i][0]), sw * (p[1] - pixels[i][1]));
    }
    return r;
  };
  for (let it = 0; it < steps; it++) {
    const q0 = pack(cam);
    const r0 = residual(cam);
    const m = r0.length, k = q0.length;
    const J = new Float64Array(m * k);
    for (let j = 0; j < k; j++) {
      const h = j < 3 ? 1e-5 : 1e-4 * Math.max(1, Math.abs(q0[j]));
      const q = q0.slice();
      q[j] += h;
      const r = residual(unpack(cam, q));
      for (let i = 0; i < m; i++) J[i * k + j] = (r[i] - r0[i]) / h;
    }
    const step = leastSquares(J, r0.map((x) => -x), m, k, 1e-9);
    const q = q0.map((x, j) => x + step[j]);
    const next = unpack(cam, q);
    const before = r0.reduce((a, x) => a + x * x, 0);
    const after = residual(next).reduce((a, x) => a + x * x, 0);
    if (!(after < before)) break;
    cam = next;
    if (before - after < 1e-10 * before) break;
  }
  return cam;
}

// A pinhole camera at roughly `distance` cm from the face, starting from the orthographic fit.
export function fitPerspective(points, pixels, { distance, width, height, weights = null, base = FRONT } = {}) {
  const ortho = fitOrthographic(points, pixels, { weights, base });
  if (!Number.isFinite(distance)) return ortho;
  // Orthographic scale s (px/cm) at the face's middle depth; a pinhole at distance D with f = s * D matches it there.
  const f = ortho.s * distance;
  const cx = width / 2, cy = height / 2;
  const n = points.length;
  const mx = [0, 0, 0];
  for (const P of points) for (let k = 0; k < 3; k++) mx[k] += P[k] / n;
  const C = apply3(ortho.R, mx);
  const centre = [ortho.s * C[0] + ortho.t[0], ortho.s * C[1] + ortho.t[1]];
  const T = [(centre[0] - cx) * distance / f - C[0], (centre[1] - cy) * distance / f - C[1], distance - C[2]];
  const cam = { R: ortho.R, f, cx, cy, T, distance };
  return refine(cam, points, pixels, weights || new Array(n).fill(1));
}

export const FRONT_ROTATION = FRONT;
// A side photo. facing "left": the nose points to the photo's left, so the photo shows the person's left side.
export function sideRotation(facing) {
  const a = facing === "left" ? -Math.PI / 2 : Math.PI / 2;
  const Ry = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  return mul3(FRONT, Ry);
}
