// Longer hair as strands. Each strand is rooted at a random spot on the scalp of the fitted head, combed away
// from a parting, pulled down by gravity, and kept outside the head, neck and shoulders (a few ellipsoids
// measured from the head itself). Waves are added along the way. No hair assets and nothing learned: geometry
// and a seed.

import { vertexNormals } from "./head.js";
import { earClearance, hairlineWeight } from "./hair.js";

export const STRAND_STYLES = {
  bob: { label: "Bob", length: 15, part: 0.6, wave: 0.12, curl: 0.5 },
  medium: { label: "Shoulder length, side part", length: 22, part: -2.4, wave: 0.3, curl: 0 },
  long: { label: "Long, centre part", length: 32, part: 0, wave: 0.2, curl: 0 },
  wavy: { label: "Long and wavy", length: 28, part: 2.2, wave: 0.85, curl: 0 },
};

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// Ellipsoids around the head, jaw, neck, shoulders and in front of the face of these positions (template regions, fitted extents).
export function colliders(head, positions) {
  const T = head.positions;
  const box = (test) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < head.skinVertexCount; v++) {
      if (!test(T[v * 3], T[v * 3 + 1], T[v * 3 + 2])) continue;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], positions[v * 3 + k]);
        hi[k] = Math.max(hi[k], positions[v * 3 + k]);
      }
    }
    return { c: lo.map((a, k) => (a + hi[k]) / 2), r: lo.map((a, k) => (hi[k] - a) / 2) };
  };
  const skull = box((x, y) => y > -4);
  const jaw = box((x, y, z) => y <= 3 && y > -8.5 && z > -5 && Math.abs(x) < 6.3);
  const neck = box((x, y) => y <= -9 && y > -15);
  neck.r[1] = 9;
  const low = box((x, y) => y <= -16.5);
  const shoulders = { c: [low.c[0], low.c[1] - 6.5, low.c[2]], r: [low.r[0] + 6, 8.5, low.r[2] + 2.5] };
  // A guard in front of the face. Hair isn't laid over it (it would hang there like a veil): a strand that
  // enters it is moved sideways out of it, so the hair parts around the face and hangs beside the cheeks.
  const face = { c: [skull.c[0], skull.c[1] - 3.5, skull.c[2] + skull.r[2] - 1.5], r: [6.8, 9.5, 6.5], sideways: true };
  return [skull, jaw, neck, shoulders, face];
}

function pushOut(p, bodies, lift, side = 0) {
  for (const b of bodies) {
    if (b.sideways) {
      const dy = (p[1] - b.c[1]) / b.r[1], dz = (p[2] - b.c[2]) / b.r[2];
      const room = 1 - dy * dy - dz * dz;
      if (room <= 0) continue;
      const reach = (b.r[0] + lift) * Math.sqrt(room);
      const off = p[0] - b.c[0];
      if (Math.abs(off) < reach) p[0] = b.c[0] + (Math.abs(off) > 1 || !side ? Math.sign(off) || 1 : side) * reach;
      continue;
    }
    const dx = (p[0] - b.c[0]) / (b.r[0] + lift), dy = (p[1] - b.c[1]) / (b.r[1] + lift), dz = (p[2] - b.c[2]) / (b.r[2] + lift);
    const k = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (k < 1 && k > 1e-6) {
      p[0] = b.c[0] + (p[0] - b.c[0]) / k;
      p[1] = b.c[1] + (p[1] - b.c[1]) / k;
      p[2] = b.c[2] + (p[2] - b.c[2]) / k;
    }
  }
}

