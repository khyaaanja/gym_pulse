/**
 * First-load hand-off for scroll-rise cards (globals.css, "First load"). The root layout inlines this function's source
 * at the top of <body>, so it is listening before the entrance can end, even on a slow phone where hydration (and
 * Motion3D) only arrive after it. It must stay self-contained: no imports, no closure over module scope.
 *
 * During the entrance a .scroll-3d card plays only enter-3d (layering its scroll rise on top keeps Chrome from running
 * either on the compositor). The frame its entrance ends, the card goes back to its rise (data-risen), from
 * animationend, which runs before style and paint, so the card keeps its compositor layer and nothing re-rasters. A
 * card the rise would catch short of landed (on screen, but less than its --rise-range end above the bottom edge) is
 * pinned flat with data-landed instead, so it never jumps back. Motion3D calls window.gpMotionHandOff.all() for any
 * card left over when the entrance finishes.
 *
 * It never reads layout after writing: every card is measured in one batch, the first time one is handed off, so a
 * page full of cards costs one layout instead of one per card (each attribute written dirties style for the next read).
 */
export function armMotionHandOff() {
  // Must match the entrance and data-risen rules in globals.css.
  const cards = 'main > :not([aria-busy="true"]) > .scroll-3d:nth-child(-n + 8):not(.scroll-3d *)';
  let tops: Map<Element, number> | null = null;
  let band = NaN;
  let step = NaN;
  const measure = () => {
    const els = document.querySelectorAll(cards);
    tops = new Map();
    if (!els.length) return;
    const cs = getComputedStyle(els[0]);
    band = parseFloat(cs.getPropertyValue("--rise-band"));
    step = parseFloat(cs.getPropertyValue("--rise-step"));
    for (const el of els) tops.set(el, el.getBoundingClientRect().top + window.scrollY);
  };
  const handOff = (el: Element) => {
    if (el.hasAttribute("data-risen") || el.hasAttribute("data-landed")) return;
    if (!tops || !tops.has(el)) measure();
    const top = tops!.get(el);
    if (top === undefined) return;
    const depth = window.innerHeight - (top - window.scrollY);
    // --i, as globals.css sets it: a card's place in its row of three, in a grid; 0 elsewhere.
    const parent = el.parentElement;
    const i = parent && parent.classList.contains("grid") ? Array.prototype.indexOf.call(parent.children, el) % 3 : 0;
    el.setAttribute(depth > 0 && depth < band + i * step ? "data-landed" : "data-risen", "");
  };
  const onEntered = (e: AnimationEvent) => {
    if (e.animationName === "enter-3d" && e.target instanceof Element && e.target.matches(cards)) handOff(e.target);
  };
  document.addEventListener("animationend", onEntered);
  (window as Window & { gpMotionHandOff?: { all(): void } }).gpMotionHandOff = {
    all() {
      document.removeEventListener("animationend", onEntered);
      document.querySelectorAll(cards).forEach(handOff);
      tops = null; // don't keep the first page's cards alive after it's gone
    },
  };
}
