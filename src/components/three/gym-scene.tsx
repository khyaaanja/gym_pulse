"use client";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type * as T from "three";
import { LIFTER_URL, LIFTS, LIFT_ORDER, NODES, BODY, MAX_REP_RATE, SET_REPS, planPath, pathAt, poseOf, poseOfKey, repAt, repPlan, repPose, route, setOpening, solve, sway, type Lift, type Path, type Pose, type RepPlan, type RepState, type V3 } from "./gym-rig";

/**
 * The signature 3D moment: a lifter under one hard light in a night-time strength gym, moving through a real
 * session — deadlift, row, curl, press, overhead hold, squat.
 *
 * `mode="page"` is a fixed, full-viewport stage behind the whole page. Page scroll is the director: every element
 * marked `data-gym-chapter="<lift>"` (optionally `data-gym-shot="<shot>"`) is a chapter, the camera glides between
 * chapter shots as you scroll, the athlete changes lift at each chapter, and scrolling faster pumps the reps.
 * `mode="panel"` fills its container and runs the session on its own, with a slow orbiting camera.
 *
 * Fast first frame on every device and browser: the opening shot is server-rendered as a poster (a plain <picture>
 * with the same slow drift the poster film uses), so the stage is lit at first paint, before any script runs. Over it
 * sits the same shot as a short video loop (one rep, made by scripts/render-gym-loop.mjs, whose first frame is the
 * poster), which autoplays straight from the HTML: the lifter is moving within a second of the first paint, long
 * before three.js could be. The live film downloads in parallel (the model right away, three.js once the main
 * thread is free), compiles its shaders off the critical path, then crossfades in over the loop.
 *
 * Deliberately careful: three.js loads only on the client and only once the page is idle, the loop pauses when
 * hidden or off screen, and quality steps down on its own if frames run long. It runs on every device, phones and
 * reduced-motion settings included.
 * Machines without a real GPU (software GL, where every frame and every shader compile runs on the CPU and would
 * freeze the page) and machines without WebGL never load three.js at all: they get the poster film, pre-rendered loops
 * of the same shots (public/gym, made by scripts/render-gym-loop.mjs), crossfading as you scroll.
 */

export type GymShot = "hero" | "mirror" | "profile" | "overhead" | "low" | "close" | "wide" | "orbit";
/** What the set card shows. `cue` is the coaching cue for the moment of the rep (brace, drive, lock out…); `live` is
 *  false when the film is running as still posters, where there are no reps to count. */
export type GymRepEvent = { lift: string; liftName: string; rep: number; chapter: number; chapters: number; cue?: string; live?: boolean };
export const GYM_REP_EVENT = "gympulse:rep";

/** `priority`: the stage is above the fold wherever it renders, so its opening poster is fetched eagerly at high
 *  priority (a panel otherwise loads it lazily, in case it sits in a column that is hidden on this screen). */
export function GymScene({ mode = "panel", className, label = "", priority = mode === "page" }: { mode?: "page" | "panel"; className?: string; label?: string; priority?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  // "bridge": the live film is on its way and the poster film holds the reader's chapter meanwhile; "posters": the
  // poster film is the film; "live": the live film is on screen.
  const [phase, setPhase] = useState<Phase>("bridge");
  // The poster film reads the window as it mounts: client only, from hydration on.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // A stage with no box (the auth panel is display:none on phones) downloads and runs nothing until it gets one.
    if (el.clientWidth && el.clientHeight) return start(el, mode, setPhase);
    let stop = () => {};
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      ro.disconnect();
      stop = start(el, mode, setPhase);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      stop();
    };
  }, [mode]);

  return (
    <div ref={host} className={className} role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <OpeningPoster mode={mode} priority={priority} />
      <OpeningLoop mode={mode} autoPlay={priority} />
      {/* A panel has one shot, which the opening loop already holds (drift included): only the page needs the
          poster film's chapter crossfades. Until the live film is on, it also holds the reader's chapter: a page
          refreshed half-way down must not open on the first chapter's shot. */}
      {mode === "page" && hydrated && phase !== "live" && <Posters host={host} bridge={phase === "bridge"} />}
    </div>
  );
}

type Phase = "bridge" | "posters" | "live";
const noop = () => () => {};

/** Runs the stage in `el`: posters where the film can't run well, the live film everywhere else. Returns its cleanup. */
function start(el: HTMLDivElement, mode: "page" | "panel", setPhase: (p: Phase) => void): () => void {
  if (mode === "page") void av1Smooth(); // the chapter loops' codec, answered before any of them is wanted
  // A loop that didn't autoplay from the HTML (a panel that might have been hidden) starts now the stage has a box.
  playLoop(el);
  let rest = 0;
  const toPosters = () => {
    setPhase("posters");
    // A panel has no poster film to hand over to: on a machine without a real GPU its loop (decoded on the CPU) plays
    // three reps, then rests on its last frame.
    if (mode === "panel") rest = window.setTimeout(() => restAtEnd(el), 3 * LOOP_SECONDS * 1000);
  };
  const tier = gpuTier();
  if (tier === "software" || tier === "none") {
    // The probe needs a browser canvas, so it can't run during render; switch on the next frame.
    const r = requestAnimationFrame(toPosters);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(rest);
      cancelLoopRetry(el);
    };
  }
  let disposed = false;
  let cleanup = () => {};
  // The model is only bytes on the wire: start it now, so it lands alongside three.js instead of after it.
  const ac = new AbortController();
  const body = fetch(LIFTER_URL, { signal: ac.signal })
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);
  // Parsing three.js waits for a free main thread (hydration and the reader's first click come first), but never
  // long: on a busy phone the idle callback might otherwise not come for seconds.
  const idle = new Promise<void>((r) => ("requestIdleCallback" in window ? window.requestIdleCallback(() => r(), { timeout: 500 }) : setTimeout(r, 200)));
  void idle
    .then(() => {
      if (disposed) return Promise.reject(new Error("unmounted"));
      if (!forcedLive() && tier !== "named" && !gpuKeepsUp()) {
        // A software renderer behind a masked name (Safari and Firefox report a generic GPU): posters, no download.
        ac.abort();
        toPosters();
        return Promise.reject(new Error("slow gpu"));
      }
      return load();
    })
    .then(async (mods) => {
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-display-face").trim() || "Archivo, sans-serif";
      const [, gltf] = await Promise.all([
        document.fonts?.load(`900 200px ${family}`).catch(() => undefined),
        // The lifter's body. Without it the scene still runs, with the built-in figure standing in.
        body.then((buf) => (buf ? new mods[8].GLTFLoader().setMeshoptDecoder(mods[12].MeshoptDecoder).parseAsync(buf, "") : null)).catch(() => null),
      ]);
      const gone = () => disposed || !el.isConnected;
      if (gone()) return;
      cleanup = await mount(mods, el, {
        mode,
        family,
        gltf,
        gone,
        // The probes can still be fooled (a GPU that fills fast but chokes on the full scene): if the film can't
        // hold a watchable frame rate, it never goes on and the posters run instead.
        onLive: () => setPhase("live"),
        onSlow: () => {
          cleanup();
          cleanup = () => {};
          toPosters();
        },
      });
    })
    // No WebGL, a chunk that failed to download, a model that won't parse: the poster film takes over (the bridge
    // alone fetches no neighbouring stills, so it must not be left standing in for the film).
    .catch((e: unknown) => {
      if (!disposed && !(e instanceof Error && e.message === "slow gpu")) toPosters();
    });
  return () => {
    disposed = true;
    ac.abort();
    clearTimeout(rest);
    cancelLoopRetry(el);
    cleanup();
  };
}
/** The opening shot, in the server HTML: painted with the page itself, before any script, in every browser. The
 *  preload scanner finds it at once; the live film (or the poster film) covers it when ready. */
function OpeningPoster({ mode, priority }: { mode: "page" | "panel"; priority: boolean }) {
  // Panels are card-sized: their copies are half the bytes (scripts/make-panel-posters.mjs).
  const src = (shape: "portrait" | "landscape") => `/gym/${OPENING}-${shape}${mode === "panel" ? "-panel" : ""}.webp`;
  return (
    <>
      {/* Hoisted into <head> by React, so the fetch starts before the (inlined) stylesheet is even parsed. */}
      {priority && <link rel="preload" as="image" href={src("portrait")} media={PORTRAIT} fetchPriority="high" />}
      {priority && <link rel="preload" as="image" href={src("landscape")} media={`not all and ${PORTRAIT}`} fetchPriority="high" />}
      <picture className="gym-opening">
        <source media={PORTRAIT} srcSet={src("portrait")} type="image/webp" />
        <img
          src={src("landscape")}
          alt=""
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          // Panels can sit in a hidden column (the auth panel on phones): lazy images there are never fetched.
          loading={priority ? undefined : "lazy"}
          // Panels are narrower than the shot: keep the lifter (right of centre in the opening frame) in view.
          className={`gym-poster absolute inset-0 size-full object-cover ${mode === "panel" ? "object-[63%_50%]" : ""}`}
        />
      </picture>
    </>
  );
}

/**
 * Some WebKit builds stall at a loop's wrap instead of looping: still "playing", but the time sits at the end (or at the
 * start, in a storm of seeks that never lands), and the lifter freezes mid-rep. Seeking back doesn't recover them;
 * reloading does (a loop's first frame is its poster's, so nothing jumps). But their media loader skips the HTTP cache
 * on load() and would fetch the whole file again every rep, so the first stall copies the file into memory once (one
 * more download) and every reload after that plays from the copy, with no network. Only a loop that has already played
 * through its start can stall this way, so a first load still buffering is never mistaken for one; where looping works
 * none of this runs. `unstick` goes back to the <source> list (and releases the copy); `stop` ends the watch.
 */
function recoverLoop(get: () => HTMLVideoElement | null, wanted: () => boolean = () => true) {
  let last = -1, played = false, failed = 0, copying = false;
  let copy: string | null = null;
  const unstick = () => {
    if (!copy) return;
    // On unmount React has already cleared the ref: the copy is still released.
    get()?.removeAttribute("src");
    URL.revokeObjectURL(copy);
    copy = null;
  };
  const restart = (v: HTMLVideoElement) => {
    played = false; // it must play through its start again before a stall can count
    v.load(); // also pauses it: it plays again only if it is still wanted
    if (wanted()) v.play().catch(() => undefined);
  };
  const watch = window.setInterval(() => {
    const v = get();
    if (!v || !v.loop || v.paused || !wanted() || document.hidden || copying) { last = -1; return; }
    const t = v.currentTime;
    if (t > 0.5) played = true;
    // Held at the wrap for a whole look: a storm of seeks can jitter it a few hundredths, a real wrap jumps a rep.
    const atWrap = t < 0.2 || (v.duration > 0 && t >= v.duration - 0.1);
    if (!played || last < 0 || Math.abs(t - last) > 0.15 || !atWrap) { last = t; return; }
    last = -1;
    if (copy) return restart(v);
    copying = true;
    const from = v.currentSrc;
    fetch(from)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        // Still the same video, and still wanted (not turned, unmounted, or paused meanwhile).
        if (get() !== v || v.currentSrc !== from || v.paused || !wanted()) return;
        copy = URL.createObjectURL(blob);
        v.src = copy; // an src attribute takes over from the <source> list
        restart(v);
      })
      // No copy: a plain reload (one more download). After three failures, no more fetches or reloads, and looping
      // goes off: left on, a stalled WebKit loop re-requests the file every rep by itself.
      .catch(() => {
        if (get() !== v) return; // gone meanwhile: nothing to restart
        if (++failed <= 2) restart(v);
        else v.loop = false;
      })
      .finally(() => { copying = false; });
  }, 400);
  return {
    unstick,
    stop: () => {
      window.clearInterval(watch);
      unstick();
    },
  };
}

