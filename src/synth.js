// Made-up faces: the template bent by a known amount, given a skin, lips, brows, eyes and short hair, posed by a
// known camera and drawn to an image. Because the true shape and the true pins are known, these measure the
// fit in millimetres, and they stand in for photos of real people in the samples and tests.

import { project } from "./camera.js";
import { posed, vertexNormals } from "./head.js";
import { hairShell } from "./hair.js";
import { CURVES, PINS, pointOf, regionFor } from "./pins.js";
import { rasterTriangle } from "./raster.js";

// A deterministic random number generator, so made-up heads come out the same every run.
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A smooth made-up identity: widths and heights by region, a longer or shorter chin, a fuller or flatter face,
// plus a few soft bumps. Applied to the neutral template in its own frame (cm).
export function madeUpShape(head, rand, amount = 1) {
  const r = () => (rand() * 2 - 1) * amount;
  const p = {
    width: 1 + 0.07 * r(), height: 1 + 0.05 * r(), depth: 1 + 0.05 * r(),
    jaw: 0.08 * r(), chin: 0.5 * r(), nose: 0.35 * r(), brow: 0.25 * r(), cheeks: 0.3 * r(),
  };
  const bumps = [];
  for (let i = 0; i < 5; i++) bumps.push({ at: [r() * 6, r() * 8, 6 + r() * 4], size: 2 + rand() * 2.5, push: [0.25 * r(), 0.25 * r(), 0.3 * r()] });
  const P = head.positions;
  const out = new Float32Array(P.length);
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let v = 0; v < head.vertexCount; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const front = smooth(2, 8, z); // how much this vertex is on the face
    const low = smooth(-1, -7, y); // the lower face
    x *= p.width * (1 + p.jaw * low);
    y = y * p.height - p.chin * smooth(-4, -8, y) * front;
    z = z * p.depth + p.nose * front * Math.exp(-((x * x) / 4 + ((y - 0) ** 2) / 9)) * smooth(9, 12.5, z)
      + p.brow * front * Math.exp(-((y - 6) ** 2) / 2) + p.cheeks * front * Math.exp(-((Math.abs(x) - 4) ** 2 + (y - 0.5) ** 2) / 5);
    for (const b of bumps) {
      const w = Math.exp(-((x - b.at[0]) ** 2 + (y - b.at[1]) ** 2 + (z - b.at[2]) ** 2) / (b.size * b.size));
      x += b.push[0] * w;
      y += b.push[1] * w;
      z += b.push[2] * w;
    }
    out[v * 3] = x;
    out[v * 3 + 1] = y;
    out[v * 3 + 2] = z;
  }
  return out;
}

// Every front pin where a photo of `positions` through `cam` puts it: spots, the jaw line, the ears.
export function truePins(head, positions, cam) {
  const pins = {};
  const at = (v) => project(cam, [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]).slice(0, 2);
  for (const p of PINS) if (p.point) pins[p.name] = project(cam, pointOf(p, head, positions)).slice(0, 2);
  const jaw = CURVES.jaw, last = jaw.length - 1;
  for (const [name, k] of Object.entries({ jawHighRight: 3, jawLowRight: 8, jawRight: 11, chinRight: 15 })) {
    pins[name] = at(jaw[k]);
    pins[name.replace("Right", "Left")] = at(jaw[last - k]);
  }
  for (const [side, region] of [["Right", "earRight"], ["Left", "earLeft"]]) {
    const pts = regionFor(head, region).map(at);
    const outer = side === "Right" ? (p, q) => p[0] < q[0] : (p, q) => p[0] > q[0];
    pins[`earOuter${side}`] = pts.reduce((a, p) => (outer(p, a) ? p : a));
    pins[`earTop${side}`] = pts.reduce((a, p) => (p[1] < a[1] ? p : a));
    pins[`earLobe${side}`] = pts.reduce((a, p) => (p[1] > a[1] ? p : a));
  }
  return pins;
}

