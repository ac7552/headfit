// Lays the photos onto the fitted head's skin texture.
// Every texel of the skin's UV layout is found on the head (a 3D spot and its normal), looked for in each photo
// (is it in front of everything else there, and how squarely does it face the camera), and given the photo's
// colour there. Spots no photo sees get the skin's own tone, blended in smoothly. Nothing is guessed by a model.

import { project, scaleAt } from "./camera.js";
import { vertexNormals } from "./head.js";
import { pointOf, PINS } from "./pins.js";
import { depthBuffer, rasterTriangle, sample } from "./raster.js";
import { apply3, solve, transpose3 } from "./linalg.js";

// The skin's UVs span two tiles: the face in u 0..1 and the back of the head in u 1..2. The texture holds both
// side by side, so u is halved.
export const ATLAS = { tiles: 2 };

export function bakeSkin(head, fit, images, { size = 1024, depthSlack = 0.2, neckDrop = 3.5, delight = true } = {}) {
  const W = size * ATLAS.tiles, H = size;
  const positions = fit.fitted;
  // Below the chin the photo shows clothes as often as skin: the neck fades to the skin's tone from the chin
  // down `neckDrop` cm (in the head's own frame, so a tilted head fades along its neck).
  const chinY = positions[head.landmarks68[8] * 3 + 1];
  const normals = vertexNormals(head, positions, ["skin"]);
  const views = fit.views.map((v, i) => {
    const cam = v.camera;
    const proj = (X) => project(cam, X);
    const { depth } = depthBuffer(head, positions, proj, images[i].width, images[i].height, ["skin"]);
    const Rt = transpose3(cam.R);
    const eye = Number.isFinite(cam.distance) ? apply3(Rt, cam.T.map((x) => -x)) : null;
    const toward = Number.isFinite(cam.distance) ? null : apply3(Rt, [0, 0, -1]);
    return { cam, proj, depth, eye, toward, image: images[i] };
  });

  // A plain backdrop shows through at the edges of the head (ears under hair, a pin slightly off). Its colour
  // is read from the photo's top corners and edges; texels that come out that colour are mostly ignored.
  for (const v of views) v.backdrop = backdropColour(v.image);

  const color = new Float32Array(W * H * 3);
  const weight = new Float32Array(W * H);
  const normal = new Float32Array(W * H * 3);
  const { source, uv, triangles } = head.part("skin");
  for (let t = 0; t < triangles.length; t += 3) {
    const r = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const tex = r.map((k) => [(uv[k * 2] / ATLAS.tiles) * W, (1 - uv[k * 2 + 1]) * H]);
    const vs = r.map((k) => source[k]);
    const X = vs.map((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    const N = vs.map((v) => [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]);
    rasterTriangle(tex[0], tex[1], tex[2], W, H, (x, y, b0, b1, b2) => {
      const P = [0, 1, 2].map((k) => b0 * X[0][k] + b1 * X[1][k] + b2 * X[2][k]);
      const n = [0, 1, 2].map((k) => b0 * N[0][k] + b1 * N[1][k] + b2 * N[2][k]);
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      let sum = [0, 0, 0], ws = 0;
      for (const v of views) {
        const q = v.proj(P);
        const px = Math.floor(q[0]), py = Math.floor(q[1]);
        if (px < 1 || py < 1 || px >= v.image.width - 1 || py >= v.image.height - 1) continue;
        const d = v.depth[py * v.image.width + px];
        if (q[2] > d + depthSlack) continue; // something else is in front of this spot in the photo
        let dir;
        if (v.eye) {
          dir = [v.eye[0] - P[0], v.eye[1] - P[1], v.eye[2] - P[2]];
          const l = Math.hypot(dir[0], dir[1], dir[2]);
          dir = dir.map((c) => c / l);
        } else dir = v.toward;
        const facing = (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) / nl;
        let w = smoothstep(0.2, 0.55, facing) * facing * facing;
        if (w <= 0) continue;
        const c = sample(v.image, q[0], q[1]);
        if (v.backdrop) {
          const d = Math.hypot(c[0] - v.backdrop[0], c[1] - v.backdrop[1], c[2] - v.backdrop[2]);
          w *= 0.03 + 0.97 * smoothstep(18, 40, d);
        }
        sum = [sum[0] + w * c[0], sum[1] + w * c[1], sum[2] + w * c[2]];
        ws += w;
      }
      if (ws <= 0) return;
      const neck = smoothstep(chinY - neckDrop, chinY - 1, P[1]);
      if (neck <= 0) return;
      const i = y * W + x;
      color[i * 3] = sum[0] / ws;
      color[i * 3 + 1] = sum[1] / ws;
      color[i * 3 + 2] = sum[2] / ws;
      normal[i * 3] = n[0] / nl;
      normal[i * 3 + 1] = n[1] / nl;
      normal[i * 3 + 2] = n[2] / nl;
      weight[i] = Math.min(1, ws / 0.35) * neck;
    });
  }

  const shading = delight ? removeShading(color, weight, normal, W * H) : null;
  const tone = skinTone(head, fit, images).map((x) => x / (shading ? shading.mean : 1));
  const filled = pullPush(color, weight, W, H);
  const near = boxBlur(weight, W, H, Math.round(size / 40));
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = weight[i];
    const m = Math.min(1, near[i] * 3);
    for (let k = 0; k < 3; k++) {
      const base = tone[k] * (1 - m) + filled[i * 3 + k] * m;
      data[i * 4 + k] = a * color[i * 3 + k] + (1 - a) * base;
    }
    data[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data, tone, iris: irisColour(head, fit, images[0]) };
}

// Takes the photo's lighting out of the texture, so the 3D view can light the head again without doubling it.
// Brightness is modelled as a + b.n over the skin's normals (a soft light from one side plus ambient: first-order
// spherical harmonics), fitted by least squares to the texels the photos saw, and divided out.
export function removeShading(color, weight, normal, count) {
  const A = new Float64Array(16), r = new Float64Array(4);
  let lumSum = 0, wSum = 0;
  for (let i = 0; i < count; i += 3) {
    const w = weight[i];
    if (w < 0.8) continue;
    const L = 0.299 * color[i * 3] + 0.587 * color[i * 3 + 1] + 0.114 * color[i * 3 + 2];
    const h = [1, normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]];
    for (let a = 0; a < 4; a++) {
      r[a] += h[a] * L;
      for (let b = 0; b < 4; b++) A[a * 4 + b] += h[a] * h[b];
    }
    lumSum += L;
    wSum += 1;
  }
  if (wSum < 100) return null;
  for (let a = 0; a < 4; a++) A[a * 4 + a] += 1e-3 * wSum;
  const c = solve(A, r, 4);
  const mean = lumSum / wSum;
  for (let i = 0; i < count; i++) {
    if (!weight[i]) continue;
    const s = (c[0] + c[1] * normal[i * 3] + c[2] * normal[i * 3 + 1] + c[3] * normal[i * 3 + 2]) / mean;
    const k = 1 / Math.max(0.45, Math.min(1.6, s));
    color[i * 3] *= k;
    color[i * 3 + 1] *= k;
    color[i * 3 + 2] *= k;
  }
  return { coefficients: Array.from(c), mean: (c[0] + c[3]) / mean }; // shading straight-on, for the tone
}

// The backdrop's colour, if the photo's top corners and upper edges agree on one; otherwise null.
export function backdropColour(image) {
  const { width: w, height: h } = image;
  const px = [];
  const strip = Math.max(4, Math.round(w * 0.04));
  for (let y = 0; y < h * 0.45; y += 3) {
    for (const x of [Math.floor(strip / 2), w - 1 - Math.floor(strip / 2)]) px.push(sample(image, x, y));
  }
  for (let x = 0; x < w; x += 3) px.push(sample(image, x, strip / 2));
  const med = [0, 1, 2].map((k) => px.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)]);
  const close = px.filter((c) => Math.hypot(c[0] - med[0], c[1] - med[1], c[2] - med[2]) < 25).length;
  return close > px.length * 0.6 ? med : null;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Median colour of small patches on the cheeks and forehead of the front photo.
