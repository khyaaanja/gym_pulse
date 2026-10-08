// Renders the landing film's opening loop (public/gym/deadlift-hero-loop-*.{webm,mp4}): the live film's opening shot,
// one deadlift rep that loops seamlessly into the next. It sits in the server HTML over the opening poster and autoplays without
// any script, so the stage is moving within a second of the first paint on every device — long before three.js
// (or, on machines without a real GPU, the poster film) can take over.
//
// Needs the dev server (the scene's test hook is dev-only):  npx next dev -p 3100
// Then:  node scripts/render-gym-loop.mjs [http://localhost:3100]
// Needs ffmpeg with libvpx-vp9 and libx264 on PATH, and Python with Pillow (for the loop seam).
// Also rewrites the opening posters (deadlift-hero-{landscape,portrait}.webp) from the loop's first frame, so the
// poster-to-video handoff is invisible: re-run scripts/make-panel-posters.mjs afterwards.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const FPS = 30;
const REPS = 1;
// Frames rendered past the end and dissolved into the start, so the last frame runs straight into the first.
const SEAM = 12;
const work = mkdtempSync(join(tmpdir(), "gym-loop-"));
// Frames are ~1.5 MB each: never leave them behind, even when a step fails.
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
// A real GPU makes this a minute; software GL works too, just slower.
const b = await chromium.launch({ channel: "chrome", args: ["--enable-gpu", "--ignore-gpu-blocklist"] });

for (const [shape, w, h, dpr] of [["landscape", 1440, 900, 1280 / 1440], ["portrait", 390, 844, 1.5]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await p.goto(`${BASE}/?gym=full`, { waitUntil: "load", timeout: 120000 });
  await p.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.__gym), null, { timeout: 120000 });
  // Set up exactly as the opening poster is shot: lights on, settled into the set, just past the lockout.
  const n = await p.evaluate(({ FPS, REPS, SEAM }) => {
    const g = [...document.querySelectorAll("div")].find((d) => d.__gym).__gym;
    // Park the live loop: only these steps draw, and capture stalls can't trip its quality step-down and shrink the
    // canvas mid-shot.
    g.park();
    g.grain(0);
    // A locked-off camera: handheld drift moves every pixel of every frame, which costs the codec most of its bytes.
    // The page's slow CSS drift (on the poster and the loop alike) keeps the frame alive instead.
    g.steady(true); // grain is noise to a video codec: it doubles the bytes and the codec smears it anyway
    for (let k = 0; k < 40 && g.st.trans; k++) g.advance(0.5);
    g.advance(3);
    // Every rep the same (fatigue pinned), so the loop's length is a whole number of identical reps. Start where the
    // page's film expects the loop to start (it syncs to the loop as it crossfades in): run up to it through the drive,
    // so the lockout's heartbeat is on the neon.
    g.openLoop(-0.3);
    g.advance(0.3);
    window.__loop = { g, step: 1 / FPS };
    return Math.round((REPS * g.st.plan.total) * FPS) + SEAM;
  }, { FPS, REPS, SEAM });
  const dir = join(work, shape);
  mkdirSync(dir);
  for (let i = 0; i < n; i++) {
    const url = await p.evaluate((first) => {
      const { g, step } = window.__loop;
      if (!first) {
        g.st.repN = 0; // the next rep's plan is repPlan(lift, 1) again
        g.advance(step, step);
      } else g.advance(0, step);
      return document.querySelector("canvas").toDataURL("image/png");
    }, i === 0);
    writeFileSync(join(dir, `${String(i).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
  }
  await p.close();
  console.log(shape, `${n} frames`);

  // The seam: the first SEAM frames dissolve from the frames rendered past the end into the start.
  const body = n - SEAM;
  execFileSync("python3", ["-c", `
import sys
from PIL import Image
d, body, seam = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
f = lambda i: f"{d}/{i:04d}.png"
for j in range(seam):
    a, b = Image.open(f(body + j)).convert("RGB"), Image.open(f(j)).convert("RGB")
    Image.blend(a, b, (j + 1) / (seam + 1)).save(f(j))
`, dir, String(body), String(SEAM)]);

  // Full size for the page's stage; panel size (card backdrops on the dashboard and auth pages, like the panel
  // posters, and at the same sizes): about two thirds of the bytes.
  for (const [suffix, width] of [["", 0], ["-panel", shape === "landscape" ? 960 : 420]]) {
    const out = `public/gym/deadlift-hero-loop-${shape}${suffix}`;
    const fit = width ? `scale=${width}:-2,` : "";
    const input = ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%04d.png"), "-frames:v", String(body), "-an", "-vf", `${fit}crop=trunc(iw/2)*2:trunc(ih/2)*2`, "-pix_fmt", "yuv420p"];
    execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "46", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", "-g", String(body), `${out}.webm`]);
    execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-crf", "32", "-preset", "veryslow", "-tune", "film", "-profile:v", "high", "-level:v", "4.0", "-movflags", "+faststart", `${out}.mp4`]);
    for (const ext of ["webm", "mp4"]) console.log(`  ${out}.${ext}: ${statSync(`${out}.${ext}`).size} bytes`);
  }

  // The opening poster is the loop's first frame, so the video takes over from it without a jump.
  execFileSync("python3", ["-c", `
import sys
from PIL import Image
Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", quality=68, method=6)
`, join(dir, "0000.png"), `public/gym/deadlift-hero-${shape}.webp`]);
  rmSync(dir, { recursive: true, force: true });
}
await b.close();
