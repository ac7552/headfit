// The ICT head as packed by tools/pack_ict.py: one set of 26,719 positions shared by every part, each part with
// its own UVs and triangles, and 53 ARKit expression shapes as sparse deltas.

export function readHead(header, buffer) {
  const view = (spec, Kind) => new Kind(buffer, spec.offset, spec.length);
  const positions = Float32Array.from(view(header.positions, Float32Array));
  const parts = header.parts.map((p) => ({
    name: p.name,
    about: p.about,
    source: view(p.source, Uint32Array),
    uv: view(p.uv, Float32Array),
    triangles: view(p.triangles, Uint32Array),
  }));
  const expressions = new Map();
  for (const e of header.expressions) {
    const index = view(e.index, Uint16Array);
    const steps = view(e.delta, Int16Array);
    const delta = new Float32Array(steps.length);
    for (let i = 0; i < steps.length; i++) delta[i] = steps[i] * e.scale;
    expressions.set(e.name, { index, delta });
  }
  const part = (name) => parts.find((p) => p.name === name);
  return {
    positions,
    vertexCount: header.vertexCount,
    skinVertexCount: header.skinVertexCount,
    parts,
    part,
    expressions,
    landmarks68: header.landmarks68,
  };
}

// Node and browser both: fetch-like loader given a function returning { json(), arrayBuffer() }.
export async function loadHead(read) {
  const header = await read("ict-head.json", "json");
  const buffer = await read("ict-head.bin", "arrayBuffer");
  return readHead(header, buffer);
}

// The neutral head with expression weights added: { name: weight }.
export function posed(head, weights = {}, base = head.positions) {
  const out = Float32Array.from(base);
  for (const [name, w] of Object.entries(weights)) {
    if (!w) continue;
    const e = head.expressions.get(name);
    if (!e) throw new Error(`no expression ${name}`);
    const { index, delta } = e;
    for (let i = 0; i < index.length; i++) {
      const v = index[i] * 3;
      out[v] += w * delta[i * 3];
      out[v + 1] += w * delta[i * 3 + 1];
      out[v + 2] += w * delta[i * 3 + 2];
    }
  }
  return out;
}

// Vertex normals for the skin, from its triangles (area weighted), as a Float32Array over all vertices.
export function vertexNormals(head, positions, partNames = ["skin"]) {
  const n = new Float32Array(head.vertexCount * 3);
  for (const name of partNames) {
    const { source, triangles } = head.part(name);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = source[triangles[t]] * 3, b = source[triangles[t + 1]] * 3, c = source[triangles[t + 2]] * 3;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        n[v] += nx;
        n[v + 1] += ny;
        n[v + 2] += nz;
      }
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  return n;
}