// Colours for a made-up face, per skin vertex: a tone with soft mottling, redder lips, darker brows.
function skinColours(head, look) {
  const P = head.positions; // decided on the template, so the marks travel with the bend
  const mp = (k) => head.landmarks68[k];
  const pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const lipOutline = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map((k) => pt(mp(k)));
  const inside = (x, y, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    }
    return c;
  };
  const brows = [[17, 18, 19, 20, 21], [22, 23, 24, 25, 26]].map((ks) => ks.map((k) => pt(mp(k))));
  const nearLine = (q, line) => {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
      best = Math.min(best, Math.hypot(q[0] - a[0] - t * ab[0], q[1] - a[1] - t * ab[1]));
    }
    return best;
  };
  const c = new Float32Array(head.vertexCount * 3);
  for (let v = 0; v < head.vertexCount; v++) {
    const [x, y, z] = pt(v);
    const mottle = 1 + 0.035 * Math.sin(x * 3.1 + y * 1.7) * Math.sin(y * 2.3 - z * 1.3) + 0.02 * Math.sin(x * 11 + z * 7);
    let col = look.skin.map((k) => k * mottle);
    if (z > 9 && inside(x, y, lipOutline)) col = look.lips;
    for (const line of brows) {
      if (z > 7 && nearLine([x, y - 0.25], line) < 0.32) col = look.brows;
    }
    c.set(col, v * 3);
  }
  return c;
}

