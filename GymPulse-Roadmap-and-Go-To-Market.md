# GymPulse — How to finish it, what to do next, and how to sell it

_Written 29 September 2026, from the state of the code, database and tests at that date. The earlier test report is in `GymPulse-Full-Test-Report.md`._

---

## 1. Where GymPulse stands today

**The product works.** A full test on 29 September signed in as every type of user (owner, manager, front desk, trainer, member, vendor, trial and suspended gyms, three kinds of platform admin). It opened 235 pages, pressed 735 buttons, checked results against the database, and found no browser or server errors. Every role could open exactly what its permissions allow, and no gym could see another gym's data.

**What is built:**

| Area | What it does |
|---|---|
| Retention ("Pulse") | Flags members who stop coming, estimates revenue at risk, and gives staff a call/message/recovery workflow |
| Members & attendance | Member records, desk check-in, rotating kiosk QR self check-in, NFC card IDs, branches |
| Renewals & payments | Desk payments (cash, bank, card machine), receipts, online renewal through eSewa/Khalti, coupons, balanced ledger |
| Marketplace | PT packs, classes, diet plans and products, bundles, vendors, bookings, 10% platform commission |
| Record import | Excel/CSV/PDF/photo (OCR) import with review, duplicate detection and a churn estimate |
| Engagement | Streaks, milestones, monthly challenges, rewards |
| Notifications | In-app, phone/desktop push (PWA), SMS/email/WhatsApp through providers, per-person preferences |
| Platform console | Gyms, plans and subscriptions, billing, vendors, content and legal pages, support tickets, audit log, system health |
| Legal | Terms, Privacy, Refund and Marketplace policies written from how the product actually works |

**It is not yet ready for paying customers.** The gaps below are what separate "works on this computer" from "a gym can rely on it every day".

---

## 2. What must be done before the first paying gym (blocking)

Do these in this order. Each one names how you'll know it's done.

### 2.1 Protect the code — today
- **The project is not in version control.** Today proved why this matters: the original test suite (about 20 files) was deleted, and there was no history to recover it from.
  - Run `git init`, commit everything, and push to a **private** GitHub/GitLab repository. Make sure `.env` is in `.gitignore` first.
  - Stop other AI tools (opencode, other Claude sessions, Playwright MCP servers) from editing this folder without review. They changed project files overnight during this work.
- **Done when:** the code is in a private remote repository, and every change goes through a commit you've looked at.

