// A small software rasteriser: triangles to pixels with barycentric weights, and a depth buffer.
// Used to lay the photo onto the head (which spots of the skin the photo can see) and, in tests, to draw heads.

// Calls fn(x, y, b0, b1, b2) for every pixel centre inside the triangle (a, b, c are [x, y] in pixels).
export function rasterTriangle(a, b, c, width, height, fn) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  if (minX > maxX || minY > maxY) return;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-12) return;
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inv;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      fn(x, y, w0, w1, w2);
    }
  }
}

// Depth (camera z) of the nearest surface at each pixel, for the given parts of the head.
export function depthBuffer(head, positions, project, width, height, partNames = ["skin"]) {
  const depth = new Float32Array(width * height).fill(Infinity);
  const n = head.vertexCount;
  const P = new Float32Array(n * 3);
  const done = new Uint8Array(n);
  for (const name of partNames) {
    const { source, triangles } = head.part(name);
    for (const v of source) {
      if (done[v]) continue;
      done[v] = 1;
      const q = project([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
      P[v * 3] = q[0];
      P[v * 3 + 1] = q[1];
      P[v * 3 + 2] = q[2];
    }
    for (let t = 0; t < triangles.length; t += 3) {
      const ia = source[triangles[t]], ib = source[triangles[t + 1]], ic = source[triangles[t + 2]];
      const a = [P[ia * 3], P[ia * 3 + 1]], b = [P[ib * 3], P[ib * 3 + 1]], c = [P[ic * 3], P[ic * 3 + 1]];
      const za = P[ia * 3 + 2], zb = P[ib * 3 + 2], zc = P[ic * 3 + 2];
      rasterTriangle(a, b, c, width, height, (x, y, w0, w1, w2) => {
        const z = w0 * za + w1 * zb + w2 * zc;
        const i = y * width + x;
        if (z < depth[i]) depth[i] = z;
      });
    }
  }
  return { depth, projected: P };
}

// Bilinear sample of an RGBA image ({ width, height, data }) at pixel coordinates; returns [r, g, b].
export function sample(image, x, y) {
  const { width: w, height: h, data } = image;
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1.001), fy = Math.min(Math.max(y - 0.5, 0), h - 1.001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = (data[i00 + k] * (1 - tx) + data[i10 + k] * tx) * (1 - ty) + (data[i01 + k] * (1 - tx) + data[i11 + k] * tx) * ty;
  }
  return out;
}
