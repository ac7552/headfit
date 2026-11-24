// Made-up faces: the template bent by a known amount, painted with a procedural skin (pores, blush, freckles,
// stubble, brows, lips), lit like a studio portrait (a key light with soft shadows, fill, rim, skin sheen), with
// detailed eyes and strand-textured short hair, and drawn to an image with a little camera grain.
// Nobody is pictured: every face comes from a seed. Because the true shape and the true pins are known, these
// measure the fit in millimetres, and they stand in for photos in the samples and tests.

import { project } from "./camera.js";
import { posed, vertexNormals } from "./head.js";
import { hairShell } from "./hair.js";
import { CURVES, PINS, pointOf, regionFor } from "./pins.js";
import { rasterTriangle } from "./raster.js";

// ---------------------------------------------------------------- randomness and noise

// A deterministic random number generator, so made-up heads come out the same every run.
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// Value noise in 3D, 0..1.
function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const at = (a, b, c) => hash3(xi + a, yi + b, zi + c, s);
  const x00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * u, x10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * u;
  const x01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * u, x11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm(x, y, z, s, octaves = 4) {
  let a = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    a += amp * noise3(x * f, y * f, z * f, s + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return a / norm;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (x) => {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, Math.max(0, v)));
};
const lin3 = (c) => c.map(toLinear);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sqDist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------- shape and pins

// A smooth made-up identity: widths and heights by region, a longer or shorter chin, a fuller or flatter face,
// a wider or narrower nose, fuller or thinner lips, plus a few soft bumps. Applied to the neutral template in
// its own frame (cm).
export function madeUpShape(head, rand, amount = 1) {
  const r = () => (rand() * 2 - 1) * amount;
  const p = {
    width: 1 + 0.07 * r(), height: 1 + 0.05 * r(), depth: 1 + 0.05 * r(),
    jaw: 0.08 * r(), chin: 0.5 * r(), nose: 0.35 * r(), noseWidth: 0.12 * r(), lips: 0.15 * r(),
    brow: 0.25 * r(), cheeks: 0.3 * r(),
  };
  const bumps = [];
  for (let i = 0; i < 5; i++) bumps.push({ at: [r() * 6, r() * 8, 6 + r() * 4], size: 2 + rand() * 2.5, push: [0.25 * r(), 0.25 * r(), 0.3 * r()] });
  const P = head.positions;
  const out = new Float32Array(P.length);
  for (let v = 0; v < head.vertexCount; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const front = smooth(2, 8, z);
    const low = smooth(-1, -7, y);
    const nose = Math.exp(-((x * x) / 4 + (y * y) / 9)) * smooth(9, 12.5, z);
    x *= p.width * (1 + p.jaw * low) * (1 + p.noseWidth * Math.exp(-(x * x) / 3 - ((y + 0.6) ** 2) / 1.5) * smooth(9, 11, z));
    y = y * p.height - p.chin * smooth(-4, -8, y) * front;
    z = z * p.depth + p.nose * front * nose
      + p.lips * Math.exp(-(x * x) / 4 - ((y + 3.4) ** 2) / 0.8) * smooth(10, 11.5, z)
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

// ---------------------------------------------------------------- the painted skin

// Paints the skin's UV layout (both tiles side by side, as bake.js lays them out) from the template's own frame,
// so every mark travels with the bend. Returns linear RGB plus a sheen mask (oilier T-zone), 4 floats a texel.
export function paintSkin(head, look, { size = 1024, seed = 1 } = {}) {
  const W = size * 2, H = size;
  const tex = new Float32Array(W * H * 4);
  const filled = new Uint8Array(W * H);
  const P = head.positions;
  const pt = (k) => {
    const v = head.landmarks68[k];
    return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  };
  const ctx = {
    seed,
    lipOuter: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map(pt),
    lipInner: [60, 61, 62, 63, 64, 65, 66, 67, 60].map(pt),
    brows: [[21, 20, 19, 18, 17], [22, 23, 24, 25, 26]].map((ks) => ks.map((k) => {
      const q = pt(k);
      return [q[0], q[1] + 0.12, q[2]];
    })),
    eyes: [[36, 39], [42, 45]].map(([a, b]) => mix(pt(a), pt(b), 0.5)),
    noseTip: pt(30),
    noseBottomY: pt(33)[1],
    chinY: pt(8)[1],
    moles: Array.from({ length: look.moles ?? 2 }, (_, i) => {
      const r = seeded(seed * 31 + i);
      return [(r() * 2 - 1) * 5, (r() * 2 - 1) * 6, 0, 0.05 + 0.05 * r()];
    }),
  };
  const { source, uv, triangles } = head.part("skin");
  for (let t = 0; t < triangles.length; t += 3) {
    const r = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const T = r.map((k) => [(uv[k * 2] / 2) * W, (1 - uv[k * 2 + 1]) * H]);
    const X = r.map((k) => {
      const v = source[k];
      return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    });
    rasterTriangle(T[0], T[1], T[2], W, H, (x, y, b0, b1, b2) => {
      const q = [0, 1, 2].map((k) => b0 * X[0][k] + b1 * X[1][k] + b2 * X[2][k]);
      const [c, sheen] = skinAt(q, look, ctx);
      const i = y * W + x;
      tex[i * 4] = c[0];
      tex[i * 4 + 1] = c[1];
      tex[i * 4 + 2] = c[2];
      tex[i * 4 + 3] = sheen;
      filled[i] = 1;
    });
  }
  // Grow the painted islands a few texels so sampling at their edges never reads an unpainted texel.
  for (let pass = 0; pass < 4; pass++) {
    const add = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (filled[i]) continue;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (filled[j]) {
            add.push([i, j]);
            break;
          }
        }
      }
    }
    for (const [i, j] of add) {
      for (let k = 0; k < 4; k++) tex[i * 4 + k] = tex[j * 4 + k];
      filled[i] = 1;
    }
  }
  return { width: W, height: H, data: tex };
}

function insidePoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
  }
  return c;
}

// Distance (xy) to a polyline, with the arc length along it and which side: { d, s, side, length }.
function alongLine(x, y, line) {
  let best = { d: Infinity }, run = 0, total = 0;
  for (let i = 0; i + 1 < line.length; i++) total += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(ab[0], ab[1]) || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1]) / (l * l)));
    const qx = a[0] + t * ab[0], qy = a[1] + t * ab[1];
    const d = Math.hypot(x - qx, y - qy);
    if (d < best.d) best = { d, s: run + t * l, side: Math.sign(ab[0] * (y - a[1]) - ab[1] * (x - a[0])) };
    run += l;
  }
  best.length = total;
  return best;
}

function skinAt(q, look, ctx) {
  const [x, y, z] = q;
  const s = ctx.seed;
  const ax = Math.abs(x);
  const front = smooth(3, 7.5, z);
  let c = look.skin.slice();

  // Broad unevenness and fine pores (pores show most on the nose and cheeks).
  const mottle = fbm(x * 0.45, y * 0.45, z * 0.45, s, 4) - 0.5;
  c = c.map((k) => k * (1 + 0.1 * mottle));
  const poreZone = 0.5 + 0.5 * smooth(2.5, 0, Math.hypot(ax - 2.4, y - 0.3) - 1.5) * front;
  const pore = noise3(x * 38, y * 38, z * 38, s + 1);
  c = c.map((k) => k * (1 - 0.055 * poreZone * smooth(0.55, 0.85, pore)));
  const fine = noise3(x * 90, y * 90, z * 90, s + 2) - 0.5;
  c = c.map((k) => k * (1 + 0.025 * fine));

  // Colour by region: rosier cheeks, nose and ears; a touch of shadow under the eyes and in the lid creases.
  const cheeks = Math.exp(-(((ax - 3.9) ** 2) / 3.2 + ((y - 0.1) ** 2) / 2.6)) * front;
  const noseRed = Math.exp(-sqDist(q, ctx.noseTip) / 1.4);
  const ears = smooth(6.0, 7.2, ax) * smooth(-4.5, -2.5, y) * smooth(5, 3.5, y);
  const chinRed = Math.exp(-(x * x) / 3 - ((y - ctx.chinY - 0.8) ** 2) / 1.2) * front;
  c = mix(c, look.blush, Math.min(0.75, (look.flush ?? 0.5) * (0.75 * cheeks + 0.65 * noseRed + 0.55 * ears + 0.3 * chinRed)));
  for (const e of ctx.eyes) {
    const ex = x - e[0], ey = y - e[1];
    const under = Math.exp(-(ex * ex) / 1.6 - ((ey + 0.95) ** 2) / 0.16) * front;
    const crease = Math.exp(-(ex * ex) / 1.4 - ((ey - 0.85) ** 2) / 0.05) * front;
    c = mix(c, look.underEye, 0.35 * under + 0.3 * crease);
  }
  const forehead = smooth(6, 9, y) * front;
  c = c.map((k) => k * (1 + 0.03 * forehead));

  // Freckles: scattered dots, thickest over the nose and cheeks.
  if (look.freckles) {
    const zone = Math.exp(-(x * x) / 14 - ((y - 0.8) ** 2) / 6) * front;
    const cell = 0.16;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
    const limit = look.freckles * zone * 0.55;
    let f = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const h = hash3(gx + dx, gy + dy, gz + dz, s + 9);
      if (h > limit) continue;
      const cx = (gx + dx + hash3(gx + dx, gy + dy, gz + dz, s + 10)) * cell;
      const cy = (gy + dy + hash3(gx + dx, gy + dy, gz + dz, s + 11)) * cell;
      const cz = (gz + dz + hash3(gx + dx, gy + dy, gz + dz, s + 12)) * cell;
      const rr = 0.025 + 0.035 * hash3(gx + dx, gy + dy, gz + dz, s + 13);
      f = Math.max(f, smooth(rr, rr * 0.4, Math.hypot(x - cx, y - cy, z - cz)) * (0.4 + 0.6 * (h / Math.max(1e-6, limit))));
    }
    c = mix(c, look.freckleColour || [160, 100, 70], 0.55 * f);
  }
  // A mole or two.
  if (front > 0.5) {
    for (const m of ctx.moles) c = mix(c, [95, 62, 48], smooth(m[3], m[3] * 0.5, Math.hypot(x - m[0], y - m[1])) * 0.85);
  }

  // Stubble: a faint shadow and dense dots where a beard grows.
  if (look.stubble) {
    // The beard line runs from under the nose, down past the mouth, and back up the jaw to the sideburns.
    const ragged = 0.35 * (noise3(x * 2.5, y * 2.5, z * 2.5, s + 21) - 0.5);
    const cheekLine = ax < 1.2 ? ctx.noseBottomY - 0.2 : ctx.noseBottomY - 0.2 - (ax - 1.2) * 0.55 + smooth(3.8, 6, ax) * (ax - 3.8) * 1.6;
    const top = Math.min(cheekLine, 3.0) + ragged;
    const beard = smooth(top + 0.15, top - 0.6, y) * smooth(ctx.chinY - 3.8, ctx.chinY - 2.2, y) * smooth(-1.5, 0.5, z)
      * (1 - smooth(6.1, 6.6, ax) * smooth(-2.8, -1.5, y));
    if (beard > 0) {
      const cell = 0.045;
      const h = hash3(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell), s + 20);
      const dot = h < 0.35 ? 0.55 * (h / 0.35) + 0.2 : 0;
      c = mix(c, look.stubbleColour || [42, 34, 30], beard * look.stubble * (0.16 + dot));
    }
  }

  // Lips: soft edge, darker toward the line between them, fine vertical lines.
  const lip = insidePoly(x, y, ctx.lipOuter) && z > 9 ? 1 : 0;
  const edge = alongLine(x, y, [...ctx.lipOuter, ctx.lipOuter[0]]).d;
  const lipW = lip ? smooth(0, 0.08, edge) : smooth(0.06, 0, edge) * (z > 9 ? 0.6 : 0);
  if (lipW > 0) {
    const toLine = alongLine(x, y, ctx.lipInner).d;
    let lc = mix(look.lips, look.lips.map((k) => k * 0.62), smooth(0.25, 0, toLine));
    const lines = 1 - 0.08 * Math.abs(Math.sin(x * 42 + 4 * noise3(x * 3, y * 9, 0, s + 3))) ** 3;
    lc = lc.map((k) => k * lines * (1 + 0.05 * (noise3(x * 20, y * 20, z * 20, s + 4) - 0.5)));
    c = mix(c, lc, lipW);
  }

  // Brows: a band thicker at the inner end, made of short strands slanting outward and up.
  if (z > 7) {
    for (const line of ctx.brows) {
      const b = alongLine(x, y, line);
      if (b.d > 0.7) continue;
      const t = b.s / b.length;
      const w = 0.4 * (1 - t) + 0.17 * t;
      const body = smooth(w, w * 0.45, b.d) * smooth(-0.05, 0.06, t) * smooth(1.08, 0.95, t);
      if (body <= 0) continue;
      const ang = 0.35;
      const across = b.d * b.side * Math.cos(ang) - b.s * Math.sin(ang);
      const along = b.s * Math.cos(ang) + b.d * b.side * Math.sin(ang);
      const strands = noise3(along * 4, across * 60, 0, s + 5) * 0.7 + noise3(along * 9, across * 120, 0, s + 6) * 0.3;
      const dens = Math.min(1, body * (0.35 + 1.1 * smooth(0.35, 0.75, strands)));
      c = mix(c, look.brows, 0.92 * dens);
    }
  }

  // A shirt over the shoulders, with a ribbed crew neck.
  const neckline = z > 0 ? -13.7 + 0.02 * x * x : -12.4;
  if (look.shirt) {
    const shirt = smooth(neckline + 0.08, neckline - 0.08, y);
    if (shirt > 0) {
      const rib = Math.abs(y - (neckline - 0.55)) < 0.55 ? 0.9 + 0.1 * Math.abs(Math.sin(x * 22)) : 1;
      const knit = 1 + 0.06 * (noise3(x * 25, y * 25, z * 25, s + 7) - 0.5);
      c = mix(c, look.shirt.map((k) => k * rib * knit), shirt);
    }
  }

  // Sheen: oilier on the forehead, nose and chin; none on the shirt.
  const tzone = Math.max(Math.exp(-(x * x) / 8 - ((y - 7) ** 2) / 6), noseRed, chinRed) * front;
  const onSkin = look.shirt ? smooth(neckline - 0.1, neckline + 0.1, y) : 1;
  return [lin3(c), (0.35 + 0.65 * tzone) * onSkin];
}

