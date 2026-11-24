import assert from "node:assert/strict";
import { test } from "node:test";

import { bakeSkin } from "../src/bake.js";
import { fitOrthographic, fitPerspective, FRONT_ROTATION, project } from "../src/camera.js";
import { fitHead } from "../src/fit.js";
import { hairShell, scalp } from "../src/hair.js";
import { posed } from "../src/head.js";
import { mul3, nearestRotation, rotation, solve } from "../src/linalg.js";
import { PINS, pinsFromPoints, pointOf } from "../src/pins.js";
import { startFront } from "../src/start.js";
import { LOOKS, madeUpPhoto, truePins } from "../src/synth.js";
import { similarityFit, thinPlate } from "../src/warp.js";
import { nodeHead } from "../tools/node-head.mjs";

const head = nodeHead();

test("solve and nearest rotation", () => {
  const x = solve([4, 1, 0, 1, 3, 1, 0, 1, 2], [1, 2, 3], 3);
  const back = [4 * x[0] + x[1], x[0] + 3 * x[1] + x[2], x[1] + 2 * x[2]];
  back.forEach((v, i) => assert.ok(Math.abs(v - [1, 2, 3][i]) < 1e-12));
  const R = rotation([0.3, -0.2, 0.5]);
  const noisy = R.map((v, i) => v * (i % 4 === 0 ? 1.3 : 1) + 0.01);
  const N = nearestRotation(noisy);
  const I = mul3(N, [N[0], N[3], N[6], N[1], N[4], N[7], N[2], N[5], N[8]]);
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => assert.ok(Math.abs(I[i] - v) < 1e-9));
});

test("thin-plate spline passes through its points, and smooths when stiff", () => {
  const from = [], to = [];
  for (let i = 0; i < 25; i++) {
    const p = [Math.sin(i) * 8, Math.cos(i * 1.7) * 8, (i % 5) * 2];
    from.push(p);
    to.push([p[0] * 1.05 + 0.3, p[1] + 0.2 * Math.sin(p[0]), p[2] - 0.1]);
  }
  const exact = thinPlate(from, to);
  for (let i = 0; i < from.length; i++) assert.ok(Math.hypot(...exact.at(from[i]).map((v, k) => v - to[i][k])) < 1e-9);
  const soft = thinPlate(from, to, { stiffness: 1 });
  let miss = 0;
  for (let i = 0; i < from.length; i++) miss = Math.max(miss, Math.hypot(...soft.at(from[i]).map((v, k) => v - to[i][k])));
  assert.ok(miss > 1e-4 && miss < 1, `stiff spline misses a little (${miss})`);
  const sim = similarityFit(from, from.map((p) => [2 * p[1] + 1, -2 * p[0], 2 * p[2] + 3]));
  assert.ok(Math.abs(sim.scale - 2) < 1e-9);
});

test("cameras come back from their own projections", () => {
  const pts = PINS.filter((p) => p.point).map((p) => pointOf(p, head, head.positions));
  const truth = { R: mul3(rotation([0.08, -0.25, 0.05]), FRONT_ROTATION), f: 2600, cx: 500, cy: 520, T: [0.6, -1.2, 90], distance: 90 };
  const px = pts.map((X) => project(truth, X).slice(0, 2));
  const persp = fitPerspective(pts, px, { distance: 90, width: 1000, height: 1040 });
  const worst = Math.max(...pts.map((X, i) => Math.hypot(...project(persp, X).slice(0, 2).map((v, k) => v - px[i][k]))));
  assert.ok(worst < 0.5, `perspective reprojection ${worst}`);
  const ortho = fitOrthographic(pts, px);
  const worstO = Math.max(...pts.map((X, i) => Math.hypot(...project(ortho, X).slice(0, 2).map((v, k) => v - px[i][k]))));
  assert.ok(worstO < 25, `orthographic is close but not exact on a perspective photo (${worstO})`);
});

