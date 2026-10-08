# GymPulse — Handoff

_Last updated: 25 Sep 2026_

## 1. Goal

Bring GymPulse's UI/UX to at least 9/10: premium-feeling, fully responsive at phone, tablet and desktop widths, in light and dark mode. The stack stays as it is (Next.js 16, Tailwind v4, Radix, lucide, motion), and design choices follow the `/frontend-design` skill.

"9/10" is judged against checks that can be measured, not self-scored:
- 0 axe accessibility violations
- 0 horizontal overflow
- 0 runtime errors and 0 failed page loads
- all text at or above 4.5:1 contrast
- keyboard flows work
- tests, lint and build green

## 2. Current state

- **Rated 9/10.** All gates pass on the current production build.
  - Audit: **240 of 240 checks clean**. That is 7 roles (public, owner, staff, trainer, member, vendor, admin) × 360 / 768 / 1400px × light / dark, with 0 axe violations, 0 overflow, 0 errors and 0 failed loads.
  - Keyboard test: **12 of 12 pass** (More menu, dialogs, focus trap, focus return, Ctrl+K search).
  - Tests: **438 of 438 pass**. Lint: **0 errors** (9 older `<img>` warnings). `npm run build` succeeds.
- **Real end-to-end run passed:** desk check-in → member streak and milestones update → owner logs a contact from the More menu.
- **Server:** a **production** server (`npm run start`) is running on port 3000, not the dev server. Run `npm run dev` before editing code. The old dev server hung twice; see section 5.
- **Git:** the folder is **not a git repository**, so nothing is committed.
- **Demo data changed by the smoke run:**
  - Aarav Shrestha (`member@pulsefitness.demo`) has a check-in for today, plus the milestones and challenges it unlocked.
  - Susmita Thapa has a contact note: "Run-skill smoke: will come back Monday".
- **Credentials:** all demo accounts use password `GymPulse!Demo2026`. The full list is in `DOCUMENTATION.md`.

## 3. Active files

| File | What it is |
|---|---|
| `src/app/globals.css` | Design tokens. New: `flame`, `deep`, `deep-ink`, `scrim`. Also the pulse-trace and streak animations |
| `src/components/app/streak-card.tsx` | **New.** Member home streak card with the 14-day strip |
| `src/components/ui/menu.tsx` | **New.** Radix dropdown menu |
| `src/components/app/member-actions.tsx` | Call / WhatsApp / Message plus the More menu; Log contact and Mark as lost dialogs |
| `src/app/app/pulse/page.tsx` | Pulse list layout |
| `src/components/app/member-attendance.tsx` | Member Progress page: milestones with progress |
| `src/components/app/owner-dashboard.tsx` | Owner Overview |
| `src/components/auth/shell.tsx` | Split sign-in layout, used by all 8 auth pages |
| `src/components/ui/dialog.tsx` | Adds the `returnFocus` prop; backdrop uses `scrim` |
| `src/components/ui/table.tsx` | Scroll wrapper is `relative` and `tabIndex={0}`; empty `Th` gets an "Actions" label |
| `src/components/ui/pulse-trace.tsx` | Signature ECG trace; now uses a clip-path sweep |
| `src/components/app/shell.tsx` | App shell, bottom nav, command palette |
| `src/services/search.ts`, `src/services/automation.ts` | Link fixes |
| `src/app/app/marketplace/orders/page.tsx` | **New.** Redirect for old notification links |

Verification scripts live in the session scratchpad, **outside the repo**, and may be deleted:
`~/ai-agent-tmp/claude-1000/-home-kali-linux-Desktop-gym/2fa96c9f-4bc3-4897-ae52-0e0930468f66/scratchpad/`
- `audit.mjs`: axe + overflow + error audit. Env: `ONLY=owner`, `VPS=m360,t768,d1400`, `THEMES=light,dark`, `OUT=file.json`
- `kbd.mjs`: keyboard test
- `journey.mjs`: end-to-end smoke run
- `probe.mjs`: axe details for a single page

If you want to keep them, copy them into `scripts/`.

## 4. Changes made