// The iris and the white of the eye, from the eyeball's UVs (front of the eye at 0.5, 0.5; 0.108 per 5.9 mm).
function eyeAt(u, v, look, s) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  if (r < 0.034) return [0.004, 0.004, 0.005];
  const R = 0.108;
  if (r < R) {
    const t = (r - 0.034) / (R - 0.034);
    const iris = lin3(look.iris);
    const fibres = 0.75 + 0.5 * noise3(Math.cos(a) * 9, Math.sin(a) * 9, t * 2, s + 30) * noise3(Math.cos(a) * 30, Math.sin(a) * 30, t * 4, s + 31);
    const collarette = 1 + 0.35 * Math.exp(-((t - 0.32) ** 2) / 0.006);
    const limbal = 1 - 0.75 * smooth(0.78, 1, t);
    const inner = 1 - 0.3 * smooth(0.15, 0, t);
    return iris.map((k) => k * fibres * collarette * limbal * inner);
  }
  // Sclera: off-white, pinker toward the corners, a few faint vessels.
  const base = lin3([232, 226, 218]);
  const veins = smooth(0.62, 0.7, noise3(Math.cos(a) * 6, Math.sin(a) * 6, r * 14, s + 32)) * smooth(0.16, 0.3, r);
  const pink = smooth(0.14, 0.3, r) * 0.25;
  return mix(mix(base, lin3([226, 170, 160]), pink), lin3([190, 70, 70]), 0.35 * veins);
}

