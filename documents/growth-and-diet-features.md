# Growth & diet features: member self-signup, Google sign-in, diet plans, lead capture, gym promotion

This document covers what each feature is for, how it works, where it lives in the code, and what to build next.

## 1. Why these features

A gym in Nepal usually finds members through word of mouth, a Facebook page and walk-ins. Each of those breaks in a predictable place:

| Problem | Feature that fixes it |
|---|---|
| A person who wants to join has to come in during desk hours | **Public gym page + online joining** (`/g/<slug>`, `/g/<slug>/join`) |
| Creating yet another password stops people | **Continue with Google** |
| Enquiries live in WhatsApp chats and get forgotten | **Enquiries (leads) pipeline** in Grow |
| Happy members would bring friends, but nothing rewards it | **Referral links** with a reward the owner sets |
| Festival offers live on paper and nobody can measure them | **Offers** with share links, a printable QR poster, and a "joined through it" count |
| Members ask trainers what to eat, and the answer gets lost | **Diet plans**: templates, assignment, a member diet screen, a calculator |
| Nobody can find the gym online | **"Find a gym" directory** (`/gyms`) |

## 2. Member self-signup (joining online)

**Owner turns it on:** Grow → *Edit page* → "Publish my gym page" and "Let people join online". Both are **off by default**.

**Visitor flow:**
1. They open `/g/<slug>`, from a shared link, the poster QR or the directory, and see the tagline, offers, plans and prices, about, hours, amenities, phone and WhatsApp.
2. *Join online* or *Claim this offer* opens `/g/<slug>/join`. They enter name, email, mobile and password (or use Google) and pick a plan.
3. The server creates the account and a member record (`source = SELF_SIGNUP`), signs them in, and sends them to `/app/renew` with the plan pre-selected and the offer's coupon already applied.
4. The member pays online (eSewa/Khalti) or at the desk. **Joining alone never grants gym access.** The member has no membership until payment, and check-in still requires an active membership.

**Safety rules (each one has a test):**
- If the email or phone already has an account, the person is asked to **sign in first**. No password is checked on this endpoint, so it can't be used to guess passwords.
- If someone types a phone or email that is already on a member record, they are **not linked** to that record, because anyone could type someone else's number. The reply doesn't reveal the match. Staff get a "possible duplicate of M-000xx" note on the new record instead.
- Staff of the gym can't join as members of the same gym.
- Referral codes and offer ids from **another gym** are ignored.
- Requests are limited per IP and per gym, a honeypot field catches bots, and the gym's plan member limit is respected.
- If the typed phone or email matches an open enquiry, the enquiry only gets a note ("joined online as M-000xx"). Staff confirm it, because the details typed on the join form are unverified.
- Unpaid online sign-ups don't count toward the gym's member quota until they buy a plan.

## 3. Continue with Google

- OpenID Connect authorization-code flow with **PKCE, state and nonce**. These travel in a 10-minute, signed, httpOnly cookie scoped to `/api/auth/google`.
- The ID-token claims checked are issuer, audience, expiry, nonce, subject and `email_verified === true`.
- The button appears on **Sign in**, **Join** and **Account & security** (*Connect Google*). It is hidden until the server is configured.
- **Account linking:**
  - If the Google account is already linked, that account signs in.
  - If the person is signed in, Google is connected to their current account (Account & security → *Connect Google*), but only when the Google email is the account's own email.
  - An existing account with the same email is **never auto-linked**, even if it is marked verified. An invite (whose link the inviter can see) or an online join could have created that account for someone else's address. The person signs in with their password, or uses *Forgot password*, and then connects Google.
  - Otherwise a new passwordless account is created with the email marked verified.
  - *Forgot password* removes any Google link whose email differs from the account's email, and marks the email verified.
  - *Disconnect* is available once the account has a password.
- Accounts with two-step verification still need their code (`/login/mfa`). Disabled accounts are refused.

