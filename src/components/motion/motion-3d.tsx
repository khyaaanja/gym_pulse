"use client";
import { useEffect } from "react";

// Card-like surfaces that tilt toward the pointer. Large surfaces (tables, forms) are skipped by size below:
// tilting something you're reading or typing into is disorienting.
const TILT = ".shadow-card";
const MAX_W = 640;
const MAX_H = 520;
const MAX_DEG = 7;
const POSITIONED = '[class*="absolute"], [class*="fixed"], [class*="sticky"]';
const ROWS = `main :is(ul, ol) > li:not(.scroll-3d, :has(${POSITIONED})), main :is(thead, tbody) > tr:not(:has(${POSITIONED}))`;
// Everything else that would otherwise sit still below the fold: a page's own blocks (headings, prose, footnotes,
// pagination) and text placed straight in <main>, unless they hold cards or rows that move on their own; and rows of
// divider-separated lists. Blocks holding positioned content are skipped for the same reason as rows.
const BLOCKS = [
  `main > * > :not(.scroll-3d, [aria-busy="true"], :has(.scroll-3d, li, tr, .divide-y, ${POSITIONED}))`,
  `main > :is(h1, h2, h3, p, footer):not(:has(${POSITIONED}))`,
  `main .divide-y > :not(.scroll-3d, :has(${POSITIONED}))`,
].join(", ");
const REVEAL = `${ROWS}, ${BLOCKS}`;
// A page that choreographs its own scroll (the landing page, with its film and scroll-driven headlines) opts out of
// the row flips: they doubled up on its own animations, and every flip restyled and repainted rows mid-scroll.
const OWN = "[data-own-motion]";

/**
 * App-wide pointer depth: small cards lean toward the cursor and lift off the page. One delegated listener for the
 * whole document, so every page gets it without per-component wiring. Mouse and pen only (touch scrolls), never
 * inside dialogs or while a field in the card has focus, and off entirely for prefers-reduced-motion.
 * Also flips list rows in as they first scroll into view, and marks the first-load entrance as finished so it
 * never replays on client navigations.
 */
