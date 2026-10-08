#!/usr/bin/env node
/**
 * Panel-sized copies of the opening poster (public/gym/deadlift-hero-*-panel.webp), for the GymScene panels on the
 * dashboard and auth pages: a card-sized backdrop under text needs half the bytes of the full-screen still, and on a
 * slow phone those bytes decide when the card is painted. Re-run after scripts/render-gym-loop.mjs.
 */
import sharp from "sharp";

for (const [shape, width] of [["portrait", 420], ["landscape", 960]]) {
  const src = `public/gym/deadlift-hero-${shape}.webp`;
  const out = `public/gym/deadlift-hero-${shape}-panel.webp`;
  const info = await sharp(src).resize({ width }).webp({ quality: 60, effort: 6 }).toFile(out);
  console.log(`${out}: ${info.width}x${info.height}, ${info.size} bytes`);
}
