#!/usr/bin/env node
/**
 * Shrinks the lifter model for the wire:  node scripts/optimize-lifter-model.mjs <in.glb> [out.glb]
 * Run on the output of prepare-lifter-model.py (never on an already optimised file: WebP would be re-encoded).
 *
 *  * drops the glossiness map the scene never uses (gym-lifter.ts authors roughness itself);
 *  * re-encodes the textures as WebP (EXT_texture_webp);
 *  * quantizes the vertex data (KHR_mesh_quantization) and packs it with meshopt (EXT_meshopt_compression),
 *    which the scene decodes with three's MeshoptDecoder.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, prune, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const [src, out = "public/models/lifter.glb"] = process.argv.slice(2);
if (!src) {
  console.error("usage: node scripts/optimize-lifter-model.mjs <in.glb> [out.glb]");
  process.exit(1);
}
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(src);

let dropped = 0;
for (const m of doc.getRoot().listMaterials()) {
  if (m.getMetallicRoughnessTexture()) {
    m.setMetallicRoughnessTexture(null);
    dropped++;
  }
}
if (dropped !== 1) throw new Error(`expected to drop one glossiness map, dropped ${dropped}`);

await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
await io.write(out, doc);
console.log(`wrote ${out}`);
