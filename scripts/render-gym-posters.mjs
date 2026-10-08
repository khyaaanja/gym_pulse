// Renders the landing film's still posters (public/gym/*.webp): what machines without a real GPU see instead of
// live WebGL. One per chapter, landscape and portrait, each at the lockout just after the rep's heartbeat.
//
// Needs the dev server (the scene's test hook is dev-only):  npx next dev -p 3100
// Then:  node scripts/render-gym-posters.mjs [http://localhost:3100]   (writes PNGs next to where the WebPs go)
// Then convert (the page loads the .webp files; ~25 KB each):
//   python3 -c "from PIL import Image; import glob, os; [ (Image.open(f).convert('RGB').save(f[:-4] + '.webp', 'WEBP', quality=68, method=6), os.remove(f)) for f in glob.glob('public/gym/*.png') ]"
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = "public/gym";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: "chrome" });
let pageRef;
for (const [shape, w, h, dpr] of [["landscape", 1440, 900, 1.12], ["portrait", 390, 844, 2]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  pageRef = p;
  await p.goto(`${BASE}/?gym=full`, { waitUntil: "load", timeout: 120000 });
  await p.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.__gym), null, { timeout: 120000 });
  // Named for lift and shot, as the page asks for them (a lift can come back from another angle).
  const DEFAULT_SHOT = { deadlift: "hero", row: "profile", curl: "close", press: "overhead", lockout: "low", squat: "wide" };
  const chapters = await p.evaluate(() => [...document.querySelectorAll("[data-gym-chapter]")].map((e) => [e.dataset.gymChapter, e.dataset.gymShot ?? "", e.getBoundingClientRect().top + scrollY]));
  for (const [lift, shot, y] of chapters) {
    const id = `${lift}-${shot || DEFAULT_SHOT[lift]}`;
    // The opening shot's poster is the opening loop's first frame (scripts/render-gym-loop.mjs): never overwrite it.
    if (id === "deadlift-hero") continue;
    // A dev server reloads the page whenever a source file changes; if that lands mid-shot, wait and shoot again.
    let url = null;
    for (let attempt = 0; attempt < 6 && !url; attempt++) {
      try {
        await p.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.__gym), null, { timeout: 120000 });
        await p.evaluate((y) => scrollTo(0, y), Math.max(0, y - h * 0.5 + 40));
        url = await shoot();
      } catch (e) {
        console.log(`  retry ${id} (${String(e.message).split("\n")[0]})`);
        await p.waitForLoadState("load").catch(() => {});
      }
    }
    if (!url) throw new Error(`could not render ${id}`);
    writeFileSync(`${OUT}/${id}-${shape}.png`, Buffer.from(url.split(",")[1], "base64"));
    console.log(shape, id);
  }
  await p.close();
}
await b.close();

async function shoot() {
  return pageRef.evaluate(() => {
      const g = [...document.querySelectorAll("div")].find((d) => d.__gym).__gym;
      // Let any change of lift finish (a carry can take several seconds), then settle into the set.
      for (let k = 0; k < 40 && g.st.trans; k++) g.advance(0.5);
      g.advance(1);
      // Just before the drive ends, then through it: the lockout, with the heartbeat flaring on the neon.
      const d = g.st.lift.rep.findIndex((s) => s.ease === "drive");
      g.st.repT = g.st.plan.durs.slice(0, d + 1).reduce((a, b) => a + b, 0) - 0.08;
      g.advance(0.3);
      return document.querySelector("canvas").toDataURL("image/png"); // same task as the draw: buffer still valid
  });
}
