"use client";
import { useEffect, useState } from "react";
import { GYM_REP_EVENT, type GymRepEvent } from "./gym-scene";

/**
 * The film's on-screen graphics, styled like a broadcast lower third: the set card (lift, a live coaching cue that
 * follows the lifter through each rep, and the rep count ticking over like a scoreboard) and a rail of chapter ticks
 * down the right edge. Driven entirely by the scene's rep events, so it always matches the lifter.
 * Decorative (aria-hidden): the page's own headings carry the content.
 *
 * It gets out of the way: it steps aside while the footer is on screen, and shows no rep count when the film is
 * running as still posters (there are no reps to count).
 */
export function GymHud() {
  const [s, setS] = useState<GymRepEvent | null>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setS((e as CustomEvent<GymRepEvent>).detail);
    window.addEventListener(GYM_REP_EVENT, on);
    const foot = document.querySelector("footer");
    const io = foot ? new IntersectionObserver(([e]) => setAway(!!e?.isIntersecting), { threshold: 0 }) : null;
    if (foot) io?.observe(foot);
    // While the page scrolls, Chrome puts the scroll first: the page's own next frame (the film's among them) waits
    // until everything newly painted is rastered, and that raster waits behind the scroll's. Each of the card's little
    // animations starts on freshly painted text, and waiting on them froze the film for ~0.25 s at a time, a few times
    // a scroll. So while the page moves they hold still (html[data-scrolling] in globals.css): the card just changes.
    const root = document.documentElement;
    let still = 0;
    const onScroll = () => {
      if (still) clearTimeout(still);
      else {
        root.setAttribute("data-scrolling", "");
        // Labels still on their way in finish now, where they would have landed: finished, they never replay.
        for (const el of document.querySelectorAll(".cue-in, .name-wipe, .rep-tick, .rail-tick-on")) for (const a of el.getAnimations()) a.finish();
      }
      still = window.setTimeout(() => {
        still = 0;
        root.removeAttribute("data-scrolling");
      }, 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener(GYM_REP_EVENT, on);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(still);
      root.removeAttribute("data-scrolling");
      io?.disconnect();
    };
  }, []);
  const live = s?.live !== false;
  const shown = !!s && !away;

  return (
    <div aria-hidden className="pointer-events-none">
      <div className="fixed inset-x-0 top-0 z-30 h-[3px]">
        <div className="gym-progress h-full bg-[linear-gradient(90deg,#ff4f98,#ffb454)] shadow-[0_0_12px_rgb(255_79_152/0.8)]" />
      </div>
      <div className={`fixed bottom-3 left-3 z-20 transition-[opacity,transform] duration-250 sm:bottom-7 sm:left-7 ${shown ? "opacity-100" : "translate-y-3 opacity-0"}`}>
        <div className="hud-card flex items-center gap-2.5 rounded-2xl py-2 pl-3 pr-2 text-white sm:gap-3 sm:py-2.5 sm:pl-4">
          <span className="live-dot size-2 shrink-0 rounded-full bg-[#ff4f98] shadow-[0_0_10px_#ff4f98]" />
          <span className="hidden text-[11px] font-semibold tracking-[0.18em] text-white/60 sm:inline">SET {String((s?.chapter ?? 0) + 1).padStart(2, "0")}</span>
          <span className="grid min-w-0 leading-none">
            {/* Keyed by lift: a new lift wipes in like a broadcast name strap. */}
            <Enter key={s?.lift} className="name-wipe display truncate text-[14px] font-bold sm:text-[15px]">{s?.liftName ?? ""}</Enter>
            {live && (
              <Enter key={s?.cue} className="cue-in mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ffb454]/90">{s?.cue ?? ""}</Enter>
            )}
          </span>
          {live && (
            <>
              <span className="h-6 w-px bg-white/15" />
              <span className="relative grid size-9 shrink-0 place-items-center">
                <svg viewBox="0 0 36 36" className="absolute inset-0" aria-hidden>
                  <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
                </svg>
                {/* Rep progress: a comet that runs once round the ring per rep, its head at the rep's progress. The scene
                    turns it every frame with a transform, which the compositor applies to the layer as drawn. A ring
                    that filled (a stroke redrawn every frame) needed repainting and re-rastering every frame, and
                    while the page scrolls Chrome holds back each new frame until that raster is done: the film froze
                    for ~0.25 s at a time. */}
                <svg id="gym-rep-ring" viewBox="0 0 36 36" className="absolute inset-0 opacity-0 will-change-transform" aria-hidden>
                  <defs>
                    <linearGradient id="gym-ring-grad" gradientUnits="userSpaceOnUse" x1="3" y1="23.5" x2="18" y2="2">
                      <stop offset="0" stopColor="#ff4f98" stopOpacity="0" />
                      <stop offset="0.6" stopColor="#ff4f98" />
                      <stop offset="1" stopColor="#ffb454" />
                    </linearGradient>
                  </defs>
                  <path d="M2.965 23.472A16 16 0 0 1 18 2" fill="none" stroke="url(#gym-ring-grad)" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="18" cy="2" r="1.7" fill="#ffb454" />
                </svg>
                <span className="display num w-[2ch] overflow-hidden text-center text-[15px] font-extrabold leading-none text-[#ffb454]">
                  <Enter key={`${s?.lift}-${s?.rep}`} className="rep-tick">{String(s?.rep ?? 0).padStart(2, "0")}</Enter>
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      {s && s.chapters > 1 && (
        <div className={`fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-end gap-2.5 transition-opacity duration-250 md:flex ${away ? "opacity-0" : ""}`}>
          {Array.from({ length: s.chapters }, (_, i) => (
            // Keyed by state, so a tick that changes is a new element that stretches in (a transform the compositor runs):
            // a height transition laid out and repainted the rail on every frame of it.
            <Enter key={`${i}-${i === s.chapter ? "on" : i < s.chapter ? "past" : "next"}`} className={`rail-tick block w-[3px] rounded-full ${i === s.chapter ? "rail-tick-on h-9 bg-[#ff4f98] shadow-[0_0_10px_#ff4f98]" : i < s.chapter ? "h-3 bg-[#ff4f98]/55" : "h-3 bg-white/25"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A label that animates in as it appears, unless it appears while the page is scrolling (see GymHud's effect): it then
 *  just lands. Decided once, as it mounts, so a label never replays its entrance when the scrolling stops. */
function Enter(props: React.ComponentProps<"span">) {
  const [still] = useState(() => typeof document !== "undefined" && document.documentElement.hasAttribute("data-scrolling"));
  return <span {...props} data-still={still || undefined} />;
}