export function skinTone(head, fit, images) {
  const P = fit.fitted;
  const mp = (k) => {
    const v = head.landmarks68[k];
    return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  };
  const mix = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
  const spots = [mix(mp(31), mp(2), 0.45), mix(mp(35), mp(14), 0.45), mix(mp(27), mp(27), 0).map((x, k) => (k === 1 ? x + 2.2 : x))];
  const view = fit.views.findIndex((v) => v.kind !== "side");
  const cam = fit.views[view].camera, img = images[view];
  const px = [];
  for (const X of spots) {
    const q = project(cam, X);
    const r = Math.max(2, Math.round(0.4 * scaleAt(cam, X)));
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) px.push(sample(img, q[0] + dx, q[1] + dy));
  }
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const mid = px.slice(Math.floor(px.length * 0.3), Math.ceil(px.length * 0.7));
  return [0, 1, 2].map((k) => mid.reduce((s, c) => s + c[k], 0) / mid.length);
}

// The iris: darker half of a small disc at the middle of each eye.
function irisColour(head, fit, image) {
  const view = fit.views.find((v) => v.kind !== "side");
  const cam = view.camera;
  const P = fit.fitted;
  const px = [];
  for (const [a, b] of [["eyeOuterRight", "eyeInnerRight"], ["eyeInnerLeft", "eyeOuterLeft"]]) {
    const A = pointOf(PINS.find((p) => p.name === a), head, P), B = pointOf(PINS.find((p) => p.name === b), head, P);
    const X = A.map((x, k) => (x + B[k]) / 2);
    const q = project(cam, X);
    const r = Math.max(2, 0.3 * scaleAt(cam, X));
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) if (dx * dx + dy * dy <= r * r) px.push(sample(image, q[0] + dx, q[1] + dy));
  }
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const dark = px.slice(Math.floor(px.length * 0.1), Math.ceil(px.length * 0.5));
  return [0, 1, 2].map((k) => dark.reduce((s, c) => s + c[k], 0) / Math.max(dark.length, 1));
}