// Draws a made-up head to an RGBA image: { width, height, data }.
export function drawHead(head, positions, cam, width, height, look) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(look.backdrop, i * 4), (data[i * 4 + 3] = 255);
  const depth = new Float32Array(width * height).fill(Infinity);
  const N = vertexNormals(head, positions, ["skin", "mouth", "eyeSocketL", "eyeSocketR", "scleraL", "scleraR"]);
  const skin = skinColours(head, look);
  const light = normalise([0.35, 0.55, 0.75]); // model frame: from the upper right of the face
  const shade = (n) => 0.42 + 0.62 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
  const draw = (pos, normals, tris, colourAt) => {
    const Q = new Map();
    const q = (v) => {
      if (!Q.has(v)) Q.set(v, project(cam, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
      return Q.get(v);
    };
    for (const [a, b, c, info] of tris) {
      const A = q(a), B = q(b), C = q(c);
      // Facing the camera? (screen-space winding)
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (area >= 0) continue;
      rasterTriangle(A, B, C, width, height, (x, y, w0, w1, w2) => {
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const i = y * width + x;
        if (z >= depth[i]) return;
        depth[i] = z;
        const n = normalise([0, 1, 2].map((k) => w0 * normals[a * 3 + k] + w1 * normals[b * 3 + k] + w2 * normals[c * 3 + k]));
        const col = colourAt(info, w0, w1, w2);
        const s = shade(n);
        data[i * 4] = col[0] * s;
        data[i * 4 + 1] = col[1] * s;
        data[i * 4 + 2] = col[2] * s;
      });
    }
  };
  // Inside of the mouth and the eye sockets, then skin and eyes.
  for (const name of ["mouth", "eyeSocketL", "eyeSocketR", "skin", "scleraL", "scleraR"]) {
    const part = head.part(name);
    const tris = [];
    for (let t = 0; t < part.triangles.length; t += 3) {
      const r = [part.triangles[t], part.triangles[t + 1], part.triangles[t + 2]];
      tris.push([part.source[r[0]], part.source[r[1]], part.source[r[2]], r]);
    }
    const eye = name.startsWith("sclera");
    draw(positions, N, tris, (r, w0, w1, w2) => {
      if (name === "mouth") return [58, 30, 30];
      if (name.startsWith("eyeSocket")) return look.skin.map((k) => k * 0.8);
      if (!eye) {
        const vs = r.map((k) => part.source[k]);
        return [0, 1, 2].map((k) => w0 * skin[vs[0] * 3 + k] + w1 * skin[vs[1] * 3 + k] + w2 * skin[vs[2] * 3 + k]);
      }
      const u = w0 * part.uv[r[0] * 2] + w1 * part.uv[r[1] * 2] + w2 * part.uv[r[2] * 2];
      const v = w0 * part.uv[r[0] * 2 + 1] + w1 * part.uv[r[1] * 2 + 1] + w2 * part.uv[r[2] * 2 + 1];
      const d = Math.hypot(u - 0.5, v - 0.5);
      return d < 0.036 ? [12, 10, 10] : d < 0.108 ? look.iris : [235, 230, 224];
    });
  }
  // Short hair.
  if (look.hair) {
    const shell = hairShell(head, positions, "short");
    const n = shell.position.length / 3;
    const hn = new Float32Array(n * 3);
    for (let t = 0; t < shell.index.length; t += 3) {
      const [a, b, c] = [shell.index[t], shell.index[t + 1], shell.index[t + 2]];
      const P3 = (i) => [shell.position[i * 3], shell.position[i * 3 + 1], shell.position[i * 3 + 2]];
      const A = P3(a), B = P3(b), C = P3(c);
      const nn = cross(sub(B, A), sub(C, A));
      for (const i of [a, b, c]) for (let k = 0; k < 3; k++) hn[i * 3 + k] += nn[k];
    }
    const tris = [];
    for (let t = 0; t < shell.index.length; t += 3) {
      if (Math.min(shell.alpha[shell.index[t]], shell.alpha[shell.index[t + 1]], shell.alpha[shell.index[t + 2]]) < 0.5) continue;
      tris.push([shell.index[t], shell.index[t + 1], shell.index[t + 2], null]);
    }
    draw(shell.position, hn, tris, () => look.hair);
  }
  return { width, height, data };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Looks for made-up faces: skin, lips, brows, iris, hair, backdrop (sRGB 0-255).
export const LOOKS = [
  { skin: [222, 186, 160], lips: [176, 104, 100], brows: [92, 66, 48], iris: [86, 112, 128], hair: [70, 50, 36], backdrop: [214, 216, 218] },
  { skin: [150, 104, 78], lips: [120, 70, 66], brows: [44, 32, 26], iris: [64, 44, 30], hair: [26, 22, 20], backdrop: [208, 212, 214] },
  { skin: [232, 200, 172], lips: [190, 120, 112], brows: [120, 90, 60], iris: [96, 120, 80], hair: [150, 110, 64], backdrop: [218, 216, 212] },
  { skin: [96, 64, 48], lips: [84, 52, 48], brows: [30, 24, 20], iris: [44, 30, 22], hair: [20, 18, 16], backdrop: [210, 212, 216] },
];

// A complete made-up photo: { image, pins, truth: { neutral, posed, weights }, camera }.
export function madeUpPhoto(head, { seed = 1, size = 900, look = LOOKS[0], smile = 0, distance = 120, turn = 0.08, hair = true } = {}) {
  const rand = seeded(seed);
  const neutral = madeUpShape(head, rand);
  const weights = smile ? { mouthSmile_L: smile, mouthSmile_R: smile } : {};
  const pose = posed(head, weights, neutral);
  const yaw = (rand() * 2 - 1) * turn, pitch = (rand() * 2 - 1) * turn * 0.6, roll = (rand() * 2 - 1) * turn * 0.4;
  const R = rotationXYZ(pitch, yaw, roll);
  // Face about 40% of the frame: about 14 cm across at `distance`.
  const f = (0.4 * size * distance) / 14;
  const camera = { R, f, cx: size / 2, cy: size / 2 + 0.06 * size, T: [0, -1.5, distance], distance };
  const image = drawHead(head, pose, camera, size, size, { ...look, hair: hair ? look.hair : null });
  return { image, pins: truePins(head, pose, camera), truth: { neutral, posed: pose, weights }, camera };
}

function rotationXYZ(pitch, yaw, roll) {
  const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cz = Math.cos(roll), sz = Math.sin(roll);
  // Model frame (y up, face +z) seen from the front: camera x right, y down, z away. Then yaw, pitch, roll.
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const F = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  return mul(F, mul(Rz, mul(Rx, Ry)));
}
function mul(A, B) {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
}
