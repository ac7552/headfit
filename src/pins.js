// The pins a person drags onto a photo, and where each one sits on the ICT head.
//
// Two kinds:
//   point    a spot on the skin (one vertex, or the middle of two). The head is bent so this spot lands on the pin.
//   outline  a spot on the head's outline in the photo (side of the jaw, rim of the ear). Which vertex that is
//            depends on the pose, so it is looked up each time: the outermost vertex of a region at the pin's height.
//            Only the outward direction is pinned; the outline is free to slide along itself.
//
// Names use the person's own left and right. In a front photo the person's right is on the photo's left.
// `frl` lists the points of the Face Research Lab 189-point template (Psychomorph / WebMorph) that give the pin
// when importing a .tem file; in that template "left" means the photo's left.

const PIE = (head, k) => head.landmarks68[k];

export const PINS = [
  // Eyes
  { name: "eyeOuterRight", label: "Right eye, outer corner", point: (h) => [PIE(h, 36)], frl: [18] },
  { name: "eyeInnerRight", label: "Right eye, inner corner", point: (h) => [PIE(h, 39)], frl: [22] },
  { name: "eyeInnerLeft", label: "Left eye, inner corner", point: (h) => [PIE(h, 42)], frl: [23] },
  { name: "eyeOuterLeft", label: "Left eye, outer corner", point: (h) => [PIE(h, 45)], frl: [27] },
  { name: "lidTopRight", label: "Right eye, top lid", point: (h) => [PIE(h, 37), PIE(h, 38)], frl: [20], group: "lids" },
  { name: "lidBottomRight", label: "Right eye, bottom lid", point: (h) => [PIE(h, 40), PIE(h, 41)], frl: [29], group: "lids" },
  { name: "lidTopLeft", label: "Left eye, top lid", point: (h) => [PIE(h, 43), PIE(h, 44)], frl: [25], group: "lids" },
  { name: "lidBottomLeft", label: "Left eye, bottom lid", point: (h) => [PIE(h, 46), PIE(h, 47)], frl: [32], group: "lids" },
  // Brows sit in the skin's colour, not its shape, so they pull gently.
  { name: "browOuterRight", label: "Right brow, outer end", point: (h) => [PIE(h, 17)], frl: [71], weight: 0.4 },
  { name: "browMiddleRight", label: "Right brow, top", point: (h) => [PIE(h, 19)], frl: [74], weight: 0.4 },
  { name: "browInnerRight", label: "Right brow, inner end", point: (h) => [PIE(h, 21)], frl: [76], weight: 0.4 },
  { name: "browInnerLeft", label: "Left brow, inner end", point: (h) => [PIE(h, 22)], frl: [77], weight: 0.4 },
  { name: "browMiddleLeft", label: "Left brow, top", point: (h) => [PIE(h, 24)], frl: [79], weight: 0.4 },
  { name: "browOuterLeft", label: "Left brow, outer end", point: (h) => [PIE(h, 26)], frl: [82], weight: 0.4 },
  // Nose
  { name: "noseBridge", label: "Bridge of the nose, between the eyes", point: (h) => [PIE(h, 27)], frl: [51, 57], weight: 0.6 },
  { name: "noseBottom", label: "Bottom of the nose, middle", point: (h) => [PIE(h, 33)], frl: [55] },
  { name: "nostrilRight", label: "Right nostril, outer edge", point: (h) => [PIE(h, 31)], frl: [63] },
  { name: "nostrilLeft", label: "Left nostril, outer edge", point: (h) => [PIE(h, 35)], frl: [68] },
  // Mouth
  { name: "mouthRight", label: "Right corner of the mouth", point: (h) => [PIE(h, 48)], frl: [87], group: "mouth" },
  { name: "mouthLeft", label: "Left corner of the mouth", point: (h) => [PIE(h, 54)], frl: [93], group: "mouth" },
  { name: "lipPeakRight", label: "Upper lip, right peak", point: (h) => [PIE(h, 50)], frl: [88], group: "mouth" },
  { name: "lipTop", label: "Upper lip, top middle", point: (h) => [PIE(h, 51)], frl: [90], group: "mouth" },
  { name: "lipPeakLeft", label: "Upper lip, left peak", point: (h) => [PIE(h, 52)], frl: [92], group: "mouth" },
  { name: "lipUpperInner", label: "Upper lip, bottom middle", point: (h) => [PIE(h, 62)], frl: [96], group: "mouth" },
  { name: "lipLowerInner", label: "Lower lip, top middle", point: (h) => [PIE(h, 66)], frl: [101], group: "mouth" },
  { name: "lipBottom", label: "Lower lip, bottom middle", point: (h) => [PIE(h, 57)], frl: [106], group: "mouth" },
  { name: "chin", label: "Bottom of the chin", point: (h) => [PIE(h, 8)], frl: [129] },
  // The jaw line: these slide along it, so only how far out or in the jaw runs is pinned.
  { name: "jawHighRight", label: "Right jaw, below the ear", curve: "jaw", frl: [125], weight: 0.7 },
  { name: "jawLowRight", label: "Right jaw, where the neck meets it", curve: "jaw", frl: [126], weight: 0.7 },
  { name: "jawRight", label: "Right jaw", curve: "jaw", frl: [127], weight: 0.7 },
  { name: "chinRight", label: "Right of the chin", curve: "jaw", frl: [128], weight: 0.7 },
  { name: "chinLeft", label: "Left of the chin", curve: "jaw", frl: [130], weight: 0.7 },
  { name: "jawLeft", label: "Left jaw", curve: "jaw", frl: [131], weight: 0.7 },
  { name: "jawLowLeft", label: "Left jaw, where the neck meets it", curve: "jaw", frl: [132], weight: 0.7 },
  { name: "jawHighLeft", label: "Left jaw, below the ear", curve: "jaw", frl: [133], weight: 0.7 },
  // Ears (often under hair: leave these out when they're hidden)
  { name: "earOuterRight", label: "Right ear, outer edge", outline: { region: "earRight", out: [-1, 0] }, frl: [117], weight: 0.5, group: "ears" },
  { name: "earTopRight", label: "Right ear, top", outline: { region: "earRight", out: [0, -1] }, frl: [115], weight: 0.5, group: "ears" },
  { name: "earLobeRight", label: "Right ear, bottom of the lobe", outline: { region: "earRight", out: [0, 1] }, frl: [119], weight: 0.5, group: "ears" },
  { name: "earOuterLeft", label: "Left ear, outer edge", outline: { region: "earLeft", out: [1, 0] }, frl: [122], weight: 0.5, group: "ears" },
  { name: "earTopLeft", label: "Left ear, top", outline: { region: "earLeft", out: [0, -1] }, frl: [120], weight: 0.5, group: "ears" },
  { name: "earLobeLeft", label: "Left ear, bottom of the lobe", outline: { region: "earLeft", out: [0, 1] }, frl: [124], weight: 0.5, group: "ears" },
];