export function Motion3D() {
  useEffect(() => {
    const root = document.documentElement;
    // The first-load entrance ends when this attribute lands, and the CSS drops any entrance still playing, which
    // snaps it into place. So hold off while a loading skeleton is still waiting for content, or an entrance is still
    // running (content that streamed in late), up to a cap so a stalled page can't keep the entrance armed for good.
    const deadline = performance.now() + 6000;
    const entering = () =>
      document.querySelector('main > [aria-busy="true"]') ||
      document.getAnimations().some((a) => a instanceof CSSAnimation && a.animationName.startsWith("enter-") && a.playState === "running");
    let ready = 0;
    const maxRetries = 60; // max 60 retries × 100ms = 6s, matches deadline
    let retryCount = 0;
    const settle = () => {
      retryCount++;
      if (retryCount > maxRetries) {
        // Give up after 6s and force the entrance to end
        (window as Window & { gpMotionHandOff?: { all(): void } }).gpMotionHandOff?.all();
        root.setAttribute("data-motion-ready", "");
        scan(true);
        return;
      }
      if (entering() && performance.now() < deadline) {
        ready = window.setTimeout(settle, 100);
        return;
      }
      // armMotionHandOff (handoff.ts, inlined by the root layout) hands each scroll-rise card back to its rise the frame
      // its entrance ends; any card it hasn't reached (an entrance cut off by the deadline) is handed off now.
      (window as Window & { gpMotionHandOff?: { all(): void } }).gpMotionHandOff?.all();
      root.setAttribute("data-motion-ready", "");
      // The first look for rows and blocks to flip in waits until now: during the first load the page is busy hydrating,
      // its mutations would re-run the scan every 120 ms, and nothing it finds can flip before the entrance is over.
      scan(true);
    };
    ready = window.setTimeout(settle, 1600);

    let active: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const release = (el: HTMLElement) => {
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
      el.style.setProperty("--tilt-z", "0px");
      el.setAttribute("data-tilt", "settle");
      // Drop the transform once it has settled, so the card holds no transform (or containing block) at rest.
      window.setTimeout(() => {
        if (el !== active && el.getAttribute("data-tilt") === "settle") {
          el.removeAttribute("data-tilt");
          el.style.removeProperty("--tilt-x");
          el.style.removeProperty("--tilt-y");
          el.style.removeProperty("--tilt-z");
        }
      }, 520);
    };

    const tiltable = (el: HTMLElement) => {
      if (el.closest("[role=dialog]") || el.matches(":focus-within")) return false;
      const r = el.getBoundingClientRect();
      return r.width <= MAX_W && r.height <= MAX_H;
    };

    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const target = e.target instanceof Element ? (e.target.closest(TILT) as HTMLElement | null) : null;
      const next = target && tiltable(target) ? target : null;
      if (active && active !== next) release(active);
      active = next;
      if (!next) return;
      const r = next.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      next.style.setProperty("--tilt-x", `${(-py * MAX_DEG * 2).toFixed(2)}deg`);
      next.style.setProperty("--tilt-y", `${(px * MAX_DEG * 2).toFixed(2)}deg`);
      next.style.setProperty("--tilt-z", "18px");
      next.setAttribute("data-tilt", "move");
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (active) release(active);
      active = null;
      last = null;
    };
    const onFocus = () => {
      if (active?.matches(":focus-within")) onLeave();
    };

    // Rows and blocks below the fold flip up the first time they scroll into view. Ones already visible when first
    // seen (page load, or a page that just swung in) are left alone, since the entrance or the page swing moved them.
    // Content that arrives later on the same page (a tab, filter or page of results, a refresh) has had no motion,
    // so it flips in even on screen. Rows holding positioned content are skipped: while animating, a row becomes
    // their containing block and they would jump.
    const seen = new WeakSet<Element>();
    const fresh = new WeakSet<Element>();
    let path = location.pathname;
    const io = new IntersectionObserver(
          (entries) => {
            let i = 0;
            for (const entry of entries) {
              const el = entry.target as HTMLElement;
              if (!seen.has(el)) {
                seen.add(el);
                if (entry.isIntersecting && !fresh.has(el)) {
                  io!.unobserve(el);
                  continue;
                }
              }
              if (!entry.isIntersecting) continue;
              io!.unobserve(el);
              el.style.setProperty("--reveal-i", String(Math.min(i++, 6)));
              el.setAttribute("data-reveal", "");
              el.addEventListener("animationend", () => { el.removeAttribute("data-reveal"); el.style.removeProperty("--reveal-i"); }, { once: true });
            }
          },
          { rootMargin: "0px 0px -6% 0px" },
        );
    const watched = new WeakSet<Element>();
    const cards = new WeakSet<Element>();
    // Containers that just swung in as a whole; what's inside them already moved with them.
    let moving: Element[] = [];
    const within = (el: Element) => moving.some((m) => m.contains(el));

    // One swing for a whole block of new content, like the first-load entrance. Always on a plain container, never on
    // a card: a card already runs its scroll rise, and a second animation on it drops both off the compositor.
    const ENTER: Keyframe[] = [{ opacity: 0.35, transform: "perspective(1200px) translate3d(0, 28px, -120px) rotateX(-16deg)" }, { opacity: 1, transform: "none" }];
    const swing = (el: Element) => {
      if (!(el instanceof HTMLElement) || el.matches(".scroll-3d") || el.getAnimations().length) return false;
      // Transformed, it would become the containing block of a fixed control inside it (a floating cart button) and
      // drag it along; such content is left to its rows and blocks.
      if (el.querySelector('[class*="fixed"]')) return false;
      moving.push(el);
      const origin = el.style.transformOrigin;
      el.style.transformOrigin = "50% 0";
      const done = () => { el.style.transformOrigin = origin; };
      el.animate(ENTER, { duration: 380, delay: 20, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" }).finished.then(done, done);
      return true;
    };

    const scan = (initial = false) => {
      if (!io) return;
      // New on the same page, after the entrance: an in-page update. A route change swings the whole page in instead.
      const update = !initial && location.pathname === path;
      path = location.pathname;
      // Cards brought in by an in-page update (a tab or filter) are already landed on screen, and their own rise can't
      // replay; their container swings in for them.
      for (const card of document.querySelectorAll("main .scroll-3d:not(.scroll-3d *)")) {
        if (cards.has(card) || card.closest(OWN)) continue;
        cards.add(card);
        const box = card.parentElement;
        if (!update || !box || within(card) || box.matches("main") || card.getBoundingClientRect().top > window.innerHeight) continue;
        swing(box);
      }
      for (const el of document.querySelectorAll(REVEAL)) {
        if (watched.has(el) || el.closest("[role=dialog]") || el.closest(OWN)) continue;
        watched.add(el);
        if (update && !within(el)) fresh.add(el);
        io.observe(el);
      }
      moving = [];
    };

    // On a client navigation to a route with a loading skeleton (none at present: they held back first-visit content),
    // the page swings in showing the skeleton, and the real content replaces it a moment later. Pages render their sections straight into <main>, so <main> itself swings: it runs nothing else.
    // The skeleton's removal and the content's arrival can land in separate batches, so the removal is remembered.
    let skeletonGone = false;
    const replacedSkeleton = (records: MutationRecord[]) => {
      if (!root.hasAttribute("data-motion-ready")) return;
      const main = records.find((r) => r.target instanceof Element && r.target.matches("main"))?.target as Element | undefined;
      if (!main) return;
      const ofMain = records.filter((r) => r.target === main);
      if (ofMain.some((r) => [...r.addedNodes].some((n) => n instanceof Element && n.getAttribute("aria-busy") === "true"))) skeletonGone = false;
      if (ofMain.some((r) => [...r.removedNodes].some((n) => n instanceof Element && n.getAttribute("aria-busy") === "true"))) skeletonGone = true;
      const came = ofMain.some((r) => [...r.addedNodes].some((n) => n instanceof Element && n.getAttribute("aria-busy") !== "true"));
      if (skeletonGone && came && !main.querySelector('[aria-busy="true"]')) {
        skeletonGone = false;
        swing(main);
      }
    };

    let pending = 0;
    const mo = new MutationObserver((records) => {
      if (!root.hasAttribute("data-motion-ready")) return; // the first scan runs when the entrance settles
      replacedSkeleton(records);
      if (!pending) pending = window.setTimeout(() => { pending = 0; scan(); }, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("blur", onLeave);
    return () => {
      window.clearTimeout(ready);
      window.clearTimeout(pending);
      mo.disconnect();
      io?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("blur", onLeave);
      onLeave();
    };
  }, []);
  return null;
}
