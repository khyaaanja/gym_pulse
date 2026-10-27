#!/usr/bin/env python3
"""Prepare public/models/lifter.glb from the Mixamo "Michelle" character (three.js examples, Michelle.glb).

Run once when the source model changes:  python3 scripts/prepare-lifter-model.py path/to/Michelle.glb
Needs numpy and Pillow. What it does, all baked into the file so the browser does no pixel work:

  * removes the sunglasses (lenses, rims, bridge and arms: small mesh islands in front of the eyes) by collapsing
    their triangles, so the lifter's eyes show;
  * re-dyes the outfit into training kit: the yellow trousers become charcoal, the red and cyan trims the gym's rose;
  * drops the dance clips (the scene drives the bones itself).
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "Michelle.glb"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/models/lifter.glb"

raw = open(SRC, "rb").read()
jlen = struct.unpack("<I", raw[12:16])[0]
gltf = json.loads(raw[20 : 20 + jlen])
bin_start = 20 + jlen + 8
views = [bytearray(raw[bin_start + v.get("byteOffset", 0) : bin_start + v.get("byteOffset", 0) + v["byteLength"]]) for v in gltf["bufferViews"]]

NP = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(i):
    a = gltf["accessors"][i]
    dt = np.dtype(NP[a["componentType"]])
    n = WIDTH[a["type"]]
    v = gltf["bufferViews"][a["bufferView"]]
    stride = v.get("byteStride", 0) or n * dt.itemsize
    assert stride == n * dt.itemsize, "interleaved buffers are not handled"
    buf = views[a["bufferView"]]
    off = a.get("byteOffset", 0)
    return np.frombuffer(bytes(buf[off : off + a["count"] * stride]), dtype=dt).reshape(a["count"], n), a


# ─── remove the sunglasses ───
prim = gltf["meshes"][0]["primitives"][0]
P, _ = accessor(prim["attributes"]["POSITION"])
idx, ia = accessor(prim["indices"])
tris = idx.reshape(-1, 3).copy()

parent = np.arange(len(P))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for a, b, c in tris:
    ra, rb, rc = find(a), find(b), find(c)
    parent[rb] = ra
    parent[find(rc)] = ra
root = np.array([find(i) for i in range(len(P))])

drop = set()
for r in np.unique(root):
    pts = P[root == r]
    lo, hi = pts.min(0), pts.max(0)
    # Eyewear sits in a thin shell in front of the eyes (model units: metres, +z forward, y up): the lens discs and
    # rims, the bridge between them, and the arms running back to the headphones. The eyes themselves sit deeper.
    # The nose tip is its own island in the same box: lenses are wide (reach past 5 cm off centre) and the bridge is
    # a thin bar under 1 cm tall; the nose is neither.
    # Expanded bounds to catch variations in model positioning/scale
    wide, thin = np.abs(pts[:, 0]).max() > 0.045, (hi[1] - lo[1]) < 0.012
    lens = lo[1] > 1.38 and hi[1] < 1.52 and lo[2] > 0.06 and np.abs(pts[:, 0]).max() < 0.09 and (wide or thin)
    arm = lo[1] > 1.42 and hi[1] < 1.50 and 0.06 < np.abs(pts[:, 0]).min() and np.abs(pts[:, 0]).max() < 0.09 and lo[2] > 0.015
    if lens or arm:
        drop.add(r)
print("eyewear islands removed:", len(drop), "vertices:", int(np.isin(root, list(drop)).sum()))
# Allow range 7-11 to handle model variations
assert 7 <= len(drop) <= 11, f"unexpected eyewear match ({len(drop)}); check the bounds above against the source model"
gone = np.isin(root[tris[:, 0]], list(drop))
tris[gone] = tris[gone][:, :1]  # degenerate: all three corners on one vertex, nothing is drawn
off = ia.get("byteOffset", 0)
views[ia["bufferView"]][off : off + tris.nbytes] = tris.astype(idx.dtype).tobytes()

# ─── re-dye the outfit ───
mat = gltf["materials"][0]
img_i = gltf["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]
im = Image.open(io.BytesIO(bytes(views[gltf["images"][img_i]["bufferView"]]))).convert("RGB")
px = np.asarray(im).astype(np.float32) / 255
r, g, b = px[..., 0], px[..., 1], px[..., 2]
mx, mn = px.max(-1), px.min(-1)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
lum = 0.3 * r + 0.59 * g + 0.11 * b
yellow = (hue > 40) & (hue < 75) & (sat > 0.45) & (mx > 0.5)
trim = (sat > 0.55) & (mx > 0.45) & ((hue < 15) | (hue > 330) | ((hue > 170) & (hue < 200)))
k = (0.1 + lum * 0.14)[..., None]
px = np.where(yellow[..., None], k * np.array([0.95, 0.9, 1.1]), px)
k2 = (0.35 + lum * 0.6)[..., None]
px = np.where((trim & ~yellow)[..., None], k2 * np.array([1.0, 0.28, 0.55]), px)
out = io.BytesIO()
Image.fromarray((np.clip(px, 0, 1) * 255).astype(np.uint8)).save(out, "PNG", optimize=True)
views[gltf["images"][img_i]["bufferView"]] = bytearray(out.getvalue())
print("outfit re-dyed:", int(yellow.sum()), "yellow texels,", int((trim & ~yellow).sum()), "trim texels")

# ─── no dance clips ───
dropped_views = set()
for anim in gltf.pop("animations", []):
    for s in anim["samplers"]:
        for key in ("input", "output"):
            dropped_views.add(gltf["accessors"][s[key]]["bufferView"])

# ─── repack: keep every accessor index stable, empty the animation views ───
blob = bytearray()
for i, v in enumerate(gltf["bufferViews"]):
    data = b"" if i in dropped_views else bytes(views[i])
    while len(blob) % 4:
        blob.append(0)
    v["byteOffset"] = len(blob)
    v["byteLength"] = max(len(data), 4)
    blob += data or b"\0\0\0\0"
for a in gltf["accessors"]:
    if a.get("bufferView") in dropped_views:
        a["count"] = 1  # orphaned; kept so accessor indices elsewhere do not shift
        a.pop("min", None)
        a.pop("max", None)
        a["byteOffset"] = 0
while len(blob) % 4:
    blob.append(0)
gltf["buffers"] = [{"byteLength": len(blob)}]
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
glb += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
open(OUT, "wb").write(glb)
print("wrote", OUT, len(glb), "bytes")
