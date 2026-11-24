// Makes the page's sample faces: made-up heads drawn to photos, with their pins where they truly are.
// No real person is pictured. Run:  node tools/make_samples.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOOKS, madeUpPhoto } from "../src/synth.js";
import { writeJpeg } from "./images.mjs";
import { nodeHead } from "./node-head.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "samples");
fs.mkdirSync(out, { recursive: true });
const head = nodeHead();
const SAMPLES = [
  { id: "made-up-1", about: "freckles, long wavy hair", seed: 11, look: 0 },
  { id: "made-up-2", about: "stubble, turned a little", seed: 12, look: 1, turn: 0.14 },
  { id: "made-up-3", about: "smiling", seed: 13, look: 2, smile: 0.6 },
  { id: "made-up-4", about: "taken at arm's length", seed: 14, look: 3, distance: 45 },
  { id: "made-up-5", about: "bob", seed: 15, look: 4 },
  { id: "made-up-6", about: "fair, long hair", seed: 16, look: 5 },
];
const list = [];
for (const s of SAMPLES) {
  const photo = madeUpPhoto(head, { seed: s.seed, look: LOOKS[s.look], smile: s.smile || 0, turn: s.turn ?? 0.08, distance: s.distance ?? 120 });
  writeJpeg(path.join(out, `${s.id}.jpg`), photo.image, 90);
  const round = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  fs.writeFileSync(path.join(out, `${s.id}.json`), JSON.stringify({ pins: Object.fromEntries(Object.entries(photo.pins).map(([k, v]) => [k, round(v)])), distance: s.distance ?? 120, earsHidden: Boolean(LOOKS[s.look].strands) }));
  list.push({ id: s.id, label: `Made-up face ${s.id.slice(-1)}`, about: s.about, width: photo.image.width, height: photo.image.height });
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(list, null, 1) + "\n");
console.log(`${list.length} made-up samples in ${out}`);
