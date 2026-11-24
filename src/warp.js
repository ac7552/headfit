// A thin-plate spline in 3D: the smoothest bending of space that carries each control point to its target.
// Kernel |r| (the biharmonic one in 3D) plus an affine part. `stiffness` lets each point miss its target a little
// (a smoothing spline): a pin placed a few pixels off then bends the head less.

import { nearestRotation, solve } from "./linalg.js";

export function thinPlate(from, to, { stiffness = 0, weights = null } = {}) {
  const n = from.length;
  const N = n + 4;
  const A = new Float64Array(N * N);
  const B = new Float64Array(N * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i * N + j] = Math.hypot(from[i][0] - from[j][0], from[i][1] - from[j][1], from[i][2] - from[j][2]);
    }
    // |r| is conditionally negative definite, so the smoothing term goes in with a minus sign.
    A[i * N + i] -= stiffness / (weights ? Math.max(weights[i], 1e-6) : 1);
    A[i * N + n] = 1;
    A[i * N + n + 1] = from[i][0];
    A[i * N + n + 2] = from[i][1];
    A[i * N + n + 3] = from[i][2];
    A[n * N + i] = 1;
    A[(n + 1) * N + i] = from[i][0];
    A[(n + 2) * N + i] = from[i][1];
    A[(n + 3) * N + i] = from[i][2];
    for (let k = 0; k < 3; k++) B[i * 3 + k] = to[i][k];
  }
  const x = solve(A, B, N, 3);
  const c = from.map((p) => p.slice());
  // Affine part: out = a0 + L X, with L[k] the row for output axis k.
  const a0 = [x[n * 3], x[n * 3 + 1], x[n * 3 + 2]];
  const L = [];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) L.push(x[(n + 1 + j) * 3 + k]);
  const W = x.subarray(0, n * 3);

  function at(X) {
    const out = [a0[0] + L[0] * X[0] + L[1] * X[1] + L[2] * X[2],
      a0[1] + L[3] * X[0] + L[4] * X[1] + L[5] * X[2],
      a0[2] + L[6] * X[0] + L[7] * X[1] + L[8] * X[2]];
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(X[0] - c[i][0], X[1] - c[i][1], X[2] - c[i][2]);
      out[0] += W[i * 3] * r;
      out[1] += W[i * 3 + 1] * r;
      out[2] += W[i * 3 + 2] * r;
    }
    return out;
  }

  // Warps a whole Float32Array of xyz in one pass (the inner loop is the hot part: vertices * control points).
  function all(positions, out = new Float32Array(positions.length)) {
    const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n);
    const wx = new Float64Array(n), wy = new Float64Array(n), wz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      [cx[i], cy[i], cz[i]] = c[i];
      wx[i] = W[i * 3];
      wy[i] = W[i * 3 + 1];
      wz[i] = W[i * 3 + 2];
    }
    for (let v = 0; v < positions.length; v += 3) {
      const X = positions[v], Y = positions[v + 1], Z = positions[v + 2];
      let ox = a0[0] + L[0] * X + L[1] * Y + L[2] * Z;
      let oy = a0[1] + L[3] * X + L[4] * Y + L[5] * Z;
      let oz = a0[2] + L[6] * X + L[7] * Y + L[8] * Z;
      for (let i = 0; i < n; i++) {
        const dx = X - cx[i], dy = Y - cy[i], dz = Z - cz[i];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        ox += wx[i] * r;
        oy += wy[i] * r;
        oz += wz[i] * r;
      }
      out[v] = ox;
      out[v + 1] = oy;
      out[v + 2] = oz;
    }
    return out;
  }

  return { at, all, linear: L, offset: a0, controls: c };
}

// Affine least-squares fit from -> to (3x4), for anchoring parts of the head the pins say nothing about.
export function affineFit(from, to, weights = null) {
  const n = from.length;
  const M = new Float64Array(16);
  const R = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    const h = [from[i][0], from[i][1], from[i][2], 1];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) M[a * 4 + b] += w * h[a] * h[b];
      for (let k = 0; k < 3; k++) R[a * 3 + k] += w * h[a] * to[i][k];
    }
  }
  for (let a = 0; a < 3; a++) M[a * 4 + a] += 1e-6;
  const x = solve(M, R, 4, 3);
  const L = [x[0], x[3], x[6], x[1], x[4], x[7], x[2], x[5], x[8]];
  const o = [x[9], x[10], x[11]];
  return {
    linear: L,
    offset: o,
    at: (X) => [0, 1, 2].map((k) => o[k] + L[k * 3] * X[0] + L[k * 3 + 1] * X[1] + L[k * 3 + 2] * X[2]),
  };
}

// Least-squares similarity (rotation, one scale, translation) from -> to (Umeyama), for the parts of the head
// the pins can't see: an affine fit to pins that all sit on the face's front would tilt the back of the head.
export function similarityFit(from, to, weights = null) {
  const n = from.length;
  let W = 0;
  const mf = [0, 0, 0], mt = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    W += w;
    for (let k = 0; k < 3; k++) {
      mf[k] += w * from[i][k];
      mt[k] += w * to[i][k];
    }
  }
  for (let k = 0; k < 3; k++) {
    mf[k] /= W;
    mt[k] /= W;
  }
  const S = new Array(9).fill(0);
  let varF = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    const a = [from[i][0] - mf[0], from[i][1] - mf[1], from[i][2] - mf[2]];
    const b = [to[i][0] - mt[0], to[i][1] - mt[1], to[i][2] - mt[2]];
    varF += w * (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += w * b[r] * a[c];
  }
  const R = nearestRotation(S);
  // scale = trace(R^T S) / var(from)
  let tr = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += R[r * 3 + c] * S[r * 3 + c];
  const s = tr / varF;
  const L = R.map((x) => x * s);
  const o = [0, 1, 2].map((k) => mt[k] - (L[k * 3] * mf[0] + L[k * 3 + 1] * mf[1] + L[k * 3 + 2] * mf[2]));
  return {
    linear: L,
    offset: o,
    scale: s,
    at: (X) => [0, 1, 2].map((k) => o[k] + L[k * 3] * X[0] + L[k * 3 + 1] * X[1] + L[k * 3 + 2] * X[2]),
  };
}
