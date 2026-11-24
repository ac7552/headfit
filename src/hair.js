// Close-cut hair as a shell over the scalp: the scalp's own triangles lifted along their normals, thinning to
// nothing at the hairline. It follows the fitted head exactly. Its colour is read from the photo above the
// forehead. Longer styles need hair cards (MakeHuman's CC0 hair, or MetaHuman's), which this does not do yet.

import { project } from "./camera.js";
import { vertexNormals } from "./head.js";
import { regions } from "./pins.js";
import { sample } from "./raster.js";

export const STYLES = {
  shaved: { label: "Shaved", length: 0 },
  buzz: { label: "Buzz cut", length: 0.25 },
  short: { label: "Short", length: 0.8 },
  full: { label: "Full on top", length: 1.6, top: 0.7 },
};

// How much of a hair area each skin vertex is (1 inside, 0 outside), from the template's own frame so every
// fitted head gets the same hairline: high on the forehead, down the temples, above and behind the ears,
// down to the nape at the back.
export function scalp(head) {
  if (head._scalp) return head._scalp;
  const P = head.positions;
  const { earRight, earLeft } = regions(head);
  const ears = [...earRight, ...earLeft].map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
  const h = new Float32Array(head.vertexCount);
  for (let v = 0; v < head.skinVertexCount; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2] - 1.0; // around the skull's vertical axis
    const a = (Math.atan2(Math.abs(x), z) * 180) / Math.PI; // 0 at the forehead, 90 at the ears, 180 at the back
    const line = hairline(a);
    let w = smooth(line, line + 1.2, y);
    // Keep clear of the ears.
    let near = Infinity;
    if (w > 0 && Math.abs(x) > 5) {
      for (const e of ears) {
        const d = Math.hypot(x - e[0], y - e[1], P[v * 3 + 2] - e[2]);
        if (d < near) near = d;
      }
      w *= smooth(0.6, 1.6, near);
    }
    h[v] = w;
  }
  head._scalp = h;
  return h;
}

function hairline(a) {
  // Height (cm, template frame) of the hairline by angle around the head.
  const knots = [[0, 10.6], [22, 10.2], [45, 8.0], [62, 5.6], [78, 4.6], [100, 4.4], [118, 1.0], [140, -3.0], [180, -4.2]];
  for (let i = 0; i + 1 < knots.length; i++) {
    const [a0, y0] = knots[i], [a1, y1] = knots[i + 1];
    if (a <= a1) return y0 + ((y1 - y0) * (a - a0)) / (a1 - a0);
  }
  return knots[knots.length - 1][1];
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The shell: { position, uv, alpha, index } over the scalp's triangles, for the given fitted positions.
export function hairShell(head, positions, style) {
  const s = STYLES[style] || STYLES.short;
  if (!s.length) return null;
  const h = scalp(head);
  const N = vertexNormals(head, positions, ["skin"]);
  const { source, uv, triangles } = head.part("skin");
  const keep = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = h[source[triangles[t]]], b = h[source[triangles[t + 1]]], c = h[source[triangles[t + 2]]];
    if (a > 0.01 || b > 0.01 || c > 0.01) keep.push(t);
  }
  const map = new Map();
  const pos = [], uvs = [], alpha = [], index = [];
  const top = s.top || 0;
  for (const t of keep) {
    for (let k = 0; k < 3; k++) {
      const r = triangles[t + k];
      if (!map.has(r)) {
        const v = source[r];
        const w = h[v];
        const y = head.positions[v * 3 + 1];
        const lift = 0.04 + s.length * Math.pow(w, 0.6) * (1 + top * smooth(8, 14, y));
        map.set(r, pos.length / 3);
        pos.push(positions[v * 3] + N[v * 3] * lift, positions[v * 3 + 1] + N[v * 3 + 1] * lift, positions[v * 3 + 2] + N[v * 3 + 2] * lift);
        uvs.push(uv[r * 2], uv[r * 2 + 1]);
        alpha.push(smooth(0.05, 0.6, w));
      }
      index.push(map.get(r));
    }
  }
  return { position: new Float32Array(pos), uv: new Float32Array(uvs), alpha: new Float32Array(alpha), index: new Uint32Array(index) };
}

// Hair colour: the median of the darker half of the photo where the hairline's inside meets the camera.
export function hairColour(head, fit, image) {
  const view = fit.views.find((v) => v.kind !== "side");
  const h = scalp(head);
  const P = fit.fitted;
  const px = [];
  for (let v = 0; v < head.skinVertexCount; v += 3) {
    if (h[v] < 0.95) continue;
    const z = head.positions[v * 3 + 2], y = head.positions[v * 3 + 1];
    if (z < 3 || y < 9) continue; // the front of the scalp, as the front photo sees it
    const q = project(view.camera, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    if (q[0] < 0 || q[1] < 0 || q[0] >= image.width || q[1] >= image.height) continue;
    px.push(sample(image, q[0], q[1]));
  }
  if (!px.length) return null;
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const dark = px.slice(Math.floor(px.length * 0.1), Math.ceil(px.length * 0.55));
  return [0, 1, 2].map((k) => dark.reduce((s, c) => s + c[k], 0) / dark.length);
}