test("a known bend of the template is found again from its pins", () => {
  // A made-up face: the template widened, with a longer chin and a narrower nose, smiling a little.
  const bendTo = (X) => [X[0] * (1.08 - 0.02 * Math.max(0, X[1] + 2) / 10), X[1] * 1.03 - 0.4 * Math.max(0, -X[1] - 4) / 4, X[2]];
  const neutralTruth = new Float32Array(head.positions.length);
  for (let v = 0; v < head.vertexCount; v++) neutralTruth.set(bendTo([head.positions[v * 3], head.positions[v * 3 + 1], head.positions[v * 3 + 2]]), v * 3);
  const smile = { mouthSmile_L: 0.5, mouthSmile_R: 0.5 };
  const posedTruth = posed(head, smile, neutralTruth);
  const cam = { R: mul3(rotation([0.05, 0.12, 0]), FRONT_ROTATION), f: 3000, cx: 600, cy: 600, T: [0, 2, 110], distance: 110 };
  const pins = truePins(head, posedTruth, cam);
  // The photo's camera is given here, so this checks the bend and the expression reading on their own. With the
  // camera estimated from one photo, its tilt and the face's depth trade off (see the README).
  const fit = fitHead(head, [{ kind: "front", width: 1200, height: 1200, pins, distance: 110 }], { cameras: [cam] });
  assert.ok(fit.report.meanPixels < 2, `pins met (${fit.report.meanPixels})`);
  assert.ok((fit.weights.mouthSmile_L || 0) > 0.2 && (fit.weights.mouthSmile_R || 0) > 0.2, `smile read: ${JSON.stringify(fit.weights)}`);
  // Face shape (front of the face, after lining up by a similarity) closer to the truth than the template is.
  const face = [];
  for (let v = 0; v < 6706; v += 7) face.push(v);
  const err = (P) => {
    const sim = similarityFit(face.map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]), face.map((v) => [neutralTruth[v * 3], neutralTruth[v * 3 + 1], neutralTruth[v * 3 + 2]]));
    let s = 0;
    for (const v of face) s += Math.hypot(...sim.at([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]).map((x, k) => x - neutralTruth[v * 3 + k])) ** 2;
    return Math.sqrt(s / face.length) * 10; // mm
  };
  const before = err(head.positions), after = err(fit.neutral);
  assert.ok(after < before * 0.6, `face error ${before.toFixed(2)} mm -> ${after.toFixed(2)} mm`);
});

test("a drawn made-up face: pins met, smile read, photo painted", () => {
  const photo = madeUpPhoto(head, { seed: 3, look: LOOKS[1], smile: 0.6, size: 600 });
  const fit = fitHead(head, [{ kind: "front", width: 600, height: 600, pins: photo.pins }]);
  assert.ok(fit.report.meanPixels < 2, `mean ${fit.report.meanPixels} px on a 600 px photo`);
  assert.ok((fit.weights.mouthSmile_L || 0) > 0.3 && (fit.weights.mouthSmile_R || 0) > 0.3, `smile read: ${JSON.stringify(fit.weights)}`);
  assert.ok(!fit.weights.jawOpen, "a closed mouth reads as closed");
  const tex = bakeSkin(head, fit, [photo.image], { size: 256 });
  assert.equal(tex.data.length, 512 * 256 * 4);
  // The tone read back is close to the skin the face was drawn with (lit, then the lighting taken out).
  const want = LOOKS[1].skin;
  const off = Math.hypot(...tex.tone.map((x, k) => x - want[k]));
  assert.ok(off < 45, `skin tone ${tex.tone.map(Math.round)} against ${want}`);
});

test("three clicks give a first guess near the true pins", () => {
  const { pins } = madeUpPhoto(head, { seed: 5, size: 900, hair: false });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const clicks = [mid(pins.eyeOuterRight, pins.eyeInnerRight), mid(pins.eyeInnerLeft, pins.eyeOuterLeft), mid(pins.mouthRight, pins.mouthLeft)];
  const start = startFront(head, clicks);
  const off = Object.keys(pins).map((k) => Math.hypot(pins[k][0] - start.pins[k][0], pins[k][1] - start.pins[k][1]));
  const mean = off.reduce((a, b) => a + b, 0) / off.length;
  assert.ok(mean < 30, `first guess ${mean.toFixed(1)} px off on average`);
});

test("pins from a 189-point face template", () => {
  const pts = Array.from({ length: 189 }, (_, i) => [i, 2 * i]);
  const { pins } = pinsFromPoints(pts);
  assert.deepEqual(pins.eyeOuterRight, [18, 36]);
  assert.deepEqual(pins.noseBridge, [54, 108]); // the middle of points 51 and 57
});

test("hair shell sits over the scalp and not the face", () => {
  const h = scalp(head);
  const mp = (k) => head.landmarks68[k];
  assert.equal(h[mp(30)], 0, "nose tip has no hair");
  assert.equal(h[mp(19)], 0, "brow has no hair");
  let crown = 0;
  for (let v = 0; v < head.skinVertexCount; v++) if (head.positions[v * 3 + 1] > 13) crown = Math.max(crown, h[v]);
  assert.equal(crown, 1);
  const shell = hairShell(head, head.positions, "short");
  assert.ok(shell.index.length > 3000);
  assert.equal(hairShell(head, head.positions, "shaved"), null);
});
