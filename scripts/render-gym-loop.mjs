// Renders the landing film's loops and posters (public/gym): every chapter's shot as one rep of its lift that loops
// seamlessly into the next, and each chapter's poster from its loop's first frame, so the still-to-video handoff never
// jumps. The opening shot's loop sits in the server HTML over its poster and autoplays without any script, so the stage
// is moving within a second of the first paint on every device, long before three.js can take over; the other chapters'
// loops are the poster film's (machines that can't run the live film), so it moves in every chapter too.
//
// Needs the dev server (the scene's test hook is dev-only):  npx next dev -p 3100
// Then:  node scripts/render-gym-loop.mjs [http://localhost:3100]
// Then:  node scripts/make-panel-posters.mjs   (the opening poster's panel copies)
// Needs ffmpeg with libsvtav1 and libx264 on PATH, and Python with Pillow (for the loop seam).
//
// Frames are rendered at a pinned pixel ratio (the dev hook's ratio(): a slow GPU's calibration must not shrink them):
// portrait at 2x a 390 px phone (780×1688), so a 3x phone screen upscales it by 1.5 at most. Each chapter loop is
// encoded twice: AV1 at that size (for devices that decode it in hardware, see av1Smooth in gym-scene.tsx), and H.264
// for the rest, portrait at 1.5x. The opening is H.264 only. Measured on the opening against the 2x frames (SSIM, as a 3x phone shows it): AV1
// 2x 0.991 at ~110 KB, H.264 1.5x 0.981 at ~100 KB; the old 1.5x VP9 was 0.968 at ~120 KB, and VP9 at any size here
// lost to H.264 at the same bytes, so it is no longer made.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const FPS = 30;
// Frames rendered past the end and dissolved into the start, so the last frame runs straight into the first.
const SEAM = 12;
const OPENING = "deadlift-hero";
const DEFAULT_SHOT = { deadlift: "hero", row: "profile", curl: "close", press: "overhead", lockout: "low", squat: "wide" };
// Posters are what the first paint shows for a moment before the loop takes over: 1.5x is plenty, and half the bytes.
const POSTER_WIDTH = { portrait: 585, landscape: 1280 };
const work = mkdtempSync(join(tmpdir(), "gym-loop-"));
// Frames are ~1.5 MB each: never leave them behind, even when a step fails.
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
// A real GPU makes this a few minutes; software GL works too, just slower.
const b = await chromium.launch({ channel: "chrome", args: ["--enable-gpu", "--ignore-gpu-blocklist"] });