### 2.2 Rebuild the automated tests
- Decide whether the deletion of `tests/` was intended. If not, recover what you can (`push-notifications.test.ts` and `plan-free-months.test.ts` are in Claude Code's file history) and rebuild the rest. The most important files to rebuild are tenant isolation, payments/ledger, auth, RBAC and imports.
- Move the 3 Playwright files (`tests/owner-*.test.ts`) into `e2e/` with their own `playwright.config.ts`, so Vitest stops trying to run them.
- Create the test database once: `sudo -u postgres createdb -O gympulse gympulse_test`.
- Add the concurrency cases this test found: simultaneous member adds, simultaneous check-ins, and a double desk payment.
- **Done when:** `npm test` and `npx playwright test` both pass from a clean checkout.

### 2.3 Company, tax and payments (Nepal)
Check the details with a Nepali accountant or lawyer. This is the usual path:
1. **Register the business** with the Office of Company Registrar (Pvt. Ltd. is usual for a software company) and get a **PAN**. Register for **VAT** when turnover requires it, or earlier if you want to invoice VAT-registered gyms.
2. **Open a business bank account.**
3. **eSewa and Khalti merchant accounts.** Each gym connects its own merchant account in *Settings → Payments*. You need your own merchant account only if GymPulse collects its subscription fees online.
4. **Invoice format:** make sure GymPulse subscription invoices show your registered name, PAN/VAT number and the VAT line in the way Nepal's tax office requires.
- **Done when:** you can legally issue invoices and receive money.

### 2.4 Hosting and security settings
- **Server:** a VPS or managed platform with at least 2 vCPU and 4 GB RAM, managed **PostgreSQL** with daily backups and point-in-time restore, and a domain with **HTTPS**. HTTPS is required for push notifications and for installing the app on phones.
- **Environment settings for production:**
  - `APP_ENV=production` and `APP_URL=https://…`
  - `ALLOW_ADMIN_WITHOUT_MFA=false`. It is currently `true`. In production every platform admin must use two-step verification.
  - `EMAIL_TRANSPORT=smtp` with a real mail provider. It is currently `console`, so emails only appear in the server log.
  - New random `DATA_ENCRYPTION_KEY`, `FILE_ENCRYPTION_KEY`, `SIGNING_SECRET` and VAPID keys. Keep them in a secret manager, not in the repository.
  - `ERROR_WEBHOOK_URL` for error alerts, and `CLAMAV_HOST` if you want uploaded files virus-scanned.
- **Run the background worker as its own process** (`npm run worker`) rather than inside the web server (`RUN_WORKER_IN_PROCESS=false`), so reminders and imports keep running during deploys.
- **Never run the seed on production.** It refuses to anyway.
- **Done when:** a production deploy runs on its own domain over HTTPS, admins need 2FA, and restoring a database backup has been rehearsed once.

### 2.5 Connect the real message and payment providers
None are connected today, so members cannot receive real SMS, email or WhatsApp messages.
- **SMS:** Sparrow SMS or Aakash SMS. Buy credits and add the token in *Super admin → Notifications*.
- **Email:** any SMTP provider. Set up SPF/DKIM on your domain so mail isn't marked as spam.
- **WhatsApp:** WhatsApp Business Cloud API (Meta). It needs a verified business and approved message templates for reminders.
- **Payments:** test one real eSewa and one real Khalti payment of a small amount end to end, including a refund.
- **Done when:** a real renewal reminder reaches a real phone, and a real ₹10 payment renews a test membership.

### 2.6 Things the test flagged but couldn't settle
- **Speed with many users at once.** Pages load in 0.1–0.3 s for a single user. With 11 accounts active together on the test computer, some took 12–16 s. Measure this on the real server with realistic load (for example 30 staff and 300 members). If it repeats, look at the database connection pool (`DB_POOL_SIZE`, currently 10), add caching for the owner dashboard queries, and add database indexes where queries are slow.
- **Real devices.** Test on an Android phone (Chrome) and an iPhone (Safari, installed to the Home Screen): push notifications, the camera "Scan pass" button, QR check-in, and the 3D animations on a low-end phone.
- **Accessibility** on the dynamic pages (member detail, import review, forecast detail, support ticket).
- **Legal review.** Have a lawyer review the four policies (`src/content/legal.ts`), especially the governing law (Nepal, Kathmandu courts), the 30-day response and change-notice commitments, and the refund rules for opened supplements.
- **Health checks.** The System page and the health API each keep their own list of checks. Merge them into one so they can't drift apart again.

---

## 3. Should come soon after launch (important, not blocking)

| Item | Why it matters |
|---|---|
| Monitoring and uptime alerts | Know about an outage before a gym calls you |
| In-app refunds | `REFUNDED` exists but nothing sets it; refunds are manual today |
| Account deletion and data-export requests | The Privacy Policy promises them; today they go through support by email |
| Onboarding for a new gym | A guided first week: add plans → import records → first check-ins → first estimate |
| Help centre and short videos in Nepali and English | Front-desk staff change often; self-serve training cuts support load |
| Staff activity report for owners | Owners want to see which staff followed up with at-risk members |
| Offline-tolerant check-in | Nepal internet and power cuts: queue check-ins and sync later |
| Bikram Sambat dates across the UI | Imports already understand BS dates; showing them everywhere helps adoption |

## 4. Later (nice to have)

- A native wrapper (Capacitor) for the Play Store and App Store, if gyms ask for "an app in the store"
- Class scheduling with capacity and waitlists
- Trainer payouts and commission reports
- Multi-branch analytics for gym chains
- Nepali-language interface
- Integrations: biometric/turnstile hardware, accounting software, Google/Meta ads for gyms

---

## 5. Next steps — a practical 8-week plan

| Week | Focus | Outcome |
|---|---|---|
| 1 | Git + private repo, rebuild core tests, create test DB | Code is safe and changes are checked |
| 1–2 | Company registration, PAN/VAT, bank account | You can invoice and be paid |
| 2 | Production hosting, domain, HTTPS, backups, 2FA for admins | A real, secure deployment |
| 3 | Connect SMS, email, eSewa and Khalti; real ₹10 end-to-end tests | Messages and payments work for real |
| 3 | Load test on the real server; fix anything slow | Confidence with many users |
| 4 | Lawyer reviews the policies; real-device testing | Legal and mobile risks closed |
| 4–5 | **Pilot with 3–5 friendly gyms for free** (Kathmandu/Lalitpur) | Real usage, real feedback |
| 5–6 | Fix what the pilots hit; write 2 case studies with numbers | Proof that it recovers revenue |
| 7–8 | Paid launch: convert pilots, start sales outreach | First paying customers |

**The one number to prove in the pilot:** how much membership revenue each gym **recovered** through the Pulse follow-ups (members who were at risk and renewed). That number is your sales pitch.

---

## 6. Different ways to sell GymPulse

### 6.1 Monthly SaaS subscription (the main model — already built)

The pricing is already in the app:

| Plan | Price | Free months | Members | Good for |
|---|---|---|---|---|
| Starter | ₹1,999/month | 1 | up to 100 | Small gyms, yoga studios |
| Growth | ₹3,499/month | 3 | up to 300 | Typical city gym |
| Pro | ₹5,999/month | 5 | up to 500 | Large gyms, multiple branches |

- **Annual prepay:** offer 2 months free for paying a year upfront. It improves cash flow and cuts churn.
- **Add-ons:** SMS/WhatsApp credit packs sold at a margin, extra branches, extra staff seats, custom branding.
- **Pitch the return, not the features:** "If 20 members paying ₹1,500 a month stay one more year, that's ₹3,60,000 your gym keeps." That sentence is already on the landing page.

**Rough sense of scale:** 100 gyms on an average of ₹3,000/month is ₹3,00,000 a month (₹36 lakh a year) before costs.

### 6.2 Marketplace commission (already built)
GymPulse keeps a **10% platform commission** on marketplace sales (PT packs, diet plans, supplements, merchandise). As gyms sell more through the app, this becomes a second income stream that grows without extra sales effort.

### 6.3 Custom deployment / white label (already priced)
For gym chains or franchises that want their own brand or their own server: **₹30,000–₹50,000 setup plus ₹2,000–₹5,000/month maintenance**, as already stated on the pricing page. Good for chains, hotel and resort gyms, corporate gyms and universities.

### 6.4 Vendor and brand partnerships
Supplement, sportswear and equipment brands pay to reach gym members through the marketplace:
- Approved-vendor listings with a revenue share
- Featured placement or sponsored challenges ("30-day streak sponsored by …")
- Keep this honest: the app already says it suggests products "honestly, never pushed". Protect that trust.

### 6.5 Sell through partners (resellers and referrals)
- **Gym equipment suppliers and gym-setup contractors** meet every new gym. Offer them 20–30% of the first year's subscription for each gym they bring in.
- **Accountants and IT freelancers** who serve small businesses.
- **Gym associations / fitness federations in Nepal:** a group discount for members in return for promotion at events.
- **Referral programme for gyms:** one free month for the gym that refers, and one free month for the new gym.

### 6.6 Direct sales (what works first in Nepal)
- **Walk-in demos:** visit gyms in Kathmandu, Lalitpur, Bhaktapur and Pokhara with a phone. Show their own "revenue at risk" by importing their attendance sheet on the spot. The import-and-estimate feature is built for exactly this.
- **Free "retention health check":** the owner uploads last month's register and gets a free report showing who is slipping away and what it's worth. Convert them to a trial from there.
- **WhatsApp and Facebook/Instagram/TikTok** in Nepali and English: short videos of the Pulse screen, and before/after renewal numbers from pilot gyms.
- **Trainers are influencers:** trainers who like the app (bookings, streaks) will recommend it to the next gym they work at.

### 6.7 Expand to similar businesses
The same product works with little change for **yoga and dance studios, martial-arts dojos, swimming pools, futsal and sports clubs, CrossFit boxes, and coaching classes**. Anyone with members, attendance and renewals can use it. Each is a new market with the same codebase.

### 6.8 Other countries
India, Bangladesh and Sri Lanka have the same problem, and similar payment wallets (UPI, bKash). You'd need their payment providers, currency and language. Start only after Nepal is working.

### 6.9 One-time licence or selling the business
- **Licence the software** to a larger company (a gym chain, a fitness-equipment distributor, or an existing gym-software company) for a one-time fee plus support.
- **Sell GymPulse outright** once it has paying gyms. Buyers pay for recurring revenue and retention, usually as a multiple of annual recurring revenue, so grow paying gyms first. A product with no customers sells for very little.

### Which to start with
1. **Direct sales + free pilots + a referral programme** to get the first 10–20 paying gyms.
2. Add **partners (equipment suppliers)** once you have case studies.
3. Grow **marketplace commission** and **vendor partnerships** as usage grows.
4. Consider **white label, other businesses and other countries** after that.

---

## 7. Starting from 0 clients and 0 money

You don't need investors, an office or a team to get the first paying gyms. What you need is a small reliable server, a few free tools, your time, and proof that GymPulse makes a gym money. The product is already built, which is the expensive part. Everything below is about spending as little as possible until customers pay for the next step.

### 7.1 The mindset
- **Sell before you spend.** Every rupee you spend should be pulled by a customer who is waiting for it. Don't pre-buy SMS credits, WhatsApp setup, ads or a lawyer before a gym has asked for it.
- **Your time is the budget.** Walking into gyms, demos, data imports and support are free if you do them yourself. That's the right trade at the start.
- **One number wins the sale:** "you are about to lose ₹X from members who stopped coming". GymPulse calculates it from a gym's own register, for free. Lead with it.
- **Charge early, even a small amount.** A gym that pays ₹1,000 gives you better feedback than ten gyms using it for free.

### 7.2 What it really costs to start
Prices change, so check them. This is the order of magnitude:

| Item | Cheapest sensible option | Rough cost | When |
|---|---|---|---|
| Server (app + database + worker) | One small VPS (2 vCPU, 4 GB RAM) running GymPulse, PostgreSQL and the worker; or a free Postgres tier (Neon/Supabase) plus a small VPS | about NPR 1,000–3,000 a month | Before the first pilot |
| Domain | A `.com` domain; a `.com.np` domain is free through the national registry but needs documents | ₹0–2,000 a year | Before the first pilot |
| HTTPS certificate | Let's Encrypt | Free | With the server |
| Database backups | A daily `pg_dump` to cheap object storage, or the provider's backup | Free–low | With the server |
| Email sending | A free transactional-email tier (a few hundred emails a day) | Free at the start | Before the first pilot |
| SMS reminders | Sparrow or Aakash SMS, pay per message | Pay as you go; pass it on to gyms as an add-on | When a paying gym wants SMS |
| WhatsApp Business API | Meta Cloud API | Later | When gyms ask for it |
| eSewa / Khalti | Each gym connects **its own** merchant account | ₹0 to you | When a gym wants online renewals |
| Company registration, PAN | Firm or Pvt. Ltd. registration | One-time fees; ask an accountant | **Before you issue the first invoice** |
| Lawyer review of the policies | A few hours of a lawyer's time | One-time | From your first income, before scaling |
| Marketing | Facebook page, WhatsApp Business, Google Business Profile, Canva | Free | Day 1 |

**Minimum monthly spend to run pilots: roughly the cost of the server.** Everything else is free, pay-as-you-go, or can wait for the first payment.

> Don't run pilots from this laptop. It restarts, sleeps and loses connection, and one missed reminder or lost check-in costs you the gym's trust. A small paid server is the one thing worth paying for from day one.

### 7.3 What you can safely postpone
- **Native Play Store / App Store apps.** GymPulse is already an installable web app (PWA).
- **WhatsApp API, paid ads, a sales team, an office.**
- **Custom features for one gym.** Note the request; build it when three gyms ask.
- **Perfect automation.** Do imports and onboarding by hand for the first 20 gyms. You'll learn what to automate.

### 7.4 Getting the first gyms (with no money)

**Step 1 — make a list (1 day).** Open Google Maps and list every gym, yoga studio and fitness centre within reach: name, owner or manager, phone, and whether they use an attendance register, Excel or other software. Aim for 50–100. Start with gyms that have 80–300 members; they feel member loss the most.

**Step 2 — prepare your demo kit (1 day).**
- A phone or laptop with GymPulse open on your demo account.
- A one-page "Retention health check" PDF (made in Canva): *"Give us last month's attendance register. In 10 minutes we'll show you which members are slipping away and how much revenue that is. Free, no obligation."*
- A WhatsApp Business profile with the landing-page link and short screen recordings of the Pulse screen and QR check-in.

**Step 3 — visit in person (5 gyms a day).** In Nepal, trust is built face to face. Go when owners are there, usually late morning or mid-afternoon, avoiding the 6–9 am and 5–8 pm rush.

**What to say at the desk:**
> "Namaste, I've built software for gyms here that shows which members are about to stop coming, before they leave, and how much money that is. If you let me photograph last month's register, I'll show you your own numbers in ten minutes — free. If it's not useful, no problem."

**Step 4 — show their own numbers.** Photograph or upload their register in *Analyze Records*. The owner sees *"23 members haven't visited in 10+ days — ₹34,500 of monthly fees at risk"* with names. That moment sells the product. Don't pitch features.

**Step 5 — offer a free pilot, with conditions.** For the first 3–5 gyms:
- Free for 4–6 weeks. The plans already include free months, so you can use those.
- In return: they use it daily at the desk, you can publish their results as a case study, and they introduce you to one other gym owner.
- Agree the goal up front: *"If Pulse helps you renew at least 5 members who would have left, you'll move to a paid plan."*

**Step 6 — make the pilot succeed.** Do the setup yourself: import members, add plans, print the kiosk QR poster, and train the front desk in 20 minutes. Visit weekly. Every week, send the owner a WhatsApp summary: *"This week: 6 at-risk members contacted, 3 came back, ₹4,500 of fees kept."*

**Step 7 — convert and ask for referrals.** At the end of the pilot, show the recovered-revenue total and move them to a paid plan. Offer 2 free months for paying a year upfront; that cash funds your next steps. Ask for two introductions to other gym owners.

**WhatsApp follow-up after a visit:**
> "Namaste [name] ji, thanks for your time today. Here's the report from your register: [screenshot]. 23 members, ₹34,500 a month at risk. I can set up GymPulse for you this week, free for the first month, and help your desk call these members. Shall I come on Thursday?"

**Follow-up rhythm:** same day (report), day 3 (short video of a similar gym), day 7 (visit or call). Then monthly, with something useful each time, such as a tip about retention.

### 7.5 Where the first money goes
Spend in this order, only as money comes in:
1. **Server and backups:** keep the product reliable.
2. **Company registration and PAN:** before your first invoice, so you can bill legally.
3. **SMS credits** for gyms that want reminders (charge them for it).
4. **Lawyer review** of the policies.
5. **Error monitoring and a proper backup-restore test.**
6. **Small paid ads** (Facebook/Instagram, targeted at gym owners in your city) only once walk-in demos convert reliably, because then you know what message works.
7. **A part-time helper** for onboarding, when you can't visit new gyms anymore.

### 7.6 A 90-day plan from zero

| Days | Goal | Money in | Money out |
|---|---|---|---|
| 1–7 | Git repo, small server, domain, HTTPS, backups; list 50 gyms; demo kit | ₹0 | Server + domain |
| 8–21 | Visit 50 gyms; 15 health checks; 3–5 free pilots | ₹0 | Server |
| 22–45 | Pilots succeed; weekly results to owners; register the business | ₹0 | Registration fees |
| 46–60 | Convert pilots to paid; first invoices; first referrals | First 3–5 gyms paying | SMS credits (recharged to gyms) |
| 61–90 | 10 paying gyms; 2 written case studies; start equipment-supplier partners | About ₹20,000–35,000 a month (10 gyms on Starter–Growth) | Lawyer review, monitoring |

**Ten paying gyms** means the product has proved itself and pays its own running costs. From there, the sales methods in section 6 can take over.

### 7.7 Numbers to track every week
- Gyms visited → health checks done → pilots started → paying gyms (conversion at each step)
- Monthly recurring revenue (MRR) and how many gyms cancelled (churn)
- Revenue each gym recovered through Pulse (your best sales proof)
- Hours of support per gym (if this rises, fix the product or the onboarding)

### 7.8 Mistakes that sink bootstrapped software
- Spending on ads, an office or hires before 10 paying customers
- Giving the product away free for too long; pilots need an end date and a price
- Building every feature one gym asks for
- Skipping backups, and then losing a gym's data
- Invoicing before the business is registered
- Chasing big gym chains first; they buy slowly. Win independent gyms, then approach chains with proof

---

## 8. Checklist — "ready for the first paying gym"

- [ ] Code in a private git repository; `.env` not committed
- [ ] Automated tests rebuilt and passing; Playwright tests in their own folder
- [ ] Company registered; PAN (and VAT if needed); business bank account
- [ ] Production server on your domain with HTTPS; daily database backups; restore rehearsed
- [ ] `APP_ENV=production`, `ALLOW_ADMIN_WITHOUT_MFA=false`, new secret keys, real SMTP
- [ ] Background worker running as its own process; error alerts configured
- [ ] SMS provider connected; one real reminder received on a real phone
- [ ] eSewa and Khalti: one real small payment and one refund done end to end
- [ ] Load test on the real server acceptable
- [ ] Tested on a real Android phone and a real iPhone
- [ ] Lawyer has reviewed the four policies; real support address set in *Super admin → Settings → `platform.supportEmail`* (currently the placeholder `support@gympulse.example`, which every policy page shows)
- [ ] 3–5 pilot gyms running for at least 2 weeks with no blocking issues
- [ ] Pricing page, invoices and onboarding tested with a gym that isn't a friend

When every box is ticked, GymPulse is ready to sell.