// For a side photo (the person's left side shown, nose to the photo's left; mirrored for the right side).
export const SIDE_PINS = [
  { name: "noseTip", label: "Tip of the nose", point: (h) => [PIE(h, 30)] },
  { name: "noseBottom", label: "Bottom of the nose, middle", point: (h) => [PIE(h, 33)] },
  { name: "noseBridge", label: "Bridge of the nose, between the eyes", point: (h) => [PIE(h, 27)], weight: 0.6 },
  { name: "lipTop", label: "Upper lip, top middle", point: (h) => [PIE(h, 51)] },
  { name: "lipBottom", label: "Lower lip, bottom middle", point: (h) => [PIE(h, 57)] },
  { name: "chin", label: "Bottom of the chin", point: (h) => [PIE(h, 8)] },
  { name: "eyeOuter", label: "Outer corner of the eye", point: (h, side) => [PIE(h, side === "left" ? 45 : 36)] },
  { name: "mouthCorner", label: "Corner of the mouth", point: (h, side) => [PIE(h, side === "left" ? 54 : 48)], weight: 0.6 },
  { name: "earTop", label: "Top of the ear", outline: { region: "earSide", out: [0, -1] }, weight: 0.6 },
  { name: "earLobe", label: "Bottom of the ear lobe", outline: { region: "earSide", out: [0, 1] }, weight: 0.6 },
  { name: "earFront", label: "Front edge of the ear", outline: { region: "earSide", out: [-1, 0] }, weight: 0.5 },
  { name: "earBack", label: "Back edge of the ear", outline: { region: "earSide", out: [1, 0] }, weight: 0.5 },
  // The skull's outline. Under hair, place these on the scalp's line as best you can, or leave them out.
  { name: "forehead", label: "Forehead, outline", outline: { region: "profile", out: [-1, 0] }, weight: 0.6 },
  { name: "crown", label: "Top of the head, outline", outline: { region: "profile", out: [0, -1] }, weight: 0.5 },
  { name: "backOfHead", label: "Back of the head, outline", outline: { region: "profile", out: [1, 0] }, weight: 0.5 },
  { name: "nape", label: "Back of the neck, outline", outline: { region: "profile", out: [1, 0] }, weight: 0.4 },
  { name: "throat", label: "Front of the neck, outline", outline: { region: "profile", out: [-1, 0] }, weight: 0.4 },
];