/**
 * The opening shot, moving: one rep on a seamless loop, painted over the opening poster as soon as its first frame
 * decodes (that frame is the poster, so the handoff doesn't jump). No script: `autoPlay` + `muted` play it from the
 * HTML, on every device, reduced-motion settings included. H.264 only: every browser plays it in hardware, and it is
 * the first motion, so it must be one download. (AV1, sharper at the same bytes, is decided by script: listed first in
 * this HTML, a phone that decodes it in software would fetch it, then switch and fetch the H.264 too.)
 * `autoPlay` is off for a panel that may sit in a hidden column: the stage plays it once it has a box (start()).
 */
function OpeningLoop({ mode, autoPlay }: { mode: "page" | "panel"; autoPlay: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const stall = recoverLoop(() => ref.current);
    // A video picks its <source> once: on a turn between portrait and landscape, pick again (the poster under it
    // switches by itself), and carry on playing only if it was.
    const mq = window.matchMedia(PORTRAIT);
    const repick = () => {
      const v = ref.current;
      // Under the live film the loop is hidden for good: fetching the other shape would be wasted bytes.
      if (!v || v.parentElement?.hasAttribute("data-gym-live")) return;
      const playing = !v.paused;
      stall.unstick(); // back to the <source> list, so the new shape is picked
      v.load();
      if (playing) v.play().catch(() => undefined);
      else v.pause(); // also cancels `autoplay`, so a loop hidden under the film stays stopped
    };
    onChange(mq, repick);
    return () => {
      offChange(mq, repick);
      stall.stop();
    };
  }, []);
  // Panels are card-sized: their copies are smaller (as their posters are).
  const src = (shape: "portrait" | "landscape") => `/gym/${OPENING}-loop-${shape}${mode === "panel" ? "-panel" : ""}.mp4`;
  return (
    <video
      ref={ref}
      className={`gym-opening gym-loop gym-poster absolute inset-0 size-full object-cover ${mode === "panel" ? "object-[63%_50%]" : ""}`}
      autoPlay={autoPlay}
      muted
      loop
      playsInline
      preload={autoPlay ? "auto" : "none"}
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden
      tabIndex={-1}
    >
      <source media={PORTRAIT} src={src("portrait")} type={MP4} />
      <source src={src("landscape")} type={MP4} />
    </video>
  );
}
/** The loop's length: one rep of the deadlift (105 frames at 30 fps). */
const LOOP_SECONDS = 3.5;
/** The live film's starting pixel budget (CSS px x dpr², ~1080p at 1x) where its GPU can't be timed: see sizing in mount. */
const PX_BUDGET = 2.1e6;
/** The GPU time one frame of the live film is sized to (see calibration in mount): room left for the page's own. */
const FRAME_MS = 12;
/** The loops' encodings (scripts/render-gym-loop.mjs): AV1 at 2x for the chapter loops where it decodes smoothly in
 *  hardware (av1Smooth), sharper and no bigger; H.264 at 1.5x everywhere else, and for the opening. */
const AV1 = 'video/mp4; codecs="av01.0.08M.08"';
const MP4 = 'video/mp4; codecs="avc1.640028"';
/** AV1 only where it plays smoothly in hardware: Chrome lists it as playable everywhere, and a phone without an AV1
 *  decoder would decode the 2x loops in software, dropping frames and spending battery, where its H.264 is free.
 *  Asked once; until the answer (milliseconds) the <source> order stands. */
let av1Known: boolean | null = null;
let av1Asked: Promise<boolean> | null = null;
const av1Smooth = () =>
  (av1Asked ??= Promise.race([
    // No answer, an error or no API at all: H.264, which plays everywhere. Never more than 300 ms of waiting.
    navigator.mediaCapabilities?.decodingInfo({ type: "file", video: { contentType: AV1, width: 780, height: 1688, bitrate: 300_000, framerate: 30 } })
      .then((r) => r.supported && r.smooth && r.powerEfficient, () => false) ?? false,
    new Promise<boolean>((r) => setTimeout(() => r(false), 300)),
  ]).then((ok) => (av1Known = ok)));
const loopOf = (el: HTMLElement) => el.querySelector<HTMLVideoElement>("video.gym-opening");
/** Whether the stage still wants its opening loop playing: on the page, and not under the live film or a chapter still. */
const loopWanted = (el: HTMLElement) => el.isConnected && !el.hasAttribute("data-gym-live") && !el.hasAttribute("data-gym-posters");
/** Events that can count as a user gesture for media playback. A touch that only scrolled fires touchend but isn't
 *  one, so a refused retry keeps listening. */
const GESTURES = ["touchend", "pointerup", "click", "keydown"] as const;
/** One pending gesture retry per stage. */
const retries = new WeakMap<HTMLElement, AbortController>();
const cancelLoopRetry = (el: HTMLElement) => {
  retries.get(el)?.abort();
  retries.delete(el);
};
/**
 * Some phones refuse even muted autoplay (iOS in Low Power Mode, some battery savers) and ignore `autoplay` too: the
 * opening then sat on its poster with no motion at all. Their rule is "after a gesture", so retry on the reader's
 * taps and keys until a play succeeds or the loop is no longer wanted. The stage's cleanup cancels it (start()).
 */
function retryOnGesture(el: HTMLElement) {
  if (retries.has(el)) return;
  const ac = new AbortController();
  retries.set(el, ac);
  let trying = false;
  const retry = () => {
    const v = loopOf(el);
    if (!v || !loopWanted(el) || !v.paused) return cancelLoopRetry(el);
    if (trying) return;
    trying = true;
    // play() is called inside the handler, while the gesture still counts.
    v.play()
      .then(() => cancelLoopRetry(el))
      .catch(() => undefined) // still refused (that touch was a scroll): keep listening
      .finally(() => { trying = false; });
  };
  GESTURES.forEach((g) => window.addEventListener(g, retry, { capture: true, passive: true, signal: ac.signal }));
}
/** Play the stage's opening loop, retrying on the reader's next gesture where the browser refuses autoplay. */
const playLoop = (el: HTMLElement) => {
  const v = loopOf(el);
  if (!v?.paused) return;
  v.play().catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "NotAllowedError" && loopWanted(el)) retryOnGesture(el);
  });
};
const pauseLoop = (el: HTMLElement) => loopOf(el)?.pause();
/** Let the loop finish its current rep and rest on its last frame: looping off, so it plays to the end and stops there.
 *  (A timer alone can stop mid-rep where a rep runs long, as in a WebKit stall at the loop point: see OpeningLoop.) */
function restAtEnd(el: HTMLElement) {
  const v = loopOf(el);
  if (v) v.loop = false;
}

const PORTRAIT = "(max-aspect-ratio: 9/10)";
/** The opening shot (chapter one's lift and shot): its poster and its loop. */
const OPENING = "deadlift-hero";
/** MediaQueryList change listeners: Safari before 14 only has the old addListener API. */
const onChange = (mq: MediaQueryList, f: () => void) => (mq.addEventListener ? mq.addEventListener("change", f) : mq.addListener(f));
const offChange = (mq: MediaQueryList, f: () => void) => (mq.removeEventListener ? mq.removeEventListener("change", f) : mq.removeListener(f));

/** Dev builds: `?gym=full` forces the live film, so visual tests on software GL can still exercise it. */
const forcedLive = () => process.env.NODE_ENV !== "production" && new URLSearchParams(location.search).get("gym") === "full";

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;
/**
 * Probe once, before downloading anything: "software" and "none" get the posters; "gpu" runs the live film if the
 * fill test agrees (gpuKeepsUp); "named" is a hardware GPU the browser names in full (Chromium's "ANGLE (Intel, …)"),
 * trusted without the fill test. That test is a few milliseconds of real work on an idle GPU but 50-80 ms on the same
 * Intel iGPU while another tab or app draws, so it turned the film off at random on machines that run it well. The
 * screen test before the film goes on (judge, in mount) still catches a named GPU that can't keep up.
 */