// Pull-push hole filling: average down a pyramid by weight, then fill each level's gaps from the level above.
export function pullPush(color, weight, W, H) {
  const levels = [{ c: color, w: weight, W, H }];
  while (levels[levels.length - 1].W > 4 && levels[levels.length - 1].H > 4) {
    const p = levels[levels.length - 1];
    const w2 = Math.ceil(p.W / 2), h2 = Math.ceil(p.H / 2);
    const c = new Float32Array(w2 * h2 * 3), w = new Float32Array(w2 * h2);
    for (let y = 0; y < p.H; y++) {
      for (let x = 0; x < p.W; x++) {
        const i = y * p.W + x, j = (y >> 1) * w2 + (x >> 1);
        const a = p.w[i];
        if (!a) continue;
        w[j] += a;
        c[j * 3] += a * p.c[i * 3];
        c[j * 3 + 1] += a * p.c[i * 3 + 1];
        c[j * 3 + 2] += a * p.c[i * 3 + 2];
      }
    }
    for (let j = 0; j < w2 * h2; j++) {
      if (w[j] > 0) {
        c[j * 3] /= w[j];
        c[j * 3 + 1] /= w[j];
        c[j * 3 + 2] /= w[j];
        w[j] = Math.min(1, w[j]);
      }
    }
    levels.push({ c, w, W: w2, H: h2 });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l], q = levels[l + 1];
    const out = new Float32Array(p.c.length);
    for (let y = 0; y < p.H; y++) {
      for (let x = 0; x < p.W; x++) {
        const i = y * p.W + x, j = (y >> 1) * q.W + (x >> 1);
        const a = p.w[i];
        for (let k = 0; k < 3; k++) out[i * 3 + k] = a * p.c[i * 3 + k] + (1 - a) * q.c[j * 3 + k];
      }
    }
    p.c = out;
    p.w = new Float32Array(p.W * p.H).fill(1);
  }
  return levels[0].c;
}

// Separable box blur of a single-channel image.
export function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / n;
      s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