**Setup:**
1. In Google Cloud Console, go to APIs & Services → Credentials → OAuth client ID (Web).
2. Add the authorised redirect URI `https://<your-domain>/api/auth/google/callback`.
3. Set these in `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
`APP_URL` must match the domain users visit.

## 4. Diet plans

**Staff** (`/app/diet`, permission `diet.manage`: Owner, Manager and Trainer by default):
- **Templates** are reusable plans with a goal, calories, protein/carbs/fat, water, meals and notes. *Add starter templates* adds four plans built on Nepali home food: fat loss, muscle gain, vegetarian balanced, and healthy start.
- **Give to member** copies a template onto a member. Later template edits don't change the copy. The member's previous plan is kept as history, and the member gets an in-app notification.
- **Trainers only see and change plans of members assigned to them**, enforced in every route and covered by the trainer-scope sweep test.
- Meals are edited as one line each: `time | meal | what to eat | kcal`.

**Members** (`/app/diet`, plus a card on Home and a *Diet* tab):
- Daily targets, a meal-by-meal day, notes from the trainer, and earlier plans.
- **Calculator** (Mifflin-St Jeor): sex, age, weight, height, activity and goal give calories, protein, carbs, fat, water and BMI, using Asian BMI cut-offs. The result never goes below a safe floor of 1200/1500 kcal. It runs in the browser and nothing is stored. A not-medical-advice note is shown.

## 5. Attracting new customers

**Grow page** (`/app/grow`). Permissions: `leads.manage` (Owner, Manager, Staff) and `promotions.manage` (Owner, Manager).
- **Numbers for the last 30 days:** enquiries, % that became members, joined online, joined by referral.
- **Your gym page:** live status, copy link, *Share on WhatsApp*, *Share on Facebook*, *Print poster with QR*.
- **Enquiries:** a repeat request from the same phone or email only adds a note. It never changes the enquiry's contact details. Free-trial requests from the page plus walk-ins and calls that staff log. The list can be filtered by stage (New → Contacted → Trial booked → Joined / Not joining). Each enquiry has one-tap call and WhatsApp (with a pre-written message), notes, and **Make member**, which creates the member record exactly once even on a double click.
- **Referrals:** each member gets a personal random code and link on their Home screen ("Bring a friend", with WhatsApp share and copy link) and sees how many friends joined. The owner sets the reward text (e.g. "You both get 1 week free"). The Grow page shows the top referrers.
- **Directory** (`/gyms`): searchable by gym name or city. A gym can opt out of being listed.

## 6. Gym promotion (offers)

- An offer has a headline, details, a badge ("20% OFF"), an optional coupon, an optional plan, start and end dates, and a choice of public or link-only. Coupons and plans must belong to the same gym.
- Each offer has a **share link** (`/g/<slug>?promo=<id>`). That link highlights the offer, pre-selects its plan and applies its coupon at checkout. Enquiries and members are tagged to the offer, and the Grow page shows "N joined through it".
- **Printable poster** (`/g/<slug>/poster?promo=<id>`): an A4 flyer with the offer, three prices and a QR code. Use it for the counter, the entrance, and nearby shops.
- Offers hide themselves outside their date window.

## 7. Data model (migration `20261006120000_growth_diet_oauth`)

- `OAuthAccount` (provider, subject → user)
- `Lead` (enquiry: contact, goal, source, status, referrer, offer, converted member)
- `GymPromotion` (the gym's own offers; separate from the platform marketplace `Promotion`)
- `DietPlan` (template or per-member copy; meals stored as JSON)
- `Member.referralCode`, `referredById`, `promotionId`
- Gym settings: `publicPage { enabled, allowSelfSignup, listInDirectory, showPrices, tagline, about, openingHours, amenities }` and `growth { referralReward }`
- New permissions: `leads.manage`, `promotions.manage`, `diet.manage`

## 8. Ideas for next iterations

1. **Automatic follow-up:** an automation that reminds staff about enquiries left uncontacted for 24 hours, and texts the person the day before their trial.
2. **Referral reward ledger:** when a referred friend's first payment succeeds, credit the referrer (free days or a coupon) automatically instead of handing it out at the desk.
3. **Trial passes:** a one-day QR pass for a booked trial, so trial visits show up in attendance and conversion can be measured from them.
4. **Body progress tracking:** members log weight and measurements, and the diet calculator pre-fills from the latest entry. Trainers see the trend.
5. **Meal check-ins:** members tick off meals, and diet streaks build on the existing streak engine.
6. **Win-back offers:** send an offer link to members marked *Lost* by the churn estimate.
7. **Gallery and reviews:** photos and member testimonials on the public page, with an SEO sitemap for `/g/*`.
8. **Owner signup with Google:** today Google covers sign-in and member joining. Gym creation still uses the email form.