function gpuTier(): "named" | "gpu" | "software" | "none" {
  if (forcedLive()) return "named";
  try {
    const c = document.createElement("canvas");
    const fast = (c.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ?? c.getContext("webgl", { failIfMajorPerformanceCaveat: true })) as WebGLRenderingContext | null;
    const gl = fast ?? (c.getContext("webgl2") as WebGLRenderingContext | null) ?? c.getContext("webgl");
    if (!gl) return "none";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // give the probe context back right away
    if (!fast || SOFTWARE_GL.test(name)) return "software";
    // Firefox reports a bucketed name ending ", or similar"; Safari just "Apple GPU": neither is trusted.
    return /^ANGLE \(/.test(name) && !/or similar/i.test(name) ? "named" : "gpu";
  } catch {
    return "none";
  }
}

/**
 * A few milliseconds of real GPU work, timed: the renderer name can't be trusted (Safari always says "Apple GPU",
 * Firefox a generic model), but a software rasteriser is 10-100x slower at fill. Eight 256×256 passes of a small
 * trig loop take ~1-5 ms on any real GPU, phones included, and 40-120 ms on SwiftShader / llvmpipe.
 */
function gpuKeepsUp(): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const gl = c.getContext("webgl", { antialias: false, depth: false });
    if (!gl) return false;
    const shader = (type: number, src: string) => {
      const x = gl.createShader(type)!;
      gl.shaderSource(x, src);
      gl.compileShader(x);
      return x;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}"));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, "precision mediump float;uniform float u;void main(){vec2 q=gl_FragCoord.xy*.01+u;float s=0.;for(int i=0;i<48;i++){q=vec2(sin(q.y*1.7+s),cos(q.x*1.3-s));s+=q.x*q.y;}gl_FragColor=vec4(fract(s),q,1.);}"));
    gl.linkProgram(p);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = gl.getUniformLocation(p, "u"), px = new Uint8Array(4);
    // One warm-up pass (the compile lands here, and compile speed says nothing about fill), then the timed passes.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // Best of two: a phone busy for a moment (decoding the opening loop, a GC) can blow one run on its own, and a
    // software rasteriser is just as slow both times.
    let ms = Infinity;
    for (let run = 0; run < 2 && ms >= 25; run++) {
      const t0 = performance.now();
      for (let i = 1; i <= 8; i++) {
        gl.uniform1f(u, i);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the passes to finish
      ms = Math.min(ms, performance.now() - t0);
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return ms < 25;
  } catch {
    return false;
  }
}

/**
 * The film as stills: each chapter's shot (its loop's first frame), crossfading as the reader moves between chapters, with a
 * slow drift (a compositor-only transform, no CPU) so the frame is never dead. Only the current and neighbouring
 * posters are fetched. The opening shot has no still of its own: the opening loop (moving) shows through for it.
 * The set card still names the lift, driven by the same chapter logic as the live film.
 */
function Posters({ host, bridge }: { host: React.RefObject<HTMLDivElement | null>; bridge: boolean }) {
  // One still per chapter, named for its lift and shot ("deadlift-hero"): a lift can return from another angle.
  const [ids, setIds] = useState<string[]>(["deadlift-hero"]);
  const [at, setAt] = useState(0);
  // Posters mount on the client only, so the first render can already pick the right shape (no wasted landscape
  // download on a phone).
  const [portrait, setPortrait] = useState(() => window.matchMedia(PORTRAIT).matches);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const mq = window.matchMedia(PORTRAIT);
    const shape = () => setPortrait(mq.matches);
    shape();
    onChange(mq, shape);
    let raf = 0, last = "", filmTalks = false;
    // As a bridge it names the chapter only until the live film (warming up underneath, already counting reps) does.
    const hear = (e: Event) => {
      if ((e as CustomEvent<GymRepEvent>).detail.live) filmTalks = true;
    };
    if (bridge) window.addEventListener(GYM_REP_EVENT, hear);
    const chapters = trackChapters();
    const read = () => {
      raf = 0;
      const els = chapters.els;
      const lifts = els.map((e) => (LIFTS[e.dataset.gymChapter ?? ""] ? e.dataset.gymChapter! : "deadlift"));
      const list = els.map((e, j) => `${lifts[j]}-${e.dataset.gymShot ?? DEFAULT_SHOT[lifts[j]!] ?? "hero"}`);
      const k = chapters.at().i;
      setIds((prev) => (prev.join() === list.join() ? prev : list));
      setAt(k);
      const lift = LIFTS[lifts[k] ?? "deadlift"]!;
      const key = `${lift.id}|${k}`;
      if (key !== last && !filmTalks) {
        last = key;
        const detail: GymRepEvent = { lift: lift.id, liftName: lift.name, rep: 0, chapter: k, chapters: Math.max(1, list.length), live: false };
        window.dispatchEvent(new CustomEvent(GYM_REP_EVENT, { detail }));
      }
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    // First read on the next frame, not now: the set card mounts after the stage, and an event sent before it listens
    // is lost (the card then stayed blank until the live film spoke, seconds later).
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      chapters.stop();
      offChange(mq, shape);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      window.removeEventListener(GYM_REP_EVENT, hear);
    };
  }, [bridge]);

  const suffix = portrait ? "portrait" : "landscape";
  const keyOf = (j: number) => `${j}-${ids[j]}-${suffix}`;
  // The opening is shown (and played) again only on the opening's chapter. Elsewhere it is hidden once the chapter's
  // still is up; until then the stage keeps what it had (straight from the opening, that is the loop).
  const opening = ids[at] === OPENING, ready = loaded.has(keyOf(at));
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (opening) {
      el.removeAttribute("data-gym-posters");
      playLoop(el);
      return;
    }
    if (!ready) return;
    // Once the still has faded in, the opening is hidden: no drift composited and no video decoded under it.
    const t = window.setTimeout(() => {
      el.setAttribute("data-gym-posters", "");
      pauseLoop(el);
    }, 500); // the poster's duration-400 fade, and a frame or two
    return () => clearTimeout(t);
  }, [opening, ready, host]);
  return (
    <>
      {ids.map((id, j) =>
        // The current chapter's still and its neighbours, ready to cross to; except a bridge at the opening (the usual
        // first load, with the live film about to take over), which fetches nothing. Each has its loop over it: only
        // the current one's plays (and downloads); the one just left keeps playing as it fades out, so it never pops
        // back to its still mid-rep.
        Math.abs(j - at) > (bridge && at === 0 ? 0 : 1) || id === OPENING ? null : (
          <Fragment key={keyOf(j)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed backdrop crossfade; next/image adds nothing here */}
            <img
              src={`/gym/${id}-${suffix}.webp`}
              alt=""
              decoding="async"
              fetchPriority={j === at ? "high" : "low"}
              onLoad={() => setLoaded((prev) => (prev.has(keyOf(j)) ? prev : new Set(prev).add(keyOf(j))))}
              className={`gym-poster absolute inset-0 size-full object-cover transition-opacity duration-400 ${j === at ? "opacity-100" : "opacity-0"}`}
            />
            <ChapterLoop id={id} suffix={suffix} active={j === at} />
          </Fragment>
        ),
      )}
    </>
  );
}

/** The still's or the loop's slow drift (globals.css). Not getAnimations()[0]: mid-crossfade that is the opacity fade. */
const driftOf = (e: Element) => e.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === "poster-drift");
/** Set once the browser refuses a loop's autoplay (iOS Low Power Mode, some battery savers). Such a browser unlocks each
 *  video only by its own play() inside a gesture (and a touch that scrolled isn't one): from then on every chapter loop
 *  on hand asks for the reader's next tap, the neighbours included, so the next chapter is ready when it comes. */
let autoplayRefused = false;
/** Loops already on hand when the refusal comes: they start listening for the tap then, not only those mounted after. */
const onRefused = new Set<() => void>();
const refuseAutoplay = () => {
  if (autoplayRefused) return;
  autoplayRefused = true;
  onRefused.forEach((f) => f());
};

/**
 * A chapter's still, moving: one rep of its lift on a seamless loop (scripts/render-gym-loop.mjs), whose first
 * frame is the still. It plays and fades in over the still while its chapter is current; when the reader moves on, it
 * fades out still playing, then pauses. Nothing downloads until it is first current (or unlocked by a gesture).
 */
function ChapterLoop({ id, suffix, active }: { id: string; suffix: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);
  // Its sources wait for the AV1 answer (see av1Smooth; asked as the stage starts, so it is in by now): listed before
  // it, a phone would pick AV1, fetch it, then switch and fetch the H.264 too.
  const [av1, setAv1] = useState(av1Known);
  const activeRef = useRef(active);
  const unlock = useRef<() => void>(() => {});

  // Mount: the gesture unlock and the WebKit stall watchdog.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const ac = new AbortController();
    let listening = false, unlocked = false, trying = false;
    const attempt = () => {
      if (unlocked || trying) return;
      trying = true;
      // Inside the gesture handler, while the gesture still counts.
      v.play()
        .then(() => {
          unlocked = true;
          ac.abort();
          if (!activeRef.current) v.pause();
        })
        .catch(() => undefined) // still refused (that touch was a scroll): keep listening
        .finally(() => { trying = false; });
    };
    unlock.current = () => {
      if (listening || unlocked) return;
      listening = true;
      GESTURES.forEach((g) => window.addEventListener(g, attempt, { capture: true, passive: true, signal: ac.signal }));
    };
    const listen = () => unlock.current();
    if (autoplayRefused) listen();
    else onRefused.add(listen);
    const stall = recoverLoop(() => v, () => activeRef.current); // one fading out is about to pause: never restarted
    void av1Smooth().then(setAv1); // also when the answer came between render and now: state may still be null
    return () => {
      onRefused.delete(listen);
      ac.abort();
      stall.stop();
    };
  }, []);

  // Current: play (it fades in once it does). Left: fade out while still playing, then pause.
  useEffect(() => {
    activeRef.current = active;
    const v = ref.current;
    if (!v || av1 === null) return; // no sources yet
    if (active) {
      v.preload = "auto";
      // Sources that arrived after it was created (the AV1 answer came late) are only picked up by a fresh load.
      if (v.networkState === v.NETWORK_EMPTY || v.networkState === v.NETWORK_NO_SOURCE) v.load();
      v.play().catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "NotAllowedError")) return;
        refuseAutoplay(); // this loop included
      });
      return;
    }
    // Faded out by `active` alone; once out of sight it pauses, and waits for its next play to be shown again. It resumes
    // where it paused, mid-rep, under a crossfade: seeking it back to its first frame stalled WebKit (GStreamer) in a
    // seek loop, the video never playing again.
    const t = window.setTimeout(() => {
      v.pause();
      setShown(false);
    }, 500); // the 400 ms fade, and a frame or two
    return () => clearTimeout(t);
  }, [active, av1]);

  return (
    <video
      ref={ref}
      className={`gym-loop gym-poster absolute inset-0 size-full object-cover transition-opacity duration-400 ${active && shown ? "opacity-100" : "opacity-0"}`}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden
      tabIndex={-1}
      onPlaying={(e) => {
        if (!activeRef.current) return; // a neighbour unlocked by a tap, or one fading out
        // In step with its still's drift, so the crossfade doesn't shift the frame.
        const still = e.currentTarget.previousElementSibling;
        const from = still && driftOf(still), to = driftOf(e.currentTarget);
        if (from && to) to.currentTime = from.currentTime;
        setShown(true);
      }}
    >
      {av1 && <source src={`/gym/${id}-loop-${suffix}-av1.mp4`} type={AV1} />}
      {av1 !== null && <source src={`/gym/${id}-loop-${suffix}.mp4`} type={MP4} />}
    </video>
  );
}

/**
 * The page's chapters ([data-gym-chapter]) and where the reader is among them. Their positions are kept in page
 * coordinates and measured again only when the layout changes (a ResizeObserver on the chapters and the page, whose
 * callbacks come after layout, so measuring there forces nothing): following the scroll reads only scrollY. Measured
 * every frame, they forced a style and layout pass into each frame of the film, and with the headlines' scroll-driven
 * animations restyling the page on every scrolled frame, that was the costliest part of the frame.
 */
function trackChapters() {
  let els: HTMLElement[] = [];
  let tops: number[] = [];
  let lastHeight = 0;
  const measure = () => {
    const y = window.scrollY;
    tops = els.map((e) => e.getBoundingClientRect().top + y);
    lastHeight = els.length ? els[els.length - 1]!.getBoundingClientRect().height : 0;
  };
  const ro = new ResizeObserver(measure);
  const refresh = () => {
    const now = Array.from(document.querySelectorAll<HTMLElement>("[data-gym-chapter]"));
    if (now.length === els.length && now.every((e, i) => e === els[i])) return;
    els = now;
    ro.disconnect();
    ro.observe(document.body);
    for (const e of els) ro.observe(e);
    measure();
  };
  // Chapters can arrive after the stage (content streamed in later) or be replaced.
  const mo = new MutationObserver(refresh);
  mo.observe(document.body, { childList: true, subtree: true });
  refresh();
  return {
    get els() {
      return els;
    },
    /** Chapter index plus progress to the next, measured at 55% of the viewport height. */
    at() {
      const n = els.length;
      if (!n) return { i: 0, f: 0 };
      const mid = window.scrollY + window.innerHeight * 0.55;
      let i = 0;
      for (let k = 0; k < n; k++) if (tops[k]! <= mid) i = k;
      if (i >= n - 1) return { i: n - 1, f: clamp((mid - tops[n - 1]!) / Math.max(lastHeight, 1)) };
      return { i, f: clamp((mid - tops[i]!) / Math.max(tops[i + 1]! - tops[i]!, 1)) };
    },
    stop() {
      mo.disconnect();
      ro.disconnect();
    },
  };
}