**Layout and UX**
- **Pulse:** each member is a compact row, and the page is 27% shorter. Call, WhatsApp and Message stay visible; Log contact, Returned and Lost moved into a "More" menu. "Mark as lost" uses a dialog instead of `confirm()`.
- **Member home:** a new streak card with a 14-day strip that fills in on load (the app's one orchestrated animation). It tells the member exactly when the streak breaks, using the real 2-day-gap rule.
- **Member Progress page:** each milestone shows progress ("13 of 14 days"), tier-coloured medals, and "Reached · unlocks at your next check-in" when earned but not yet awarded.
- **Member nav labels:** "Pulse / Attendance" became "Home / Progress".
- **Owner Overview:**
  - Action centre rows lead with the member's name.
  - The chart y-axis is no longer clipped.
  - Today's partial day is left out of the chart, so it no longer shows a fake drop to zero.
  - At tablet width, metrics sit two per row.
  - The legend dot no longer gets squashed.
- **Sign-in:** split layout with a brand panel and the pulse trace, applied to all 8 auth pages.
- **Marketplace:** products without a photo get a category-tinted tile with a fitting icon.
- **Tablet:** the bottom nav is a centred 480px bar instead of spanning the full width.

**Dark mode**
- The large inverted surfaces (owner hero, bottom nav, highlighted pricing card) now use the `deep` token instead of `bg-ink`, which turned white in dark mode.
- Dialog and command-palette backdrops use `scrim`, which always darkens. Before, they brightened the page in dark mode.

**Accessibility**
- **Contrast tokens**, all computed to pass 4.5:1 on every background they're used on:
  - light: `ink-3` #62687f, `warn` #8f6300, `ok` #137a4d, `risk` #c42a42
  - dark: `ink-3` #8f95b0
- **`flame` token:** progress bars and streak fills use `flame` (the old gold), since fills need 3:1 rather than 4.5:1.
- **Grids:** added `grid-cols-1` to 35 grids and wrapped 19 `fr` tracks in `minmax(0,…)`, so wide content can't stretch the page on phones.
- **Horizontal scroll:** fixed sideways scroll on the landing page and Marketplace at 360px. On Marketplace, hidden inputs were escaping the table's scroll container.
- **Landmarks and headings:** added `<main>`, labelled navs and `<h1>`s where they were missing (landing, legal, member pages, vendor, admin banner).
- **Other fixes:** underlined inline links, labelled empty table headers, removed invalid ARIA, gave the mobile "Scan pass" button an accessible name, and made scrollable tables keyboard-focusable.
- **Keyboard focus:** closing a dialog opened from a menu now returns focus to the "More" button. `Button` accepts `ref`.

**Bugs**
- **4 broken links:** new-order notifications and 3 search results pointed at routes that don't exist. They now point at the right pages, and a redirect at the old URL covers notifications already stored in the database.
- **Pulse trace:** the animation cut off the end of long traces. `stroke-dasharray` was replaced with a clip-path sweep.

## 5. Failed attempts

- **Dev server as the verification target.** `next dev` (Turbopack) grew to 1.4–2.9 GB and hung in uninterruptible I/O twice, which timed out logins and audits. Fixed by verifying against `npm run build && npm run start`. **Use production for audits.**
- **`pathLength` to fix the pulse-trace truncation.** It doesn't work together with `vector-effect: non-scaling-stroke` in Chromium; I tested it in isolation. Replaced with a clip-path animation.
- **`pgrep -f "node audit.mjs"` to stop a process.** The pattern matched my own shell and killed it. Kill by exact PID or by port instead (`ss -ltnp | grep :3000`).
- **Logging in for every audit context.** 24 logins per run hit the app's login rate limit (60 per 15 min, HTTP 429). That's correct app behaviour, so the audit now signs in once per role and reuses the session.
- **Element-only overflow check.** It missed the absolutely positioned inputs that escaped the table's scroll container. The audit now also measures the document's `scrollWidth`.
- **Screenshot filenames.** Different roles overwrote each other's `/app` screenshots in the same folder. Use a separate folder per role.

## 6. Next steps

1. **Commit the work.** Run `git init`, then make a first commit before any further changes.
2. **Move the verification scripts into `scripts/`** (audit, keyboard, journey), so they survive the session and can run in CI. Consider `/run-skill-generator` to capture the run-and-verify recipe as a project skill.
3. **Seed engagement data.** `prisma/seed.ts` never awards milestones or challenges for seeded history, so demo members look under-rewarded until their next check-in. Evaluate engagement per member during seeding. Note that awards also send notifications, which would flood the demo inbox.
4. **Test on real devices:** iOS Safari and Android Chrome, especially the fixed bottom nav with the safe-area inset, and the camera "Scan pass" flow.
5. **Remove the smoke-test data** from the demo database if you want a clean demo (Aarav's check-in today and Susmita's contact note).
6. **Visual polish, if you want to push past 9:**
   - Admin and vendor screens only had accessibility fixes, no design pass.
   - Clear the 9 `<img>` lint warnings by moving to `next/image`.
   - The member 16-week heatmap uses brand blue while streaks use flame gold; consider unifying them.
7. **Switch back to the dev server** before editing: stop the production server by its port PID, then `npm run dev`.