// ---------------------------------------------------------------- lighting and drawing

const LIGHTS = {
  key: { dir: normalise([-0.5, 0.42, 0.75]), colour: [1.0, 0.95, 0.88], power: 1.25 },
  fill: { dir: normalise([0.8, 0.05, 0.6]), colour: [0.85, 0.9, 1.0], power: 0.38 },
  rim: { dir: normalise([0.45, 0.55, -0.7]), colour: [1, 1, 1], power: 0.8 },
};

// How tucked-in each skin vertex is (eye sockets, under the nose, ear folds), from how far it sits below its
// smoothed surroundings: 1 open, down to about 0.5 deep in a fold.
function occlusion(head, positions, normals) {
  const n = head.vertexCount;
  const nbr = Array.from({ length: n }, () => new Set());
  const { source, triangles } = head.part("skin");
  for (let t = 0; t < triangles.length; t += 3) {
    const a = source[triangles[t]], b = source[triangles[t + 1]], c = source[triangles[t + 2]];
    nbr[a].add(b).add(c);
    nbr[b].add(a).add(c);
    nbr[c].add(a).add(b);
  }
  let p = Float32Array.from(positions);
  for (let it = 0; it < 10; it++) {
    const q = new Float32Array(p.length);
    for (let v = 0; v < n; v++) {
      const set = nbr[v];
      if (!set.size) {
        q.set(p.subarray(v * 3, v * 3 + 3), v * 3);
        continue;
      }
      for (const u of set) for (let k = 0; k < 3; k++) q[v * 3 + k] += p[u * 3 + k] / set.size;
    }
    p = q;
  }
  const ao = new Float32Array(n).fill(1);
  for (let v = 0; v < n; v++) {
    if (!nbr[v].size) continue;
    const d = [p[v * 3] - positions[v * 3], p[v * 3 + 1] - positions[v * 3 + 1], p[v * 3 + 2] - positions[v * 3 + 2]];
    const depth = d[0] * normals[v * 3] + d[1] * normals[v * 3 + 1] + d[2] * normals[v * 3 + 2];
    ao[v] = 1 - Math.min(0.5, Math.max(0, depth) * 1.6);
  }
  return ao;
}

// A depth map of the head as the key light sees it, for soft shadows. Returns X => fraction lit (0..1).
function shadowMap(head, positions, dir, size = 1024) {
  const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const U = normalise(cross(up, dir)), V = cross(dir, U);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let v = 0; v < head.skinVertexCount; v++) {
    const X = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const u = dot3(X, U), w = dot3(X, V);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, w);
    maxV = Math.max(maxV, w);
  }
  const scale = size / (Math.max(maxU - minU, maxV - minV) * 1.04);
  const S = size + 4;
  const toMap = (X) => [(dot3(X, U) - minU) * scale + 2, (dot3(X, V) - minV) * scale + 2, dot3(X, dir)];
  const n = head.vertexCount;
  const L = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) L.set(toMap([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]), v * 3);
  const depth = new Float32Array(S * S).fill(-Infinity);
  const { source, triangles } = head.part("skin");
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = [source[triangles[t]], source[triangles[t + 1]], source[triangles[t + 2]]];
    const A = [L[ids[0] * 3], L[ids[0] * 3 + 1]], B = [L[ids[1] * 3], L[ids[1] * 3 + 1]], C = [L[ids[2] * 3], L[ids[2] * 3 + 1]];
    rasterTriangle(A, B, C, S, S, (x, y, w0, w1, w2) => {
      const d = w0 * L[ids[0] * 3 + 2] + w1 * L[ids[1] * 3 + 2] + w2 * L[ids[2] * 3 + 2];
      const i = y * S + x;
      if (d > depth[i]) depth[i] = d;
    });
  }
  const bias = 0.12 + 2 / scale;
  return (X) => {
    const [mx, my, d] = toMap(X);
    let lit = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ix = Math.round(mx + dx * 1.2), iy = Math.round(my + dy * 1.2);
        const occ = ix >= 0 && iy >= 0 && ix < S && iy < S ? depth[iy * S + ix] : -Infinity;
        if (!(occ > d + bias)) lit++;
      }
    }
    return lit / 25;
  };
}