const load = () =>
  Promise.all([
    import("three"),
    import("three/examples/jsm/geometries/RoundedBoxGeometry.js"),
    import("three/examples/jsm/postprocessing/EffectComposer.js"),
    import("three/examples/jsm/postprocessing/RenderPass.js"),
    import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
    import("three/examples/jsm/postprocessing/OutputPass.js"),
    import("three/examples/jsm/postprocessing/ShaderPass.js"),
    import("three/examples/jsm/environments/RoomEnvironment.js"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    // The scene's own builders ride along, so machines on posters never download them either.
    import("./gym-world"),
    import("./gym-lifter"),
    import("./gym-athlete"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);
type Mods = Awaited<ReturnType<typeof load>>;

// ─────────────────────────────── camera shots ───────────────────────────────

/** `rise` (stacked phone layouts only) slides the athlete up (+) or down (−) the frame, as a fraction of its height,
 *  so the lifter sits clear of that chapter's copy instead of behind it. */
type Shot = { pos: V3; target: V3; fov: number; shift: number; drift: V3; rise?: number };
/** Camera placements around the platform (athlete at the origin, facing +z). `shift` slides the athlete across the
 *  frame (fraction of width, + = right) so the copy beside it keeps clear space; `drift` is how far the camera
 *  travels while you scroll through the chapter, so the image is never static under the reader. */
const SHOTS: Record<Exclude<GymShot, "orbit">, Shot> = {
  hero: { pos: [2.1, 0.8, 3.5], target: [0, 1.0, 0], fov: 36, shift: 0.22, drift: [-0.7, 0.25, -0.5], rise: -0.14 },
  // The hero from the lifter's other side, the athlete on the left of frame: for a chapter whose copy sits right.
  mirror: { pos: [-2.2, 0.95, 3.3], target: [0, 1.0, 0], fov: 36, shift: -0.22, drift: [0.6, 0.2, -0.4] },
  profile: { pos: [4.5, 1.25, 1.0], target: [0, 1.0, 0], fov: 36, shift: 0.18, drift: [-0.3, 0.2, 0.9] },
  overhead: { pos: [-2.2, 3.2, 2.5], target: [0, 0.9, 0], fov: 40, shift: 0, drift: [0.8, -0.3, 0.2] },
  low: { pos: [-3.1, 0.35, 1.8], target: [0, 1.2, -0.2], fov: 38, shift: 0.2, drift: [0.4, 0.15, 0.5] },
  close: { pos: [1.2, 1.45, 3.1], target: [0, 1.22, 0], fov: 34, shift: -0.24, drift: [-0.8, 0.12, 0.1] },
  wide: { pos: [0.4, 0.6, 5.0], target: [0, 1.1, -0.4], fov: 42, shift: -0.24, drift: [-0.3, 0.3, -0.9], rise: 0.2 },
};
const DEFAULT_SHOT: Record<string, keyof typeof SHOTS> = { deadlift: "hero", row: "profile", curl: "close", press: "overhead", lockout: "low", squat: "wide" };

// ─────────────────────────────── helpers ───────────────────────────────

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent approach: same feel at 30, 60 or 144 Hz. */
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

// ─────────────────────────────── scene ───────────────────────────────

/** Gives the page a frame: the next task after the next frame. */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * Builds the film in `el` and starts it. Built over three tasks, a frame apart, not one: as one it held the main
 * thread ~300 ms (~800 ms on a slow phone), and the opening loop playing over it froze for as long. If the stage is
 * `gone` at a break, what was built is thrown away.
 */
async function mount(mods: Mods, el: HTMLDivElement, opts: { mode: "page" | "panel"; family: string; gltf: import("three/examples/jsm/loaders/GLTFLoader.js").GLTF | null; gone: () => boolean; onLive: () => void; onSlow: () => void }): Promise<() => void> {
  const [THREE, { RoundedBoxGeometry }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }, { RoomEnvironment }, , { buildWorld }, { buildLifter }, { buildAthlete }] = mods;
  const page = opts.mode === "page";
  const small = Math.min(window.innerWidth, window.innerHeight) < 700 || window.matchMedia("(pointer: coarse)").matches;
  const Q = {
    // Panels are small card backdrops: they never need more than 1 CSS px per pixel.
    // Phones up to 2x (a 3x screen then upscales by 1.5 at most): calibration, or the screen test where the GPU can't be
    // timed (Safari), sizes it down before it shows on a GPU that can't fill that.
    // Bumped DPR floor on mobile to keep character animation sharp — 3x screens get full ratio,
    // 2x screens keep 2 but won't downsample as aggressively.
    dpr: Math.min(window.devicePixelRatio || 1, small ? 3 : page ? 1.75 : 1),
    shadow: small || !page ? 1024 : 2048,
    seg: small ? 14 : 20,
    dust: small ? 380 : 900,
  };

  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: page ? "high-performance" : "default", stencil: false });
  } catch {
    opts.onSlow(); // no context after all: the poster film
    return () => {};
  }
  renderer.setPixelRatio(Q.dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Each program's first use otherwise reads back its compile and link logs, a blocking driver round trip apiece
  // (~5-30 ms each on an Intel iGPU, ~170 ms over the first frame). Shaders here are fixed: check them in dev only.
  renderer.debug.checkShaderErrors = process.env.NODE_ENV !== "production";
  const canvas = renderer.domElement;
  // Over the opening poster, which holds the frame until the film's first composed frame is ready. Not quite invisible
  // (0.001: no pixel changes by it): at 0 the compositor leaves the canvas out, so its first frame on screen, and the
  // cost of compositing it every frame, both landed at the crossfade (a ~150-250 ms hitch there on an integrated GPU),
  // and the screen test before it (judge) timed frames that weren't paying for it.
  canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%;opacity:0.001;transition:opacity 0.35s ease";
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0812);
  scene.fog = new THREE.FogExp2(0x0a0812, 0.075);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  await nextFrame();
  if (opts.gone()) {
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    return () => {};
  }
  // The room's reflections, a task of their own: rendering the room into a cube and blurring it compiles its shaders on
  // the spot. At this strength (0.22) a 128 px cube looks the same as the default 256 and costs a quarter of the fill.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  {
    // The room's own shaders compile first, in parallel (fromScene would compile them as it draws, blocking): against
    // a render target, as fromScene draws it, so they are the same programs.
    const rt = new THREE.WebGLRenderTarget(1, 1);
    renderer.setRenderTarget(rt);
    const ready = renderer.compileAsync(room, camera);
    renderer.setRenderTarget(null);
    await ready;
    rt.dispose();
  }
  if (opts.gone()) {
    room.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    return () => {};
  }
  const envRT = pmrem.fromScene(room, 0.04, 0.1, 100, { size: 128 });
  room.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.22; // just enough for chrome and sweat to catch a reflection
  const drop = () => {
    envRT.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  await nextFrame();
  if (opts.gone()) {
    drop();
    return () => {};
  }

  const world = buildWorld(THREE, RoundedBoxGeometry, { shadows: true, shadowSize: Q.shadow, dust: Q.dust, fontFamily: opts.family });
  scene.add(world.root);
  await nextFrame(); // the room (~90 ms: its textures are drawn on canvases) and the lifter each get a task of their own
  if (opts.gone()) {
    world.dispose();
    drop();
    return () => {};
  }
  let lifter: ReturnType<typeof buildLifter> | null = null;
  if (opts.gltf) {
    try {
      lifter = buildLifter(THREE, opts.gltf, { shadows: true });
      lifter.setSweat(0); // the skin's clearcoat on before the precompile, so its program is the one compiled
      lifter.root.position.y = 0.04;
      scene.add(lifter.root);
    } catch {
      lifter = null; // an unexpected rig: fall back to the built-in figure
    }
  }
  const athlete = buildAthlete(THREE, RoundedBoxGeometry, { segments: Q.seg, shadows: true, body: !lifter });
  athlete.root.position.y = 0.04; // stands on the platform
  scene.add(athlete.root);
  await nextFrame();
  if (opts.gone()) {
    world.dispose();
    athlete.dispose();
    lifter?.dispose();
    drop();
    return () => {};
  }

  // ─── chalk and dust: one pooled particle system, simulated on the CPU (a few hundred points) ───
  const PN = 320;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PN * 3), pLife = new Float32Array(PN), pSize = new Float32Array(PN);
  const pVel = new Float32Array(PN * 3), pMax = new Float32Array(PN);
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("life", new THREE.BufferAttribute(pLife, 1));
  pGeo.setAttribute("size", new THREE.BufferAttribute(pSize, 1));
  const pUniforms = { uScale: { value: 1 } };
  const pMat = new THREE.ShaderMaterial({
    uniforms: pUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float life, size; uniform float uScale; varying float vL;
      void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.);
        gl_PointSize = uScale * size * (1.6 - life) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying float vL;
      void main(){ if (vL <= 0.0) discard; float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vL * 0.55; gl_FragColor = vec4(vec3(0.96, 0.95, 0.98), a); }`,
  });
  const puffs = new THREE.Points(pGeo, pMat);
  puffs.frustumCulled = false;
  scene.add(puffs);
  let pNext = 0;
  const emit = (at: V3, n: number, spread: number, up: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const k = pNext++ % PN;
      pPos[k * 3] = at[0] + (Math.random() - 0.5) * spread;
      pPos[k * 3 + 1] = at[1] + (Math.random() - 0.5) * spread * 0.5;
      pPos[k * 3 + 2] = at[2] + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2, s = 0.15 + Math.random() * 0.45;
      pVel[k * 3] = Math.cos(a) * s;
      pVel[k * 3 + 1] = up * (0.3 + Math.random());
      pVel[k * 3 + 2] = Math.sin(a) * s;
      pMax[k] = 0.9 + Math.random() * 1.1;
      pLife[k] = 1;
      pSize[k] = size * (0.6 + Math.random() * 0.8);
    }
  };
  const stepParticles = (dt: number) => {
    for (let k = 0; k < PN; k++) {
      if (pLife[k]! <= 0) continue;
      pLife[k] = Math.max(0, pLife[k]! - dt / pMax[k]!);
      const drag = Math.exp(-2.4 * dt);
      pVel[k * 3]! *= drag;
      pVel[k * 3 + 2]! *= drag;
      pVel[k * 3 + 1] = pVel[k * 3 + 1]! * drag - 0.05 * dt; // chalk floats; it barely falls
      pPos[k * 3]! += pVel[k * 3]! * dt;
      pPos[k * 3 + 1]! += pVel[k * 3 + 1]! * dt;
      pPos[k * 3 + 2]! += pVel[k * 3 + 2]! * dt;
    }
    (pGeo.attributes.position as T.BufferAttribute).needsUpdate = true;
    (pGeo.attributes.life as T.BufferAttribute).needsUpdate = true;
    (pGeo.attributes.size as T.BufferAttribute).needsUpdate = true;
  };

  // ─── post: bloom for the neon and hot highlights, then a film pass (grain, vignette, lens fringe) ───
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Bloom strength adjusted per device: full on desktop, toned down on mobile to keep things sharp
  const bloomStrength = small ? 0.35 : 0.6;
  const bloomThresh = small ? 0.4 : 0.55;
  const bloomRadius = small ? 0.4 : 0.55;
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), bloomStrength, bloomThresh, bloomRadius);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);
  const film = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 }, uGrain: { value: small ? 0.035 : 0.045 }, uPunch: { value: 0 }, uFlash: { value: 0 }, uStreak: { value: page && !small ? 1 : 0 }, uTexel: { value: 1 / 1280 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uAspect, uGrain, uPunch, uFlash, uStreak, uTexel; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5; c.x *= uAspect;
        float r = length(c);
        // Chromatic fringe grows toward the corners, like a fast prime shot wide open; a heavy rep punches it a touch.
        vec2 off = (vUv - 0.5) * (0.0018 + uPunch * 0.004) * r * 2.0;
        vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        // Anamorphic streaks: the neon, bulbs and chrome bleed a thin horizontal flare, like a cine lens.
        if (uStreak > 0.5) {
          vec3 st = vec3(0.0);
          for (int i = 1; i <= 8; i++) {
            float o = float(i) * 14.0 * uTexel, w = 1.0 - float(i) / 9.0;
            st += (max(texture2D(tDiffuse, vUv + vec2(o, 0.0)).rgb - 0.9, 0.0) + max(texture2D(tDiffuse, vUv - vec2(o, 0.0)).rgb - 0.9, 0.0)) * w;
          }
          col += dot(st, vec3(0.33)) * vec3(0.7, 0.45, 1.0) * 0.9;
        }
        // Grade: violet in the shadows, amber in the highlights, a gentle S-curve for bite.
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col *= mix(vec3(0.94, 0.9, 1.12), vec3(1.06, 1.0, 0.9), smoothstep(0.15, 0.75, l));
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
        col *= mix(1.0, smoothstep(1.05, 0.25, r), 0.72);
        // Lift change: a hot rose flash from the centre that dies in a quarter second.
        col += uFlash * vec3(1.0, 0.42, 0.66) * 0.32 * smoothstep(1.1, 0.0, r);
        float g = hash(vUv * 1000.0 + fract(uTime * 7.3)) - 0.5;
        col += g * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(film);

  // ─── sizing & adaptive quality ───
  // Fill is the film's cost: every pixel runs the scene, bloom's mips and the film pass's taps (~10 ms per MP on an
  // Intel UHD 620). Past what the GPU fills in a frame it doesn't run slow, it stalls for hundreds of ms at a time, so
  // the film starts within a pixel budget and the calibration below sizes it to the GPU, both before it goes on. `cap` is
  // the ratio they settle on and adapt() lowers, never below `floor()`: 0.8, or ~1 MP on a screen big enough that 0.8
  // is still more than an integrated GPU fills (1440p, 4K). The grain hides a soft canvas; it can't hide a stutter.
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  // Where calibration runs, the film starts at its floor, the size an integrated GPU settles on anyway: calibration then
  // only ever grows it, on a GPU fast enough that the resize is quick (on a slow one, resizing waits on a busy GPU and
  // froze the screen ~0.25 s right as the film faded in). Without it the start is the final word until adapt().
  const budget = timer ? 0 : PX_BUDGET;
  let W = 1, H = 1, dpr = Q.dpr, cap = 0;
  const floor = () => Math.min(0.8, Math.max(0.5, Math.sqrt(1e6 / (W * H))));
  let sized = "";
  const resize = () => {
    W = el.clientWidth || window.innerWidth;
    H = el.clientHeight || window.innerHeight;
    dpr = Math.min(Q.dpr, cap || Math.max(floor(), Math.sqrt(budget / (W * H))));
    // A new size reallocates the canvas and every post buffer, and waits for the GPU to finish what it was drawing first
    // (100+ ms with the film running; the whole screen, opening loop included, holds still meanwhile). So only for a
    // real change: the ResizeObserver's first report is the size the stage already has.
    const now = `${W}x${H}@${dpr}`;
    if (now === sized) return;
    sized = now;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    bloom.resolution.set(Math.round(W * dpr * 0.5), Math.round(H * dpr * 0.5));
    film.uniforms.uAspect!.value = W / H;
    film.uniforms.uTexel!.value = 1 / Math.max(1, W * dpr);
    camera.aspect = W / H;
    const px = H * dpr;
    pUniforms.uScale.value = px * 0.03;
    world.dustUniforms.uScale.value = px * 0.012;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  let winT = 0, winSlow = 0, badWins = 0, shadowStep = 0;
  /** A smaller map, then a map redrawn every other frame. */
  const stepShadows = () => {
    if (shadowStep === 0) halveShadows();
    else if (shadowStep === 1) {
      shadowStep = 2;
      renderer.shadowMap.autoUpdate = false;
    }
  };
  const halveShadows = () => {
    shadowStep = 1;
    scene.traverse((o) => {
      const l = o as T.SpotLight;
      if (!l.isLight || !l.castShadow) return;
      l.shadow.mapSize.multiplyScalar(0.5);
      l.shadow.map?.dispose();
      l.shadow.map = null; // remade at the new size on the next frame
    });
  };
  const adapt = (dt: number) => {
    // Sustained jank steps quality down, cheapest loss first: resolution, then bloom, then shadows. Never back up
    // mid-session (flip-flopping is worse than soft). Panels run capped at 30 fps, so their budget is wider.
    // Judged on time, not a count of slow frames: a GPU past its fill rate runs most frames at full speed and then
    // stalls for 300-900 ms while rAF waits on it, a pattern a slow-frame counter (fast frames paying it back) never
    // added up to. Two seconds running, each with over 15% of it in slow frames (one 150 ms freeze a second, which
    // reads as a stutter), is a step down. (Main-thread time can't tell a slow CPU from a busy GPU here: WebGL calls
    // block on a full GPU queue. Measured on a 4x-throttled phone profile, a smaller canvas still won back 60 fps.)
    dt = Math.min(dt, 0.5); // one hitch (a GC, a slow tab switch back) can't make two bad seconds on its own
    winT += dt;
    if (dt > (page ? 1 / 40 : 1 / 24)) winSlow += dt;
    if (winT < 1) return;
    badWins = winSlow / winT > 0.15 ? badWins + 1 : 0;
    winT = winSlow = 0;
    if (badWins < 2) return;
    badWins = 0;
    if (dpr > floor() + 0.01) {
      cap = Math.max(floor(), dpr - 0.25);
      resize();
    } else if (bloom.enabled) bloom.enabled = false;
    // Shadows step down without ever switching off: turning the shadow map off changes every lit material's shader, and
    // recompiling them all froze the page for ~0.4 s, mid-scroll, on exactly the machine that was already struggling.
    // A smaller map, then a map redrawn every other frame, cost nothing to switch to.
    else stepShadows();
  };

  // Where the browser times GPU work (EXT_disjoint_timer_query: Chromium, Firefox), a few frames are timed as they
  // draw, asynchronously, and the ratio set so a frame takes ~FRAME_MS of GPU, fill taken as all of it: a fast GPU
  // gets the full ratio, an integrated one at HiDPI its floor. The first frames pay for uploads, so they're skipped;
  // results come back a frame or two later, still well inside the judge's second. Elsewhere (Safari) the pixel
  // budget stands, and adapt() is the safety net everywhere.
  let calN = 0, calDone = !timer;
  const calQ: WebGLQuery[] = [], calMs: number[] = [];
  const calBegin = () => {
    if (calDone || ++calN <= 2 || calN > 8) return null; // 6 tries for 3 clean timings
    const q = gl.createQuery();
    gl.beginQuery(timer!.TIME_ELAPSED_EXT, q);
    return q;
  };
  const calEnd = (q: WebGLQuery | null) => {
    if (q) {
      gl.endQuery(timer!.TIME_ELAPSED_EXT);
      calQ.push(q);
    }
    while (!calDone && calQ.length && gl.getQueryParameter(calQ[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const done = calQ.shift()!;
      // A disjoint (the GPU was reset or reclocked mid-frame) voids the timing.
      if (!gl.getParameter(timer!.GPU_DISJOINT_EXT)) calMs.push(gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(done);
    }
    if (calDone || (calMs.length < 3 && (calN <= 8 || calQ.length))) return;
    calDone = true;
    calQ.splice(0).forEach((x) => gl.deleteQuery(x));
    if (calMs.length < 3) return;
    const ms = calMs.sort((x, y) => x - y)[calMs.length >> 1]!;
    const was = dpr;
    cap = Math.max(floor(), dpr * Math.sqrt(FRAME_MS / ms));
    // Resizing costs a stall (see resize): not worth it for a change no one could see. The cap still holds from here on.
    if (Math.abs(Math.min(Q.dpr, cap) - was) > was * 0.12) resize();
  };

  // ─── pointer parallax ───
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  // ─── scroll → chapters ───
  const chapters = page ? trackChapters() : null;
  const NONE: HTMLElement[] = [];
  const chapterList = () => chapters?.els ?? NONE;
  const chapterLift = (i: number) => {
    const id = chapterList()[i]?.dataset.gymChapter;
    return id && LIFTS[id] ? LIFTS[id]! : LIFTS.deadlift!;
  };
  const chapterShot = (i: number): Shot => {
    const e = chapterList()[i];
    const name = (e?.dataset.gymShot ?? DEFAULT_SHOT[chapterLift(i).id] ?? "hero") as keyof typeof SHOTS;
    return SHOTS[name] ?? SHOTS.hero;
  };
  const readScroll = () => chapters?.at() ?? { i: 0, f: 0 };
  let lastScrollY = window.scrollY, scrollVel = 0;

  // ─── choreography ───
  /** A change of lift in progress: the carry path through the positions in between, and the lift it ends in. */
  type Trans = { path: Path; t: number; to: Lift };
  const firstChapter = page ? readScroll().i : 0;
  const firstLift = page ? chapterLift(firstChapter) : LIFTS.deadlift!;
  const st = {
    lift: firstLift,
    plan: repPlan(firstLift, 0),
    repN: 0, // reps started in this lift (sets the fatigue of the next)
    repT: 0, // seconds into the current rep
    reps: 0, // reps completed in this lift, counted at the lockout
    rep: null as RepState | null,
    trans: null as Trans | null,
    pose: null as Pose | null,
    barY: 0,
    barV: 0,
    bend: 0,
    bendV: 0,
    shake: 0,
    punch: 0,
    chapter: 0,
    setFor: firstChapter, // the chapter the lifter is on (or carrying the bar toward)
    cut: false, // this frame is a cut: no physics carried across it
    orbitLift: 0,
    totalReps: 0,
    sweat: 0,
    breath: 0, // breathing phase, integrated: a rate that changes must never make the chest jump
    flash: 0,
    kick: 0,
  };
  /** Settle into a lift: the set opens in the rest before its first rep — the breath before the brace. */
  const beginLift = (lift: Lift) => {
    st.lift = lift;
    st.repN = 0;
    st.reps = 0;
    st.plan = repPlan(lift, 0);
    st.repT = setOpening(st.plan);
    st.rep = null;
  };
  beginLift(firstLift);
  // One set of bumper plates for every lift (bumpers are the same size whatever they weigh): plates never grow or
  // shrink on screen.
  athlete.setLoad(BODY.plateRadius);
  /** Seconds into a rep where the lift is held at its finish (the lockout, or standing tall out of a squat). */
  const holdTime = (lift: Lift, plan: RepPlan) => {
    const d = lift.rep.findIndex((s) => s.ease === "drive");
    const k = (d + 1) % lift.rep.length;
    return plan.durs.slice(0, k).reduce((a, b) => a + b, 0) + plan.durs[k]! * 0.5;
  };
  /** Put the lifter where the opening loop is, `at` seconds into it, so the film crossfades in over the loop on the
   *  same moment of the same rep. The loop (scripts/render-gym-loop.mjs, via the dev hook) starts 0.22 s past the
   *  deadlift's drive, on a second rep that every rep repeats. */
  const syncToLoop = (at: number) => {
    if (st.trans || st.lift.id !== "deadlift") return;
    st.repN = 1;
    st.plan = repPlan(st.lift, st.repN);
    const d = st.lift.rep.findIndex((s) => s.ease === "drive");
    st.repT = (st.plan.durs.slice(0, d + 1).reduce((a, b) => a + b, 0) + 0.22 + at) % st.plan.total;
    st.rep = null; // a jump, not a rep: no beats fire across it
  };

  const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 36, shift: 0, rise: 0, init: false };
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), tA = new THREE.Vector3(), tB = new THREE.Vector3();

  const shotAt = (s: Shot, f: number, outPos: T.Vector3, outTarget: T.Vector3) => {
    outPos.set(s.pos[0] + s.drift[0] * f, s.pos[1] + s.drift[1] * f, s.pos[2] + s.drift[2] * f);
    outTarget.set(s.target[0], s.target[1], s.target[2]);
  };

  /** The coach's cue for this moment of the rep, as the set card shows it. */
  const cueOf = () => {
    if (st.trans) return "Setting up";
    const r = st.rep;
    if (!r) return "Brace";
    const g = st.lift.rep[r.seg]!;
    if (g.ease === "drive") return "Drive";
    if (g.ease === "lower") return "Control";
    const last = r.seg === st.lift.rep.length - 1;
    if (last && r.brace > 0.05) return "Brace";
    if (last && st.repN % SET_REPS === SET_REPS - 1) return "Breathe";
    if (r.seg > 0 && st.lift.rep[r.seg - 1]!.ease === "drive") return "Lock out";
    return last ? "Reset" : "Pause";
  };

  let lastEvent = "";
  const announce = (i: number) => {
    // Mid-transition the card already names the lift being set up, with the count reset.
    const lift = st.trans?.to ?? st.lift, rep = st.trans ? 0 : st.reps, cue = cueOf();
    const key = `${lift.id}|${rep}|${i}|${cue}`;
    if (key === lastEvent) return;
    lastEvent = key;
    el.dataset.gymLift = lift.id;
    const detail: GymRepEvent = { lift: lift.id, liftName: lift.name, rep, chapter: i, chapters: Math.max(1, chapterList().length), cue, live: true };
    window.dispatchEvent(new CustomEvent(GYM_REP_EVENT, { detail }));
  };

  /** Change lift from where the lifter is now. Only called at a still moment (bar parked, or held at the finish), so
   *  the carry starts from rest instead of stopping a moving bar dead. */
  const startTransition = (to: Lift) => {
    if (!st.pose || to.id === st.lift.id) return;
    const node = (st.rep?.u ?? 0) > 0.5 ? st.lift.hold : st.lift.rest;
    st.trans = { path: planPath(st.pose, node, to), t: 0, to };
    edit();
  };
  /** A change of lift lands like an edit: flash, a lens punch and a kick of the focal length; at most one a second,
   *  so a reader nudging the page back and forth over a chapter line doesn't strobe the stage. */
  let lastEdit = -Infinity;
  const edit = () => {
    const now = performance.now();
    if (now - lastEdit < 1000) return;
    lastEdit = now;
    st.flash = 1;
    st.punch = 1.2;
    st.kick = 1;
  };

  let wanted = firstLift, wantedAt = 0;
  /** Cut to `to`: the lifter is already set up for it, the camera on its shot, the edit marked by the lift-change
   *  flash. A set opens in the rest before its first rep, as after a carry. */
  const cutTo = (to: Lift) => {
    st.trans = null;
    beginLift(to);
    st.cut = true;
    cam.init = false; // the camera cuts with it, rather than gliding across the room
    edit();
  };

  let ring: HTMLElement | null = null;
  // Dev-only: visual tests can pin the camera to inspect the lifter up close, and pin a pose to inspect it.
  let debugView: { pos: V3; target: V3; fov: number } | null = null;
  let debugPose: Pose | null = null;
  let steady = false; // dev-only: no handheld drift (the opening loop is rendered on a locked-off camera)

  // ─── frame ───
  const t0 = performance.now();
  let prev = t0;
  // The film always fades in over the lit opening (poster, then loop): it starts with the room's lights already on.
  let lightT = 10;

  const simulate = (now: number) => {
    // One monotonic clock for everything; rAF timestamps can precede performance.now() taken at mount, and a
    // negative step would run every decay and spring backwards.
    const dt = clamp((now - prev) / 1000, 0, 0.05);
    prev = Math.max(prev, now);
    const t = (now - t0) / 1000;
    lightT += dt;

    // Scroll: chapter, progress, and velocity (px/s, smoothed) that pumps the tempo.
    let ci = 0, cf = 0;
    if (page) {
      ({ i: ci, f: cf } = readScroll());
      const y = window.scrollY;
      scrollVel = damp(scrollVel, Math.abs(y - lastScrollY) / Math.max(dt, 1e-3), 6, dt);
      lastScrollY = y;
    }
    st.chapter = ci;

    // Which lift should be on the platform.
    let want: Lift;
    // The chapter whose lift should be on the platform (the next one once you are past 55% of the way to it).
    const wantChapter = page && cf > 0.55 && ci < chapterList().length - 1 ? ci + 1 : ci;
    if (page) want = chapterLift(wantChapter);
    else {
      if (st.reps >= 3 && !st.trans && st.rep?.still) st.orbitLift = (st.orbitLift + 1) % LIFT_ORDER.length;
      want = LIFTS[LIFT_ORDER[st.orbitLift]!]!;
    }
    // A change of lift waits for a still moment; mid-rep, the lifter finishes the movement briskly first. A jump
    // (two or more chapters at once, or a new lift wanted while a carry is still under way) is an edit instead: carrying
    // the bar through every position in between took 6-7.5 s of "Setting up" before the lift the reader jumped to.
    let hurry = false;
    const heading = st.trans?.to ?? st.lift;
    // Only a settled wish cuts: the lift wanted must have held for 0.3 s (the 55% line flips back and forth under a
    // reader nudging the page; a carry under way just carries on meanwhile).
    if (want.id !== wanted.id) {
      wanted = want;
      wantedAt = t;
    }
    const jump = page && want.id !== heading.id && (!!st.trans || Math.abs(wantChapter - st.setFor) >= 2);
    if (jump) {
      if (t - wantedAt >= 0.3) cutTo(want);
    } else if (!st.trans && want.id !== st.lift.id) {
      if (!st.rep || st.rep.still) startTransition(want);
      else hurry = true;
    }
    if (page && want.id === (st.trans?.to ?? st.lift).id) st.setFor = wantChapter;

    let pose: Pose;
    let effort = 0.3; // carrying the bar between lifts
    let beatDrive = false, beatFloor = false;
    if (st.trans) {
      const tr = st.trans;
      tr.t += dt * (1 + Math.min(0.8, scrollVel / 2200));
      pose = pathAt(tr.path, tr.t);
      if (tr.t >= tr.path.total) {
        beginLift(tr.to);
        st.trans = null;
      }
    } else {
      // Scrolling pumps the tempo and a pending change of lift hurries the rep, but never past what a lifter can move:
      // the curl's bar already travels at ~2.3 m/s at 1×, and uncapped (5.7×) it hit 12 m/s. Past ~1.8× it is a blur.
      const rate = Math.min(MAX_REP_RATE, (1 + Math.min(1.6, scrollVel / 1400)) * (hurry ? 2.2 : 1));
      st.repT += dt * rate;
      if (st.repT >= st.plan.total) {
        st.repT -= st.plan.total;
        st.plan = repPlan(st.lift, ++st.repN);
      }
      const r = repAt(st.lift, st.plan, st.repT);
      // Beats of a rep, for every segment finished since the last frame (a fast scroll can cross a short one).
      if (st.rep) {
        const n = st.lift.rep.length;
        for (let k = st.rep.seg; k !== r.seg; k = (k + 1) % n) {
          const done = st.lift.rep[k]!;
          if (done.ease === "drive") beatDrive = true;
          if (done.ease === "lower" && st.lift.id === "deadlift") beatFloor = true;
        }
      }
      st.rep = r;
      pose = repPose(st.lift, r);
      effort = r.effort;
      if (beatDrive) {
        st.reps++;
        st.totalReps++;
      }
    }

    // Life in the body: breathing (faster and deeper as the set wears on), a little sway, a bar never perfectly still.
    const fatigue = st.trans ? 0 : (st.repN % SET_REPS) / (SET_REPS - 1);
    st.breath += dt * (2.1 + effort * 1.4 + fatigue * 1.1);
    const breath = 0.5 + (0.5 + fatigue * 0.25) * Math.sin(st.breath);
    pose = sway(pose, Math.sin(t * 0.9) * 0.006, (breath - 0.5) * 0.004);
    if (st.lift.id === "lockout" && !st.trans) {
      // Holding a load overhead: a fine tremor that grows as the set goes on.
      const k = 1 + fatigue * 1.5;
      pose.bar = [pose.bar[0] + Math.sin(t * 11.3) * 0.002 * k, pose.bar[1] + Math.sin(t * 7.1) * 0.003 * k, pose.bar[2] + Math.sin(t * 9.7) * 0.003 * k];
    }
    if (debugPose) pose = debugPose;
    st.pose = pose;
    const sk = solve(pose);

    // Beats: at the lockout chalk flies from the hands and the neon flares; for the deadlift, the plates land.
    if (beatDrive) {
      emit([sk.handL[0], sk.handL[1] + 0.04, sk.handL[2]], 10, 0.05, 0.25, 1);
      emit([sk.handR[0], sk.handR[1] + 0.04, sk.handR[2]], 10, 0.05, 0.25, 1);
      st.punch = 1;
      world.pulse(t); // every lockout is a heartbeat: down the wall trace, and a flare of the neon
    }
    if (beatFloor) {
      for (const x of [-0.78, 0.78]) emit([x, 0.06, sk.bar[2]], 22, 0.2, 0.35, 1.8);
      st.shake = 1;
      st.bendV -= 0.35; // the bar whips as the plates hit
    }

    // Bar physics: sag under load when held, with a damped spring driven by the bar's vertical acceleration.
    const barY = sk.bar[1];
    if (st.cut) {
      // Across a cut the bar didn't move, the shot changed: start its spring at rest.
      st.barY = barY;
      st.barV = 0;
      st.bendV = 0;
      st.cut = false;
    }
    const v = (barY - st.barY) / Math.max(dt, 1e-3);
    const acc = (v - st.barV) / Math.max(dt, 1e-3);
    st.barY = barY;
    st.barV = v;
    const onFloor = barY <= BODY.plateRadius + 0.01;
    const sag = onFloor ? 0 : 0.012;
    st.bendV += (-(st.bend - sag) * 180 - st.bendV * 11 + clamp(acc, -40, 40) * 0.004) * dt;
    st.bend = clamp(st.bend + st.bendV * dt, -0.05, 0.05);
    // The head gets out of the bar's way: as it passes the face (on a press, or going overhead) the chin draws back
    // and up, and comes through again once the bar is past the crown.
    const shY = (sk.shoulderL[1] + sk.shoulderR[1]) / 2, shZ = (sk.shoulderL[2] + sk.shoulderR[2]) / 2;
    const by = sk.bar[1] - shY, bz = sk.bar[2] - shZ;
    const inFace = smooth(0.02, 0.1, by) * (1 - smooth(0.34, 0.44, by)) * (1 - smooth(0.2, 0.3, bz)) * smooth(-0.04, 0.02, bz);
    const headPitch = 0.1 + effort * 0.12 + inFace * 0.4;
    athlete.pose(sk, { breath, bend: st.bend, headPitch });
    // The grip (overhand, or underhand for curls) comes from the pose, so the palms turn over as the bar is carried.
    lifter?.pose(sk, { breath, headPitch, grip: pose.hand, effort });
    st.sweat = damp(st.sweat, Math.min(1, st.totalReps / 14), 0.5, dt);
    athlete.setSweat(st.sweat);
    lifter?.setSweat(st.sweat);

    // Camera: target shot from scroll (page) or a slow orbit (panel), then damped toward it so moves feel weighted.
    let fov: number, shift: number, rise = 0;
    if (page) {
      const A = chapterShot(ci), B = chapterShot(Math.min(ci + 1, chapterList().length - 1));
      const e = easeInOut(smooth(0.3, 0.95, cf));
      shotAt(A, cf, vA, tA);
      shotAt(B, 0, vB, tB);
      vA.lerp(vB, e);
      tA.lerp(tB, e);
      fov = lerp(A.fov, B.fov, e);
      shift = lerp(A.shift, B.shift, e);
      rise = lerp(A.rise ?? 0, B.rise ?? 0, e);
    } else {
      const a = t * 0.09 + 0.6;
      const r = 3.6 + Math.sin(t * 0.13) * 0.4;
      vA.set(Math.sin(a) * r, 1.05 + Math.sin(t * 0.21) * 0.35, Math.cos(a) * r);
      tA.set(0, 1.05, 0);
      fov = 38;
      shift = 0;
    }
    if (debugView) {
      vA.set(...debugView.pos);
      tA.set(...debugView.target);
      fov = debugView.fov;
      shift = 0;
    }
    const portrait = W / H < 0.9;
    if (portrait) {
      // Stacked layouts: centre the lifter and step back so the whole body and bar stay in frame.
      vA.sub(tA).multiplyScalar(1.35).add(tA);
      fov += 10;
      shift = 0;
    } else rise = 0;
    if (debugView) rise = 0;
    pointer.sx = damp(pointer.sx, pointer.x, 3, dt);
    pointer.sy = damp(pointer.sy, pointer.y, 3, dt);
    vA.x += pointer.sx * 0.28;
    vA.y -= pointer.sy * 0.14;
    if (!cam.init) {
      cam.pos.copy(vA);
      cam.target.copy(tA);
      cam.fov = fov;
      cam.shift = shift;
      cam.rise = rise;
      cam.init = true;
    } else {
      const k = page ? 3.2 : 2;
      cam.pos.set(damp(cam.pos.x, vA.x, k, dt), damp(cam.pos.y, vA.y, k, dt), damp(cam.pos.z, vA.z, k, dt));
      cam.target.set(damp(cam.target.x, tA.x, k, dt), damp(cam.target.y, tA.y, k, dt), damp(cam.target.z, tA.z, k, dt));
      cam.fov = damp(cam.fov, fov, k, dt);
      cam.shift = damp(cam.shift, shift, k, dt);
      cam.rise = damp(cam.rise, rise, k, dt);
    }
    // Handheld: a slow, low-amplitude drift plus an impact shake that dies fast.
    st.shake = Math.max(0, st.shake - dt * 3.2);
    st.punch = Math.max(0, st.punch - dt * 2.5);
    st.flash = Math.max(0, st.flash - dt * 4);
    st.kick = Math.max(0, st.kick - dt * 2.2);
    const hx = steady ? 0 : Math.sin(t * 0.71) * 0.012 + Math.sin(t * 1.93) * 0.005;
    const hy = steady ? 0 : Math.sin(t * 0.83 + 1.3) * 0.009;
    const sh = st.shake * st.shake * 0.035;
    camera.position.set(cam.pos.x + hx + (Math.random() - 0.5) * sh, cam.pos.y + hy + (Math.random() - 0.5) * sh, cam.pos.z);
    camera.lookAt(cam.target);
    camera.fov = cam.fov + st.kick * st.kick * 5;
    if (Math.abs(cam.shift) > 0.002 || Math.abs(cam.rise) > 0.002) camera.setViewOffset(W, H, -cam.shift * W, cam.rise * H, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();

    world.update(t, lightT);
    stepParticles(dt);
    film.uniforms.uTime!.value = t;
    film.uniforms.uPunch!.value = st.punch * 0.6 + st.shake;
    film.uniforms.uFlash!.value = st.flash * st.flash;
    // The set card's ring: its comet goes round once per rep, turned by a transform (no repaint; see GymHud), and is
    // hidden while the lifter sets up between lifts.
    if (page) {
      ring ??= document.getElementById("gym-rep-ring");
      if (ring) {
        const turn = `rotate(${st.trans ? 0 : (st.repT / st.plan.total).toFixed(4)}turn)`, shown = st.trans ? "0" : "1";
        if (ring.style.transform !== turn) ring.style.transform = turn;
        if (ring.style.opacity !== shown) ring.style.opacity = shown;
      }
    }
    // The set card names the lift being set up (the target mid-transition), so its set number must be that
    // lift's chapter too — announcing `ci` paired "SET 01" with the second chapter's row.
    announce(st.trans || st.lift.id === chapterLift(wantChapter).id ? wantChapter : ci);
  };
  // Shaders compile in the background (KHR_parallel_shader_compile where the driver has it) before the first frame,
  // so the first draw doesn't stall the page for a compile; until then the opening poster holds the frame.
  let compiled = false, shown = false, liveTimer = 0, drawn = 0;
  const frame = (now: number) => {
    if (!compiled) return;
    simulate(now);
    if (shadowStep === 2) renderer.shadowMap.needsUpdate = (++drawn & 1) === 0; // see adapt
    composer.render();
  };
  const reveal = () => {
    shown = true;
    const loop = loopOf(el);
    if (loop && !loop.paused) syncToLoop(loop.currentTime);
    canvas.style.opacity = "1";
    // Once the crossfade is done the posters and loop underneath are hidden (and the loop stops decoding), so they
    // stop costing compositor time.
    liveTimer = window.setTimeout(() => {
      el.setAttribute("data-gym-live", "");
      pauseLoop(el);
      opts.onLive();
    }, 450); // the canvas's 0.35s fade, and a frame or two
  };

  if (process.env.NODE_ENV !== "production") {
    // Dev-only handle for visual tests: advance simulated time in real 50 ms steps, then draw one frame.
    // Steps run on the simulation's own clock, never the wall clock: a slow capture between calls must not stretch
    // the next step (it used to, up to the 50 ms clamp, so a 30 fps capture ran at the wrong speed).
    const advance = (seconds: number, step = 0.05) => {
      const at = prev;
      for (let k = 1; k <= Math.round(seconds / step); k++) simulate(at + k * step * 1000);
      frame(prev);
    };
    (el as unknown as { __gym: unknown }).__gym = { st, advance, lifter, THREE,
      rig: { LIFTS, NODES, poseOf, poseOfKey, planPath, pathAt, solve, repPlan, repAt, repPose, route },
      pin: (p: Pose | null) => (debugPose = p),
      grain: (g: number) => (film.uniforms.uGrain!.value = g),
      openLoop: syncToLoop,
      steady: (on: boolean) => (steady = on),
      // Render at exactly this pixel ratio, full quality, whatever this machine's GPU would settle on (the render
      // scripts: a slow GPU's calibration must not shrink the frames they encode).
      // Whether the first frame can draw yet (shaders compiled): until then advance() draws nothing, and a capture
      // reads a blank canvas.
      ready: () => compiled,
      ratio: (r: number) => {
        Q.dpr = r;
        cap = r;
        bloom.enabled = true;
        resize();
      },
      // Stop the live loop: only advance() draws from here on (so capture stalls can't trip the quality step-down).
      park: () => cancelAnimationFrame(raf),
      hold: () => (st.repT = holdTime(st.lift, st.plan)),
      view: (v: typeof debugView) => (debugView = v, cam.init = false), info: () => {
        // Whole composed frame (scene + shadow + post passes), not just the last pass.
        renderer.info.autoReset = false;
        renderer.info.reset();
        composer.render();
        const r = { ...renderer.info.render, geometries: renderer.info.memory.geometries, dpr };
        renderer.info.autoReset = true;
        return r;
      } };
  }
  /**
   * Every program the film's first frames need, compiled before them (see the call below), a few at a time. Sent to the
   * driver all at once (~30 programs), the compiles ran off the main thread but still filled the GPU process's queue
   * back to back, and nothing on screen updated meanwhile, the opening loop included (66-250 ms). In batches of a few,
   * each finished before the next goes in, with a frame between, the screen keeps drawing.
   */
  async function precompile() {
    // The post passes' full-screen materials, on throwaway triangles shaped like the passes' own (position and uv
    // only) and compiled on their own, as the passes draw them: no scene lights or fog, so the programs match. The film
    // pass draws to the screen; the others draw into the composer's buffers.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // The output pass picks its defines on its first render; give them now (as it will: sRGB, ACES) so its program
    // is compiled here too. Its first render resets them to the same set, which finds this program in the cache.
    output.material.defines = { SRGB_TRANSFER: "", ACES_FILMIC_TONE_MAPPING: "" };
    output.material.needsUpdate = true;
    type Job = { obj: T.Object3D; cam: T.Camera; into: T.WebGLRenderTarget | null; lights?: T.Scene; noFog?: boolean };
    const jobs: Job[] = [];
    // The scene draws into the composer's buffer, linear with no tone mapping.
    scene.traverse((o) => {
      if ((o as T.Mesh).isMesh || (o as T.Points).isPoints || (o as T.Line).isLine) jobs.push({ obj: o, cam: camera, into: composer.readBuffer, lights: scene });
    });
    for (const m of [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial, output.material])
      jobs.push({ obj: new THREE.Mesh(tri, m), cam: flat, into: composer.readBuffer });
    // Into a render target, as the shadow map is drawn, and without the fog: the shadow pass draws with no scene, and
    // the fog is part of a shader's identity even where it isn't used (the scene's lights are: they come along).
    for (const stand of shadowStandIns().children) jobs.push({ obj: stand, cam: camera, into: composer.readBuffer, lights: scene, noFog: true });
    jobs.push({ obj: new THREE.Mesh(tri, film.material), cam: flat, into: null });

    const ready = (ps: T.WebGLProgram[]) =>
      new Promise<void>((done) => {
        const check = () => (dead || ps.every((p) => (p as T.WebGLProgram & { isReady(): boolean }).isReady()) ? done() : setTimeout(check, 10));
        check();
      });
    let batch: T.WebGLProgram[] = [];
    try {
      for (const job of jobs) {
        if (dead) return;
        const had = new Set(renderer.info.programs ?? []);
        const fog = scene.fog;
        if (job.noFog) scene.fog = null;
        renderer.setRenderTarget(job.into);
        try {
          renderer.compile(job.obj, job.cam, job.lights ?? null); // creates (and starts compiling) only programs not made yet
        } finally {
          renderer.setRenderTarget(null);
          scene.fog = fog;
        }
        batch.push(...(renderer.info.programs ?? []).filter((p) => !had.has(p)));
        if (batch.length >= 4) {
          await ready(batch);
          batch = [];
          await nextFrame();
        }
      }
      await ready(batch);
    } finally {
      tri.dispose();
    }
  }

  /**
   * The shadow pass's depth shaders. three.js makes them the first time it draws the shadow map, so they compiled right
   * there, one after another, holding up that first frame (and the whole screen with it) by ~25 ms each. A stand-in for
   * each kind of caster, drawn as the shadow pass draws it (WebGLShadowMap's getDepthMaterial: same depth material,
   * side, maps, skinning or instancing), so the same shaders compile here instead, in parallel and off the main thread.
   * The stand-ins' materials live as long as the film: freeing them would free the shaders they just compiled.
   */
  function shadowStandIns() {
    const group = new THREE.Group();
    if (!renderer.shadowMap.enabled) return group;
    const flip: Record<number, T.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
    const kinds = new Set<string>();
    scene.traverseVisible((o) => {
      const m = o as T.Mesh & Partial<T.SkinnedMesh & T.InstancedMesh>;
      if (!m.isMesh || !m.castShadow) return;
      for (const src of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!src.visible) continue;
        const s = src as T.Material & Partial<T.MeshStandardMaterial>;
        const side = s.shadowSide ?? flip[s.side]!;
        const alphaTest = s.alphaToCoverage ? 0.5 : s.alphaTest;
        const kind = [m.isSkinnedMesh ? "skin" : m.isInstancedMesh ? `inst${!!m.instanceColor}` : "mesh", m.receiveShadow, side, s.wireframe, alphaTest > 0, s.map?.uuid, s.alphaMap?.uuid, s.displacementMap && s.displacementScale ? s.displacementMap.uuid : ""].join();
        if (kinds.has(kind)) continue;
        kinds.add(kind);
        const depth = new THREE.MeshDepthMaterial({ side, wireframe: !!s.wireframe, alphaTest, map: s.map ?? null, alphaMap: s.alphaMap ?? null, displacementMap: s.displacementMap ?? null, displacementScale: s.displacementScale ?? 1, displacementBias: s.displacementBias ?? 0 });
        standIns.push(depth);
        let stand: T.Mesh;
        if (m.isSkinnedMesh) {
          const k = new THREE.SkinnedMesh(m.geometry, depth);
          k.bindMode = m.bindMode!;
          k.bind(m.skeleton!, m.bindMatrix!);
          stand = k;
        } else if (m.isInstancedMesh) {
          const k = new THREE.InstancedMesh(m.geometry, depth, 1);
          k.instanceColor = m.instanceColor ?? null;
          stand = k;
        } else stand = new THREE.Mesh(m.geometry, depth);
        stand.receiveShadow = m.receiveShadow;
        group.add(stand);
      }
    });
    return group;
  }
  const standIns: T.Material[] = [];
  let dead = false;
  /** What the film's first frame would otherwise do all at once: each shader's uniform and attribute lookups (dozens of
   *  driver round trips apiece, ~70 ms in all) and each texture's upload to the GPU (the room's canvas-drawn textures,
   *  the lifter's). Done here instead, a few at a time between frames, once the shaders have compiled. */
  async function warmUp() {
    let t = performance.now();
    const breathe = async () => {
      if (performance.now() - t < 6) return;
      await nextFrame();
      t = performance.now();
    };
    for (const p of renderer.info.programs ?? []) {
      if (dead) return;
      if (!(p as T.WebGLProgram & { isReady(): boolean }).isReady()) continue; // still compiling: its first draw does it
      p.getUniforms();
      await breathe();
    }
    const textures = new Set<T.Texture>();
    scene.traverse((o) => {
      const m = (o as T.Mesh).material as T.Material | T.Material[] | undefined;
      for (const x of m ? (Array.isArray(m) ? m : [m]) : []) for (const v of Object.values(x)) if ((v as T.Texture | null)?.isTexture) textures.add(v as T.Texture);
    });
    for (const tex of textures) {
      if (dead) return;
      renderer.initTexture(tex);
      await breathe();
    }
  }


  // ─── loop ───
  let raf = 0;
  let visible = true;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (!visible || document.hidden) {
      prev = lastFrame = now; // off screen is not a slow frame
      return;
    }
    // Panels are backdrops: 30 fps is plenty and halves their cost next to the numbers people came to read.
    if (!page && now - lastFrame < 1000 / 30 - 2) return;
    const q = compiled ? calBegin() : null;
    frame(now);
    calEnd(q);
    const gap = Math.max(0, now - lastFrame);
    if (shown) adapt(gap / 1000); // frames before the film is on screen (compiling, the screen test) say nothing about it
    judge(gap);
    lastFrame = now;
  };
  // A screen test before the film goes on: the first frames render unseen behind the opening poster, and their
  // median gap (12 frames or 1 s, whichever comes first, skipping the warm-up) decides whether this machine can run
  // it at all. Below ~22 fps (~17 for 30 fps panels) the reader would see a stuttering film. A machine that fails gets
  // one more test at the film's lowest quality (a canvas down to 0.5x, under adapt()'s floor on most screens, no bloom, half-size shadows) before the posters
  // take over: phones and small iGPUs mostly pass it, and a softer film that moves beats a still picture.
  // Before any of that, a page film running under ~45 fps above its floor is first sized to its frame rate (fill is its
  // cost: pixels scale with 1/time) and tested again. That is the sizing on GPUs that can't be timed (Safari, most
  // phones), which start at the full pixel budget: sharp where the GPU keeps up, never a stutter where it doesn't.
  const gaps: number[] = [];
  let judgeFrom = 0, bailTimer = 0, retried = false, fitted = false;
  const settle = () => {
    // Calibration is over: the size is set here, and a late timing must not grow it back.
    calDone = true;
    calQ.splice(0).forEach((x) => gl.deleteQuery(x));
    gaps.length = 0;
    judgeFrom = 0; // the next frame starts the test again (its gap pays for the resize)
  };
  // A frame-rate cap (iOS Low Power Mode, battery savers: 30 fps on any GPU) looks the same as a GPU that can't keep up,
  // but a smaller canvas doesn't speed it up: if the retest's frames are no faster, the full size comes back.
  let unfit: { cap: number; median: number } | null = null;
  const fit = (median: number) => {
    fitted = true;
    unfit = { cap: dpr, median };
    cap = Math.max(floor(), dpr * Math.sqrt(1000 / 60 / median));
    resize();
    settle();
  };
  const lowest = () => {
    retried = true;
    // Under adapt()'s floor wherever that is above 0.5 (phones: 0.8 → 0.6): a soft film that moves beats a still one.
    cap = Math.max(0.5, floor() * 0.75);
    resize();
    bloom.enabled = false;
    if (shadowStep === 0) halveShadows();
    settle();
  };
  const judge = (gap: number) => {
    if (shown || bailTimer || !compiled) return;
    const now = performance.now();
    if (!judgeFrom) {
      judgeFrom = now; // the first compiled frame: its gap includes the wait for the compile
      return;
    }
    gaps.push(gap);
    if (gaps.length < 12 && now - judgeFrom < 1000) return;
    // Its size settled first (calibration's resize runs while the film is still hidden, never mid-crossfade).
    if (!calDone && now - judgeFrom < 1500) return;
    const sample = gaps.slice(Math.min(2, gaps.length >> 2)).sort((x, y) => x - y);
    let median = sample[sample.length >> 1]!;
    if (unfit) {
      const was = unfit;
      unfit = null;
      if (median > was.median * 0.85) {
        cap = was.cap;
        resize();
        median = Math.max(median, was.median); // judged as the size it will run at
      }
    }
    if (forcedLive()) reveal();
    else if (page && !fitted && !retried && median > 22 && dpr > floor() + 0.05) fit(median);
    else if (median <= (page ? 45 : 60)) reveal();
    else if (!retried) lowest();
    else bailTimer = window.setTimeout(opts.onSlow, 0); // not from inside this frame
  };
  let lastFrame = performance.now();
  let io: IntersectionObserver | null = null;
  function dispose() {
    dead = true;
    cancelAnimationFrame(raf);
    clearTimeout(liveTimer);
    clearTimeout(bailTimer);
    el.removeAttribute("data-gym-live");
    io?.disconnect();
    ro.disconnect();
    chapters?.stop();
    window.removeEventListener("pointermove", onMove);
    world.dispose();
    athlete.dispose();
    lifter?.dispose();
    pGeo.dispose();
    pMat.dispose();
    standIns.forEach((m) => m.dispose());
    envRT.dispose();
    pmrem.dispose();
    bloom.dispose();
    output.dispose();
    film.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss(); // hand the context back now, not whenever it is collected
    canvas.remove();
  }
  // A frame between sizing the canvas (above: ~100 ms, the first time) and starting the compile.
  await nextFrame();
  if (opts.gone()) {
    dispose();
    return () => {};
  }
  // Every program the first frame needs, compiled in parallel off the main thread (KHR_parallel_shader_compile), so the
  // first draw never blocks on a compile. The scene draws into the composer's buffer, which is linear with no tone
  // mapping, so it must be compiled against that buffer: compiled for the screen, every material compiled a variant
  // the film never uses, then compiled again, synchronously, on the first frame (1.9 s on an Intel iGPU).
  // A compile that fails here is only made on the first draw instead; anything else failing before the film can draw
  // hands over to the poster film rather than leaving the stage waiting on a film that never starts.
  const warm = precompile().catch(() => undefined);
  void warm
    .then(async () => {
      if (dead) return; // unmounted while compiling: the renderer is gone
      await warmUp();
      if (dead) return;
      compiled = true;
    })
    .catch(() => {
      if (!dead) opts.onSlow();
    });
  io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting), { threshold: 0 });
  io.observe(el);
  raf = requestAnimationFrame(loop);

  return dispose;
}