// Grows the strands: { points (count * (segments + 1) * 3), segments, count, tone (0..1 a strand), lift (0..1) }.
export function growHair(head, positions, styleName, { count = 14000, seed = 1 } = {}) {
  const style = STRAND_STYLES[styleName];
  if (!style) throw new Error(`no hair style ${styleName}`);
  const rand = seeded(seed * 97 + 5);
  const T = head.positions;
  const N = vertexNormals(head, positions, ["skin"]);
  const clear = earClearance(head);
  const { source, triangles } = head.part("skin");
  // Scalp triangles, weighted by area and by how far inside the hairline they are.
  const tris = [], cumulative = [];
  let total = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = [source[triangles[t]], source[triangles[t + 1]], source[triangles[t + 2]]];
    const w = ids.map((v) => hairlineWeight(T[v * 3], T[v * 3 + 1], T[v * 3 + 2]) * clear[v]);
    if (w[0] + w[1] + w[2] <= 0) continue;
    const a = ids.map((v) => [T[v * 3], T[v * 3 + 1], T[v * 3 + 2]]);
    const u = [a[1][0] - a[0][0], a[1][1] - a[0][1], a[1][2] - a[0][2]], q = [a[2][0] - a[0][0], a[2][1] - a[0][1], a[2][2] - a[0][2]];
    const area = 0.5 * Math.hypot(u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]);
    total += area * ((w[0] + w[1] + w[2]) / 3);
    tris.push(ids);
    cumulative.push(total);
  }
  const bodies = colliders(head, positions);
  const segments = Math.max(16, Math.min(40, Math.round(style.length / 0.8)));
  const per = segments + 1;
  const points = new Float32Array(count * per * 3);
  const tone = new Float32Array(count), lifts = new Float32Array(count);
  let made = 0;
  for (let tries = 0; tries < count * 3 && made < count; tries++) {
    // A random spot on the scalp.
    const pick = rand() * total;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < pick) lo = mid + 1;
      else hi = mid;
    }
    const ids = tris[lo];
    let b0 = rand(), b1 = rand();
    if (b0 + b1 > 1) {
      b0 = 1 - b0;
      b1 = 1 - b1;
    }
    const b = [1 - b0 - b1, b0, b1];
    const at = (A) => [0, 1, 2].map((k) => b[0] * A[ids[0] * 3 + k] + b[1] * A[ids[1] * 3 + k] + b[2] * A[ids[2] * 3 + k]);
    const home = at(T);
    const inside = hairlineWeight(home[0], home[1], home[2]) * (b[0] * clear[ids[0]] + b[1] * clear[ids[1]] + b[2] * clear[ids[2]]);
    if (rand() > inside) continue;
    const root = at(positions);
    const n = norm(at(N));

    // Combed away from the parting (more so on top of the head), back off the face, and down.
    const side = home[0] >= style.part ? 1 : -1;
    const top = Math.max(0, n[1]);
    let comb = [side * (0.3 + 0.9 * top + 0.6 * Math.max(0, n[2])), -0.4, -0.9 * Math.max(0, n[2]) - 0.1];
    const cn = comb[0] * n[0] + comb[1] * n[1] + comb[2] * n[2];
    comb = norm([comb[0] - n[0] * cn, comb[1] - n[1] * cn, comb[2] - n[2] * cn]);
    let dir = norm([comb[0] + 0.35 * n[0] + 0.25 * (rand() - 0.5), comb[1] + 0.35 * n[1] + 0.25 * (rand() - 0.5), comb[2] + 0.35 * n[2] + 0.25 * (rand() - 0.5)]);

    const length = style.length * (0.78 + 0.27 * rand()) * (0.3 + 0.7 * inside);
    const ds = length / segments;
    const lift = Math.pow(rand(), 1.5); // 0 lies on the head, 1 is the outermost layer
    const gap = 0.15 + 1.0 * lift;
    // Neighbouring strands wave together: the wave's phase comes from where the strand is rooted.
    const phase = 3 * Math.sin(0.5 * home[0] + 0.9 * home[1]) + 2.5 * Math.sin(0.8 * home[2] - 0.4 * home[0]) + 0.5 * rand();
    const wavelength = 4.5 + 1.5 * Math.sin(0.3 * home[0] + 0.2 * home[2]);
    const p = root.slice();
    const o = made * per * 3;
    points.set(root, o);
    for (let i = 1; i <= segments; i++) {
      const s = i * ds;
      dir = norm([dir[0], dir[1] - 0.3 * ds, dir[2]]);
      const before = p.slice();
      p[0] += dir[0] * ds;
      p[1] += dir[1] * ds;
      p[2] += dir[2] * ds;
      pushOut(p, bodies, gap, side);
      const moved = [p[0] - before[0], p[1] - before[1], p[2] - before[2]];
      if (Math.hypot(moved[0], moved[1], moved[2]) > 1e-6) dir = norm(moved); // slide along what it rests on
      // Waves across the strand, growing in over the first few centimetres; ends that curl under for a bob.
      const grow = Math.min(1, s / 4);
      const across = norm([dir[2], 0, -dir[0]]);
      const w = style.wave * grow * Math.sin((2 * Math.PI * s) / wavelength + phase);
      const w2 = style.wave * 0.5 * grow * Math.cos((2 * Math.PI * s) / (wavelength * 0.8) + phase);
      const under = style.curl * Math.max(0, (s / length - 0.75) / 0.25) ** 2 * 1.6;
      const q = [p[0] + across[0] * w - Math.sign(p[0]) * under * 0.6, p[1] + 0.3 * w2, p[2] + across[2] * w + across[0] * w2];
      pushOut(q, bodies, gap, side);
      points.set(q, o + i * 3);
    }
    tone[made] = rand();
    lifts[made] = lift;
    made++;
  }
  return { points: points.subarray(0, made * per * 3), segments, count: made, tone: tone.subarray(0, made), lift: lifts.subarray(0, made) };
}
