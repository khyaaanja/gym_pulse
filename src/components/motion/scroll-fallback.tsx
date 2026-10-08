"use client";
import { useEffect } from "react";

// What the scroll-driven CSS animates (globals.css): headline words, cards that rise, pricing cards, their numerals and
// month cells. Nested cards are left to their parent, as the CSS does.
const WATCH = ".kinetic, .scroll-3d:not(.scroll-3d .scroll-3d, [role=dialog] .scroll-3d), .plan-3d";
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

const WORD: Keyframe[] = [{ opacity: 0, transform: "translate3d(0, 0.6em, -120px) rotateX(-82deg)" }, { opacity: 1, transform: "none" }];
const RISE: Keyframe[] = [
  { opacity: 0, transform: "perspective(1100px) translateZ(-160px) rotateX(22deg)" },
  { opacity: 1, offset: 0.6 },
  { opacity: 1, transform: "none" },
];
const PLAN = (fan: string): Keyframe[] => [{ opacity: 0.2, transform: `perspective(1200px) translateZ(-300px) rotateX(44deg) rotateY(${fan || "0deg"})` }, { opacity: 1, transform: "none" }];
const NUMERAL: Keyframe[] = [{ opacity: 0, transform: "perspective(600px) rotateX(78deg)" }, { opacity: 1, transform: "none" }];
const CELL: Keyframe[] = [{ opacity: 0.2, transform: "perspective(500px) rotateY(-100deg)" }, { opacity: 1, transform: "none" }];

/**
 * The same scroll entrances for browsers without scroll-driven animations (Firefox, Safari before 26, older Chrome),
 * where the CSS sees nothing and every element would just sit still. Each one plays once, on a timer, the first time
 * it scrolls into view. What is already on screen when first seen is left alone (the first-load entrance or the page
 * swing moved it). Nothing runs where scroll timelines work or for prefers-reduced-motion.
 */
export function ScrollFallback() {
  useEffect(() => {
    if (CSS.supports("animation-timeline: view()") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const seen = new WeakSet<Element>();
    const play = (el: HTMLElement, frames: Keyframe[], delay: number, origin: string, duration = 620) => {
      el.style.transformOrigin = origin;
      const a = el.animate(frames, { duration, delay, easing: EASE, fill: "backwards" });
      const done = () => el.style.removeProperty("transform-origin");
      a.finished.then(done, done);
    };
    const run = (el: HTMLElement) => {
      el.removeAttribute("data-scroll-wait");
      // Cards side by side in a row follow one another, as with --i in the CSS.
      // (Overlapping, not level: the pricing cards are stepped.)
      const box = el.getBoundingClientRect();
      const row = [...(el.parentElement?.children ?? [])].filter((c) => { const r = c.getBoundingClientRect(); return r.top < box.bottom && r.bottom > box.top; });
      const step = Math.max(0, row.indexOf(el)) * 90;
      if (el.matches(".kinetic")) {
        el.querySelectorAll<HTMLElement>(".kinetic-word").forEach((w, i) => play(w, WORD, Math.min(i, 12) * 45, "50% 100%", 560));
      } else if (el.matches(".plan-3d")) {
        play(el, PLAN(el.style.getPropertyValue("--fan")), step, "50% 50%", 700);
        el.querySelectorAll<HTMLElement>(".free-numeral").forEach((n) => play(n, NUMERAL, step + 160, "50% 100%", 560));
        el.querySelectorAll<HTMLElement>(".month-cell").forEach((c, i) => play(c, CELL, step + 260 + i * 40, "50% 50%", 420));
      } else {
        play(el, RISE, step, "50% 100%");
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (!seen.has(el)) {
            seen.add(el);
            // Any part on screen the first time it is seen: shown as is. (Not isIntersecting: the root margin would
            // count the bottom strip as off screen and hide what the reader can see, for good on a page too short to scroll.)
            if (e.boundingClientRect.top < window.innerHeight) { io.unobserve(el); continue; }
            // Below the fold: hidden until it arrives, so it doesn't flash in place first (see globals.css).
            el.setAttribute("data-scroll-wait", "");
            continue;
          }
          if (!e.isIntersecting) continue;
          io.unobserve(el);
          run(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    const scan = () => document.querySelectorAll(WATCH).forEach((el) => { if (!seen.has(el)) io.observe(el); });
    scan();
    let pending = 0;
    const mo = new MutationObserver(() => { if (!pending) pending = window.setTimeout(() => { pending = 0; scan(); }, 150); });
    mo.observe(document.body, { childList: true, subtree: true });
    // Printing (or anything else that needs the whole page) never leaves content hidden.
    const reveal = () => document.querySelectorAll("[data-scroll-wait]").forEach((el) => el.removeAttribute("data-scroll-wait"));
    window.addEventListener("beforeprint", reveal);
    root.setAttribute("data-scroll-fallback", "");
    return () => {
      io.disconnect();
      mo.disconnect();
      window.clearTimeout(pending);
      window.removeEventListener("beforeprint", reveal);
      reveal();
      root.removeAttribute("data-scroll-fallback");
    };
  }, []);
  return null;
}
