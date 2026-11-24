"""Packs the ICT Face Model Light head into the small files the page loads.

Run:  python3 tools/pack_ict.py <ICT-FaceKit folder> data

Reads FaceXModel/generic_neutral_mesh.obj and the 53 ARKit expression meshes. Writes:
  data/ict-head.json   header: parts, offsets into the .bin, landmarks, expression names
  data/ict-head.bin    positions, UVs, triangles, expression deltas (little-endian)

The 100 identity shapes (identity000.obj ...) are left out on purpose: they are principal components learned
from scans, and this project fits faces with geometry only.

Units are ICT's: centimetres, y up, the face looking down +z, +x on the person's left.
"""
import json
import os
import struct
import sys

import numpy as np

# Polygon ranges from the ICT-FaceKit README (0-based, inclusive).
PARTS = [
    ("skin", 0, 11143, "Face, head and neck"),
    ("mouth", 11144, 13225, "Mouth socket"),
    ("eyeSocketL", 13226, 13629, "Eye socket (person's left)"),
    ("eyeSocketR", 13630, 14033, "Eye socket (person's right)"),
    ("gums", 14034, 17005, "Gums and tongue"),
    ("teeth", 17006, 21495, "Teeth"),
    ("scleraL", 21496, 22295, "Sclera, left"),
    ("irisL", 22296, 23093, "Iris, left"),
    ("scleraR", 23094, 23893, "Sclera, right"),
    ("irisR", 23894, 24691, "Iris, right"),
    ("lashesL", 25304, 25843, "Eyelashes, left"),
    ("lashesR", 25844, 26383, "Eyelashes, right"),
]
# Lacrimal fluid, eye blend and eye occlusion meshes are Unreal shader layers; not used.

MULTI_PIE_68 = [1225, 1888, 1052, 367, 1719, 1722, 2199, 1447, 966, 3661, 4390, 3927, 3924, 2608, 3272, 4088,
                3443, 268, 493, 1914, 2044, 1401, 3615, 4240, 4114, 2734, 2509, 978, 4527, 4942, 4857, 1140,
                2075, 1147, 4269, 3360, 1507, 1542, 1537, 1528, 1518, 1511, 3742, 3751, 3756, 3721, 3725, 3732,
                5708, 5695, 2081, 0, 4275, 6200, 6213, 6346, 6461, 5518, 5957, 5841, 5702, 5711, 5533, 6216,
                6207, 6470, 5517, 5966]

SKIN_VERTS = 11248  # Face [0:9408] and Head and Neck [9409:11247]


def read_obj(path, with_faces=False):
    v, vt, faces = [], [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif with_faces and line.startswith("vt "):
                vt.append([float(x) for x in line.split()[1:3]])
            elif with_faces and line.startswith("f "):
                corners = [t.split("/") for t in line.split()[1:]]
                faces.append(([int(c[0]) - 1 for c in corners], [int(c[1]) - 1 for c in corners]))
    return np.array(v, np.float64), np.array(vt, np.float64), faces


def main(src, out):
    model = os.path.join(src, "FaceXModel")
    V, VT, F = read_obj(os.path.join(model, "generic_neutral_mesh.obj"), with_faces=True)
    meta = json.load(open(os.path.join(model, "vertex_indices.json")))
    blob = bytearray()
    header = {
        "source": "ICT-FaceKit, ICT Face Model Light (MIT licence, Copyright (c) 2020 USC Institute for "
                  "Creative Technologies)",
        "units": "cm",
        "vertexCount": int(len(V)),
        "skinVertexCount": SKIN_VERTS,
        "parts": [],
        "expressions": [],
        "landmarks68": MULTI_PIE_68,
    }

    def put(array, kind):
        nonlocal blob
        while len(blob) % 4:  # keeps every array aligned for typed-array views
            blob.append(0)
        a = np.ascontiguousarray(array, dtype=kind)
        at = len(blob)
        blob += a.tobytes()
        return {"offset": at, "length": int(a.size)}

    header["positions"] = put(V.reshape(-1), np.float32)

    for name, first, last, about in PARTS:
        # Each render vertex is one (position, uv) pair, so seams in the UVs split vertices.
        keys, index, tris = {}, [], []
        for pv, pt in F[first:last + 1]:
            ids = []
            for vi, ti in zip(pv, pt):
                k = (vi, ti)
                if k not in keys:
                    keys[k] = len(index)
                    index.append(k)
                ids.append(keys[k])
            for j in range(1, len(ids) - 1):
                tris.append((ids[0], ids[j], ids[j + 1]))
        source = np.array([k[0] for k in index], np.uint32)
        uv = np.array([VT[k[1]] for k in index], np.float64)
        header["parts"].append({
            "name": name, "about": about,
            "source": put(source, np.uint32),
            "uv": put(uv.reshape(-1), np.float32),
            "triangles": put(np.array(tris, np.uint32).reshape(-1), np.uint32),
        })

    total = 0
    for name in meta["expressions"]:
        E, _, _ = read_obj(os.path.join(model, name + ".obj"))
        d = E - V
        moved = np.nonzero(np.abs(d).max(1) > 1e-3)[0]  # 0.01 mm
        total += len(moved)
        # Deltas as 16-bit steps of one scale per expression: under 0.002 mm of rounding for the largest moves.
        scale = float(np.abs(d[moved]).max()) / 32767
        header["expressions"].append({
            "name": name,
            "scale": scale,
            "index": put(moved.astype(np.uint16), np.uint16),
            "delta": put(np.round(d[moved] / scale).reshape(-1), np.int16),
        })

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "ict-head.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(out, "ict-head.json"), "w") as f:
        json.dump(header, f, indent=1)
    print(f"{len(V)} vertices, {len(header['parts'])} parts, {len(header['expressions'])} expressions "
          f"({total} moved vertices in all), {len(blob) / 1e6:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