// ICT's extended jaw lines (from the ICT-FaceKit README), joined through the bottom of the chin: person's right
// ear to chin to left ear. The right list runs ear to chin, the left one chin to ear.
const JAW_RIGHT = [1280, 1278, 1275, 1272, 1248, 12, 820, 1834, 1902, 243, 844, 781, 1673, 2199, 801, 1447, 800];
const JAW_LEFT = [3041, 3661, 3042, 4390, 3880, 3022, 3085, 2484, 4102, 4036, 3061, 2253, 3466, 3490, 3493, 3496, 3498];
export const CURVES = { jaw: [...JAW_RIGHT, 966, ...JAW_LEFT] };

// Vertex sets the outline pins search, found once from the head's own geometry.
export function regions(head) {
  if (head._regions) return head._regions;
  const P = head.positions;
  const FACE_END = 9409; // ICT's "Face" area: vertices [0, 9408]
  const earRight = [], earLeft = [], jaw = [], profile = [];
  for (let v = 0; v < head.skinVertexCount; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const ear = v < FACE_END && Math.abs(x) > 6.3 && y > -3.2 && y < 4.3 && z > -1.8 && z < 3;
    if (ear) (x < 0 ? earRight : earLeft).push(v);
    else if (z > -3 && y > -10 && y < 2) jaw.push(v);
    if (!ear) profile.push(v);
  }
  head._regions = { earRight, earLeft, jaw, profile, earSide: null };
  return head._regions;
}

export function regionFor(head, name, side) {
  const r = regions(head);
  if (name === "earSide") return side === "left" ? r.earLeft : r.earRight;
  return r[name];
}

// Model position of a point pin on given positions.
export function pointOf(pin, head, positions, side) {
  const ids = pin.point(head, side);
  const out = [0, 0, 0];
  for (const v of ids) for (let k = 0; k < 3; k++) out[k] += positions[v * 3 + k] / ids.length;
  return out;
}

// Pins from a Face Research Lab .tem file (text: count, then "x y" lines).
export function pinsFromTem(text) {
  const lines = text.trim().split(/\r?\n/);
  const n = parseInt(lines[0], 10);
  return pinsFromPoints(lines.slice(1, 1 + n).map((l) => l.trim().split(/\s+/).map(Number)));
}

// Pins from the 189 points of the Face Research Lab template, as [[x, y], ...].
export function pinsFromPoints(pts) {
  const out = {};
  for (const pin of PINS) {
    if (!pin.frl) continue;
    const ps = pin.frl.map((i) => pts[i]).filter(Boolean);
    if (ps.length !== pin.frl.length) continue;
    out[pin.name] = [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
  }
  return { pins: out, points: pts };
}