for (const [shape, w, h, ratio] of [["landscape", 1440, 900, 1280 / 1440], ["portrait", 390, 844, 2]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: ratio });
  await p.goto(`${BASE}/?gym=full`, { waitUntil: "load", timeout: 120000 });
  // The film's shaders compiled: until then a step draws nothing, and the first chapter's frames came out black.
  await p.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.__gym?.ready()), null, { timeout: 120000 });
  const chapters = await p.evaluate(() => [...document.querySelectorAll("[data-gym-chapter]")].map((e) => [e.dataset.gymChapter, e.dataset.gymShot ?? "", e.getBoundingClientRect().top + scrollY]));
  const done = new Set();
  for (const [lift, shot, y] of chapters) {
    const id = `${lift}-${shot || DEFAULT_SHOT[lift]}`;
    if (done.has(id)) continue;
    done.add(id);
    await p.evaluate((y) => scrollTo(0, y), Math.max(0, y - h * 0.5 + 40));
    const n = await p.evaluate(({ FPS, SEAM, ratio, opening, lift }) => {
      const g = [...document.querySelectorAll("div")].find((d) => d.__gym).__gym;
      // Park the live loop: only these steps draw, and capture stalls can't trip its quality step-down.
      g.park();
      g.ratio(ratio);
      g.grain(0); // grain is noise to a video codec: it doubles the bytes and the codec smears it anyway
      // A locked-off camera: handheld drift moves every pixel of every frame, which costs the codec most of its bytes.
      // The page's slow CSS drift (on the poster and the loop alike) keeps the frame alive instead.
      g.steady(true);
      // Let the change to this chapter's lift happen and finish: it waits for the rep under way, then the carry can take
      // several seconds. (Waiting only while a carry was under way, right after the scroll, waited for nothing, and two
      // loops took the previous lift's rep length.) Then settle into the set and the shot.
      for (let k = 0; k < 120 && (g.st.trans || g.st.lift.id !== lift); k++) g.advance(0.5);
      if (g.st.trans || g.st.lift.id !== lift) throw new Error(`still on ${g.st.lift.id}, not ${lift}`);
      g.advance(3);
      // Every rep the same (fatigue pinned), so the loop is a whole rep that repeats. Start 0.22 s past the drive, where
      // the page's film expects the opening loop to be (it syncs to it as it crossfades in): run up to it through the
      // drive, so the lockout's heartbeat is on the neon.
      if (opening) g.openLoop(-0.3);
      else {
        const st = g.st;
        st.repN = 1;
        st.plan = g.rig.repPlan(st.lift, 1);
        const d = st.lift.rep.findIndex((s) => s.ease === "drive");
        st.repT = st.plan.durs.slice(0, d + 1).reduce((a, x) => a + x, 0) + 0.22 - 0.3;
        st.rep = null;
      }
      g.advance(0.3);
      window.__loop = { g, step: 1 / FPS };
      return Math.round(g.st.plan.total * FPS) + SEAM;
    }, { FPS, SEAM, ratio, opening: id === OPENING, lift });
    const dir = join(work, `${id}-${shape}`);
    mkdirSync(dir);
    for (let i = 0; i < n; i++) {
      const url = await p.evaluate((first) => {
        const { g, step } = window.__loop;
        if (!first) {
          g.st.repN = 0; // the next rep's plan is repPlan(lift, 1) again
          g.advance(step, step);
        } else g.advance(0, step);
        return document.querySelector("canvas").toDataURL("image/png"); // same task as the draw: buffer still valid
      }, i === 0);
      writeFileSync(join(dir, `${String(i).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }

    // The seam: the first SEAM frames dissolve from the frames rendered past the end into the start. The poster is the
    // seamed first frame, so the loop takes over from it without a jump.
    const body = n - SEAM;
    execFileSync("python3", ["-c", `
import sys
from PIL import Image
d, body, seam, poster, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5])
f = lambda i: f"{d}/{i:04d}.png"
for j in range(seam):
    a, b = Image.open(f(body + j)).convert("RGB"), Image.open(f(j)).convert("RGB")
    Image.blend(a, b, (j + 1) / (seam + 1)).save(f(j))
# Every frame lit: a blank or dark capture (a step that drew nothing) would play as a flash of black every rep.
from PIL import ImageStat
lum = [sum(ImageStat.Stat(Image.open(f(i)).convert("RGB").resize((64, 128))).mean) / 3 for i in range(body)]
med = sorted(lum)[len(lum) // 2]
dark = [i for i, l in enumerate(lum) if l < 0.35 * med]
if dark: sys.exit(f"{d}: frames {dark[:5]}... are dark ({min(lum):.0f} against a median of {med:.0f})")
first = Image.open(f(0)).convert("RGB")
first.resize((width, round(first.height * width / first.width)), Image.LANCZOS).save(poster, "WEBP", quality=68, method=6)
`, dir, String(body), String(SEAM), `public/gym/${id}-${shape}.webp`, String(POSTER_WIDTH[shape])]);

    // Panel copies (card backdrops on the dashboard and auth pages) exist for the opening shot only.
    const sizes = id === OPENING ? [["", 0], ["-panel", shape === "landscape" ? 960 : 420]] : [["", 0]];
    for (const [suffix, width] of sizes) {
      const out = `public/gym/${id}-loop-${shape}${suffix}`;
      const input = (w) => ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%04d.png"), "-frames:v", String(body), "-an", "-vf", `${w ? `scale=${w}:-2:flags=lanczos,` : ""}crop=trunc(iw/2)*2:trunc(ih/2)*2`, "-pix_fmt", "yuv420p"];
      const h264 = width || (shape === "portrait" ? 586 : 0);
      // The opening is H.264 only (see OpeningLoop: it is the first motion, one download on every device).
      if (id !== OPENING) execFileSync("ffmpeg", [...input(width), "-c:v", "libsvtav1", "-crf", "50", "-preset", "4", "-g", String(body), "-svtav1-params", "tune=0:progress=0", "-movflags", "+faststart", `${out}-av1.mp4`], { stdio: ["ignore", "ignore", "inherit"] });
      execFileSync("ffmpeg", [...input(h264), "-c:v", "libx264", "-crf", "32", "-preset", "veryslow", "-tune", "film", "-profile:v", "high", "-level:v", "4.0", "-movflags", "+faststart", `${out}.mp4`]);
      console.log(`${out}: ${n} frames`, ...(id === OPENING ? [".mp4"] : ["-av1.mp4", ".mp4"]).map((ext) => `${ext} ${Math.round(statSync(`${out}${ext}`).size / 1024)} KB`));
    }
    rmSync(dir, { recursive: true, force: true });
  }
  await p.close();
}
await b.close();