// Draws a made-up head to an RGBA image: { width, height, data }.
export function drawHead(head, positions, cam, width, height, look, { aa = 2, skin = null, seed = 1 } = {}) {
  const W = width * aa, H = height * aa;
  const c = { ...cam, f: cam.f * aa, cx: cam.cx * aa, cy: cam.cy * aa };
  const Rt = [c.R[0], c.R[3], c.R[6], c.R[1], c.R[4], c.R[7], c.R[2], c.R[5], c.R[8]];
  const eye = [0, 1, 2].map((k) => -(Rt[k * 3] * c.T[0] + Rt[k * 3 + 1] * c.T[1] + Rt[k * 3 + 2] * c.T[2]));
  const rgb = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  // Backdrop: a soft vertical gradient with a light vignette.
  const back = lin3(look.backdrop);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const vx = x / W - 0.5, vy = y / H - 0.45;
      const k = (1.08 - 0.25 * (y / H)) * (1 - 0.35 * (vx * vx + vy * vy));
      const i = (y * W + x) * 3;
      rgb[i] = back[0] * k;
      rgb[i + 1] = back[1] * k;
      rgb[i + 2] = back[2] * k;
    }
  }
  const tex = skin || paintSkin(head, look, { seed });
  const N = vertexNormals(head, positions, ["skin", "mouth", "eyeSocketL", "eyeSocketR", "scleraL", "scleraR", "lashesL", "lashesR"]);
  const ao = occlusion(head, positions, N);
  const shadow = shadowMap(head, positions, LIGHTS.key.dir);

  const light = (P, n, albedo, { wrap = 0.35, sheen = 0, gloss = 50, ao: occ = 1, sss = true } = {}) => {
    const V = normalise(sub(eye, P));
    const out = [0, 0, 0];
    const sh = shadow(P);
    for (const [name, L] of Object.entries(LIGHTS)) {
      const nl = dot3(n, L.dir);
      const diff = Math.max(0, (nl + wrap) / (1 + wrap));
      const p = L.power * (name === "key" ? sh : 1) * (name === "rim" ? 0.4 : 1);
      for (let k = 0; k < 3; k++) out[k] += albedo[k] * L.colour[k] * diff * p;
      if (sss && wrap > 0) {
        // Light bleeding through skin near the shadow line warms it.
        const edge = Math.max(0, diff - Math.max(0, nl));
        out[0] += albedo[0] * 0.5 * edge * p;
        out[1] += albedo[1] * 0.12 * edge * p;
        out[2] += albedo[2] * 0.06 * edge * p;
      }
      if (sheen > 0 && nl > 0) {
        const Hh = normalise([L.dir[0] + V[0], L.dir[1] + V[1], L.dir[2] + V[2]]);
        const nh = Math.max(0, dot3(n, Hh));
        const fres = 0.03 + 0.97 * (1 - Math.max(0, dot3(n, V))) ** 5;
        const spec = sheen * (0.7 * nh ** gloss + 0.25 * nh ** (gloss / 5)) * (0.3 + 3 * fres) * nl * p;
        for (let k = 0; k < 3; k++) out[k] += spec * L.colour[k];
      }
    }
    const sky = 0.2 * (0.6 + 0.4 * n[1]) * occ;
    out[0] += albedo[0] * sky * 0.9;
    out[1] += albedo[1] * sky * 0.95;
    out[2] += albedo[2] * sky * 1.05;
    return out;
  };

  // Rasterise one part with perspective-correct attributes; `shade` returns linear RGB, or null to leave the pixel.
  const draw = (pos, tris, shade) => {
    const Q = new Map();
    const q = (v) => {
      if (!Q.has(v)) Q.set(v, project(c, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
      return Q.get(v);
    };
    for (const tri of tris) {
      const A = q(tri[0]), B = q(tri[1]), D = q(tri[2]);
      const area = (B[0] - A[0]) * (D[1] - A[1]) - (B[1] - A[1]) * (D[0] - A[0]);
      if (area >= 0 && !tri.both) continue;
      rasterTriangle(A, B, D, W, H, (x, y, w0, w1, w2) => {
        const z = w0 * A[2] + w1 * B[2] + w2 * D[2];
        const i = y * W + x;
        if (z >= depth[i]) return;
        let p0 = w0 / A[2], p1 = w1 / B[2], p2 = w2 / D[2];
        const sum = p0 + p1 + p2;
        p0 /= sum;
        p1 /= sum;
        p2 /= sum;
        const col = shade(tri, p0, p1, p2, x, y);
        if (!col) return;
        depth[i] = z;
        rgb[i * 3] = col[0];
        rgb[i * 3 + 1] = col[1];
        rgb[i * 3 + 2] = col[2];
      });
    }
  };
  const interp = (arr, tri, p0, p1, p2) => [0, 1, 2].map((k) => p0 * arr[tri[0] * 3 + k] + p1 * arr[tri[1] * 3 + k] + p2 * arr[tri[2] * 3 + k]);
  const sampleSkin = (u, v) => {
    const fx = Math.min(Math.max((u / 2) * tex.width - 0.5, 0), tex.width - 1.001);
    const fy = Math.min(Math.max((1 - v) * tex.height - 0.5, 0), tex.height - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * tex.width + x0) * 4, i10 = i00 + 4, i01 = i00 + tex.width * 4, i11 = i01 + 4;
    const out = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      out[k] = (tex.data[i00 + k] * (1 - tx) + tex.data[i10 + k] * tx) * (1 - ty) + (tex.data[i01 + k] * (1 - tx) + tex.data[i11 + k] * tx) * ty;
    }
    return out;
  };
  const partTris = (name, keep = null) => {
    const part = head.part(name);
    const tris = [];
    for (let t = 0; t < part.triangles.length; t += 3) {
      const r = [part.triangles[t], part.triangles[t + 1], part.triangles[t + 2]];
      const tri = [part.source[r[0]], part.source[r[1]], part.source[r[2]]];
      if (keep && !keep(tri)) continue;
      tri.r = r;
      tri.part = part;
      tris.push(tri);
    }
    return tris;
  };
  const uvAt = (tri, p0, p1, p2) => {
    const uv = tri.part.uv, r = tri.r;
    return [p0 * uv[r[0] * 2] + p1 * uv[r[1] * 2] + p2 * uv[r[2] * 2], p0 * uv[r[0] * 2 + 1] + p1 * uv[r[1] * 2 + 1] + p2 * uv[r[2] * 2 + 1]];
  };
  const aoAt = (tri, p0, p1, p2) => p0 * ao[tri[0]] + p1 * ao[tri[1]] + p2 * ao[tri[2]];
  const at = (tri, p0, p1, p2) => [interp(positions, tri, p0, p1, p2), normalise(interp(N, tri, p0, p1, p2))];

  // Shoulders: ICT's mesh stops just below the collarbones, so its bottom edge is carried down and out into a
  // torso, worn under the shirt.
  if (look.shirt) {
    const { source, triangles } = head.part("skin");
    const count = new Map();
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = source[triangles[t + k]], b = source[triangles[t + (k + 1) % 3]];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    const ext = [], tris = [];
    const put = (X) => {
      ext.push(...X);
      return ext.length / 3 - 1;
    };
    const down = (v) => {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      return [x + Math.sign(x) * Math.min(5, 0.4 * Math.abs(x)), y - 12, z * 1.15];
    };
    for (const [key, n] of count) {
      if (n !== 1) continue;
      const [a, b] = key.split(",").map(Number);
      if (positions[a * 3 + 1] > -11 || positions[b * 3 + 1] > -11) continue; // only the bottom edge
      const A = put([positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]]), B = put([positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]]);
      const A2 = put(down(a)), B2 = put(down(b));
      const t1 = [A, B, B2], t2 = [A, B2, A2];
      t1.both = t2.both = true;
      tris.push(t1, t2);
    }
    const shirt = lin3(look.shirt);
    draw(ext, tris, (tri, p0, p1, p2) => {
      const P = interp(ext, tri, p0, p1, p2);
      const A = [ext[tri[0] * 3], ext[tri[0] * 3 + 1], ext[tri[0] * 3 + 2]];
      let n = normalise(cross(sub([ext[tri[1] * 3], ext[tri[1] * 3 + 1], ext[tri[1] * 3 + 2]], A), sub([ext[tri[2] * 3], ext[tri[2] * 3 + 1], ext[tri[2] * 3 + 2]], A)));
      if (dot3(n, sub(eye, P)) < 0) n = n.map((k) => -k);
      const knit = 1 + 0.06 * (noise3(P[0] * 25, P[1] * 25, P[2] * 25, seed + 7) - 0.5);
      return light(P, n, shirt.map((k) => k * knit), { wrap: 0.2, sss: false, ao: 0.9 });
    });
  }

  // Inside of the mouth, eye sockets.
  const mouthCol = lin3([70, 34, 34]);
  draw(positions, partTris("mouth"), (tri, p0, p1, p2) => {
    const [P, n] = at(tri, p0, p1, p2);
    return light(P, n, mouthCol, { ao: 0.4, wrap: 0 }).map((k) => k * 0.5);
  });
  const socket = lin3(look.skin.map((k) => k * 0.72));
  for (const name of ["eyeSocketL", "eyeSocketR"]) {
    draw(positions, partTris(name), (tri, p0, p1, p2) => {
      const [P, n] = at(tri, p0, p1, p2);
      return light(P, n, socket, { ao: 0.6 });
    });
  }
  // Skin.
  draw(positions, partTris("skin"), (tri, p0, p1, p2) => {
    const [P, n] = at(tri, p0, p1, p2);
    const [u, v] = uvAt(tri, p0, p1, p2);
    const t = sampleSkin(u, v);
    const occ = aoAt(tri, p0, p1, p2);
    return light(P, n, [t[0] * occ, t[1] * occ, t[2] * occ], { sheen: 0.16 * t[3], gloss: 45, ao: occ });
  });
  // Eyes: wet and glossy, with catchlights.
  for (const name of ["scleraL", "scleraR"]) {
    draw(positions, partTris(name), (tri, p0, p1, p2) => {
      const [P, n] = at(tri, p0, p1, p2);
      const [u, v] = uvAt(tri, p0, p1, p2);
      const col = light(P, n, eyeAt(u, v, look, seed), { wrap: 0.1, sss: false, ao: 0.85 }).map((k) => k * 0.85);
      const V = normalise(sub(eye, P));
      for (const L of [LIGHTS.key, LIGHTS.fill]) {
        const Hh = normalise([L.dir[0] + V[0], L.dir[1] + V[1], L.dir[2] + V[2]]);
        const nh = Math.max(0, dot3(n, Hh));
        const s = (2.5 * nh ** 600 + 0.08 * nh ** 40) * L.power * (L === LIGHTS.key ? shadow(P) : 1);
        for (let k = 0; k < 3; k++) col[k] += s;
      }
      return col;
    });
  }
  // Upper lashes: a dark fringe, dithered so it reads as hairs rather than a strip.
  const lashCol = lin3(look.brows.map((k) => k * 0.45));
  for (const name of ["lashesL", "lashesR"]) {
    const tris = partTris(name, (tri) => (head.positions[tri[0] * 3 + 1] + head.positions[tri[1] * 3 + 1] + head.positions[tri[2] * 3 + 1]) / 3 > 3.6);
    for (const tri of tris) tri.both = true;
    draw(positions, tris, (tri, p0, p1, p2, x, y) => {
      const [u, v] = uvAt(tri, p0, p1, p2);
      const strand = noise3(u * 140, 0, 0, seed + 40);
      if (hash3(x, y, 0, seed + 41) > 0.25 + 0.6 * smooth(0.45, 0.8, strand) * (1 - Math.abs(v - 0.5))) return null;
      return lashCol.map((k) => k * 0.6);
    });
  }
  // Hair: strands running away from the crown's whorl, a glossy band, and a hairline that thins out.
  if (look.hairStyle && look.hairStyle !== "shaved") {
    const shell = hairShell(head, positions, look.hairStyle);
    const hp = shell.position;
    const hn = new Float32Array(hp.length);
    for (let t = 0; t < shell.index.length; t += 3) {
      const [a, b, d] = [shell.index[t], shell.index[t + 1], shell.index[t + 2]];
      const pa = [hp[a * 3], hp[a * 3 + 1], hp[a * 3 + 2]];
      const nn = cross(sub([hp[b * 3], hp[b * 3 + 1], hp[b * 3 + 2]], pa), sub([hp[d * 3], hp[d * 3 + 1], hp[d * 3 + 2]], pa));
      for (const i of [a, b, d]) for (let k = 0; k < 3; k++) hn[i * 3 + k] += nn[k];
    }
    const tris = [];
    for (let t = 0; t < shell.index.length; t += 3) tris.push([shell.index[t], shell.index[t + 1], shell.index[t + 2]]);
    const whorl = [0.6, 13.2, -3.2];
    const hairCol = lin3(look.hair);
    draw(hp, tris, (tri, p0, p1, p2, x, y) => {
      const P = interp(hp, tri, p0, p1, p2);
      const n = normalise(interp(hn, tri, p0, p1, p2));
      const alpha = p0 * shell.alpha[tri[0]] + p1 * shell.alpha[tri[1]] + p2 * shell.alpha[tri[2]];
      let d = sub(P, whorl);
      d = sub(d, n.map((k) => k * dot3(d, n)));
      const T = normalise(d);
      const B = normalise(cross(n, T));
      const a = dot3(P, T), b = dot3(P, B);
      const strands = 0.6 * noise3(b * 55, a * 1.6, P[2] * 0.5, seed + 50) + 0.4 * noise3(b * 130, a * 3, 0, seed + 51);
      if (hash3(x, y, 1, seed + 52) > alpha * (0.55 + 0.8 * strands)) return null;
      const albedo = hairCol.map((k) => k * (0.55 + 0.9 * strands));
      const col = light(P, n, albedo, { wrap: 0.1, sss: false, ao: 0.8 }).map((k) => k * 0.9);
      const V = normalise(sub(eye, P));
      const L = LIGHTS.key;
      const Hh = normalise([L.dir[0] + V[0], L.dir[1] + V[1], L.dir[2] + V[2]]);
      const th = dot3(T, Hh);
      const sinTH = Math.sqrt(Math.max(0, 1 - th * th));
      const s = shadow(P) * L.power;
      for (let k = 0; k < 3; k++) col[k] += s * (0.035 * sinTH ** 80 + 0.18 * albedo[k] * sinTH ** 12);
      return col;
    });
  }

  // Down to the output size, with a gentle highlight roll-off and a little grain.
  const out = new Uint8ClampedArray(width * height * 4);
  const rand = seeded(seed * 7 + 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < aa; sy++) for (let sx = 0; sx < aa; sx++) {
        const i = ((y * aa + sy) * W + (x * aa + sx)) * 3;
        acc[0] += rgb[i];
        acc[1] += rgb[i + 1];
        acc[2] += rgb[i + 2];
      }
      const o = (y * width + x) * 4;
      const g = (rand() + rand() + rand() - 1.5) * 2.2;
      for (let k = 0; k < 3; k++) {
        const v = acc[k] / (aa * aa);
        out[o + k] = toSrgb(v / (1 + 0.25 * v)) + g;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------- looks

// Looks for made-up faces (sRGB 0-255). None is modelled on a real person.
export const LOOKS = [
  { skin: [226, 186, 160], blush: [214, 120, 110], underEye: [170, 120, 115], lips: [182, 104, 100], brows: [120, 72, 46], iris: [92, 120, 128], hair: [128, 66, 34], hairStyle: "short", freckles: 0.8, stubble: 0, shirt: [70, 92, 120], backdrop: [206, 210, 214], flush: 0.55 },
  { skin: [168, 116, 86], blush: [170, 84, 70], underEye: [110, 70, 60], lips: [128, 74, 70], brows: [40, 30, 24], iris: [70, 44, 28], hair: [26, 22, 20], hairStyle: "buzz", stubble: 0.75, shirt: [190, 186, 176], backdrop: [196, 200, 204], flush: 0.35 },
  { skin: [214, 176, 140], blush: [200, 120, 100], underEye: [150, 110, 95], lips: [176, 108, 100], brows: [62, 44, 32], iris: [100, 90, 52], hair: [52, 36, 26], hairStyle: "full", stubble: 0.35, shirt: [48, 48, 52], backdrop: [212, 210, 206], flush: 0.4 },
  { skin: [104, 68, 50], blush: [110, 52, 42], underEye: [70, 44, 36], lips: [92, 56, 52], brows: [24, 18, 16], iris: [48, 30, 22], hair: [18, 16, 14], hairStyle: "buzz", stubble: 0.4, shirt: [150, 40, 44], backdrop: [204, 206, 210], flush: 0.3 },
  { skin: [232, 200, 170], blush: [220, 140, 124], underEye: [180, 140, 130], lips: [196, 120, 112], brows: [36, 28, 24], iris: [52, 36, 26], hair: [22, 20, 20], hairStyle: "short", stubble: 0, shirt: [210, 206, 196], backdrop: [214, 214, 212], flush: 0.35 },
  { skin: [238, 206, 186], blush: [226, 140, 128], underEye: [190, 150, 145], lips: [196, 118, 112], brows: [168, 132, 90], iris: [90, 130, 160], hair: [196, 160, 104], hairStyle: "full", freckles: 0.3, stubble: 0, shirt: [96, 120, 80], backdrop: [208, 212, 214], flush: 0.5 },
];

// A complete made-up photo: { image, pins, truth: { neutral, posed, weights }, camera }.
export function madeUpPhoto(head, { seed = 1, size = 900, look = LOOKS[0], smile = 0, distance = 120, turn = 0.08, hair = true, aa = 2, draw = true } = {}) {
  const rand = seeded(seed);
  const neutral = madeUpShape(head, rand);
  const weights = smile ? { mouthSmile_L: smile, mouthSmile_R: smile, cheekSquint_L: smile * 0.6, cheekSquint_R: smile * 0.6, eyeSquint_L: smile * 0.3, eyeSquint_R: smile * 0.3 } : {};
  const pose = posed(head, weights, neutral);
  const yaw = (rand() * 2 - 1) * turn, pitch = (rand() * 2 - 1) * turn * 0.6, roll = (rand() * 2 - 1) * turn * 0.4;
  const R = rotationXYZ(pitch, yaw, roll);
  // Face about 44% of the frame (about 14 cm across at `distance`), framed from the crown to the collar so the
  // template's cut-off shoulders stay out of the picture.
  const f = (0.44 * size * distance) / 14;
  const camera = { R, f, cx: size / 2, cy: size / 2, T: [0, -1.2, distance], distance };
  const image = draw ? drawHead(head, pose, camera, size, size, { ...look, hairStyle: hair ? look.hairStyle : null }, { aa, seed }) : null;
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
