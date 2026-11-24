// Small dense linear algebra: enough for a 3x3 rotation, a few dozen pins and a thin-plate spline.

// Solves A x = b in place by Gaussian elimination with partial pivoting. A is n*n (row-major), b is n*m.
export function solve(A, b, n, m = 1) {
  const a = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (Math.abs(a[p * n + c]) < 1e-12) throw new Error("singular system");
    if (p !== c) {
      for (let k = 0; k < n; k++) [a[c * n + k], a[p * n + k]] = [a[p * n + k], a[c * n + k]];
      for (let k = 0; k < m; k++) [x[c * m + k], x[p * m + k]] = [x[p * m + k], x[c * m + k]];
    }
    const d = a[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
      for (let k = 0; k < m; k++) x[r * m + k] -= f * x[c * m + k];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    for (let k = 0; k < m; k++) {
      let s = x[c * m + k];
      for (let j = c + 1; j < n; j++) s -= a[c * n + j] * x[j * m + k];
      x[c * m + k] = s / a[c * n + c];
    }
  }
  return x;
}

// Least squares: minimises |A x - b|^2 + ridge |x - prior|^2. A is rows*n.
export function leastSquares(A, b, rows, n, ridge = 0, prior = null) {
  const N = new Float64Array(n * n);
  const r = new Float64Array(n);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < n; j++) {
      const aij = A[i * n + j];
      if (aij === 0) continue;
      r[j] += aij * b[i];
      for (let k = 0; k < n; k++) N[j * n + k] += aij * A[i * n + k];
    }
  }
  for (let j = 0; j < n; j++) {
    N[j * n + j] += ridge;
    if (prior) r[j] += ridge * prior[j];
  }
  return solve(N, r, n);
}

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);

// 3x3 matrices are arrays of 9 numbers, row-major.
export function mul3(A, B) {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
}
export const transpose3 = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export const apply3 = (A, v) => [
  A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
  A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
  A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
];
export function det3(A) {
  return A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
}

// Rotation from an axis-angle vector (Rodrigues).
export function rotation(w) {
  const t = norm3(w);
  if (t < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = [w[0] / t, w[1] / t, w[2] / t];
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
}

// Eigen-decomposition of a symmetric 3x3 matrix by Jacobi sweeps: returns { values, vectors (columns) }.
export function eigenSym3(S) {
  const a = S.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-15) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-18) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0], a[4], a[8]], vectors: v };
}

// The rotation nearest to M (polar decomposition), through the eigenvectors of M^T M.
export function nearestRotation(M) {
  const { values, vectors: V } = eigenSym3(mul3(transpose3(M), M));
  const inv = values.map((l) => 1 / Math.sqrt(Math.max(l, 1e-18)));
  const D = [inv[0], 0, 0, 0, inv[1], 0, 0, 0, inv[2]];
  let R = mul3(M, mul3(V, mul3(D, transpose3(V))));
  if (det3(R) < 0) {
    // Flip the axis with the smallest singular value.
    let k = 0;
    for (let i = 1; i < 3; i++) if (values[i] < values[k]) k = i;
    const u = [V[k], V[3 + k], V[6 + k]];
    const F = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) F[i * 3 + j] -= 2 * u[i] * u[j];
    R = mul3(R, F);
  }
  return R;
}
