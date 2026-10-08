/**
 * GymPulse's public policies. Source for the seed and for publishing new versions; staff edit later versions in
 * Super Admin → Content. Light markup: "## " and "### " headings, "- " list items, blank lines between paragraphs.
 * {{supportEmail}} is filled from the platform.supportEmail setting when the page renders.
 *
 * Facts stated here are taken from how the product works (commission rules, file retention, payment flow, plan
 * terms); keep them in step when that behaviour changes.
 */
export type LegalKey = "terms" | "privacy" | "refund" | "marketplace_terms";

export const LEGAL_DOCS: Record<LegalKey, { title: string; summary: string; body: string }> = {
  terms: {
    title: "Terms of Service",
    summary: "The agreement between GymPulse and the gyms that use it, and the rules for everyone who signs in.",
    body: `These terms are the agreement between GymPulse and the gym that opens an account ("your gym", "you"). They also apply to everyone who signs in to GymPulse — owners, staff, trainers, members and marketplace vendors. By creating an account or signing in, you agree to them.

Two other documents are part of these terms: the Privacy Policy explains how personal data is handled, and the Marketplace Terms and Refund Policy cover buying through a gym's marketplace.

## 1. Accounts and sign-in

- Give accurate details when you create an account, and keep them up to date.
- Keep your password private. Use two-step verification where it's offered; gym owners and managers should turn it on.
- A login is for one person. Don't share it.
- Gym owners decide which staff get access and what each role can do. You're responsible for what your staff do with the access you give them.
- Tell us straight away at {{supportEmail}} if you think someone has got into your account.

## 2. Plans, free months and billing

- Each plan includes a number of free months, shown on the pricing page when you sign up. No payment card is needed to start.
- After the free months, the plan is billed monthly in Nepali rupees. Invoices appear in Settings → GymPulse plan, and any taxes that apply are shown on the invoice.
- Plans have limits: how many members and staff accounts you can have, and how many record imports, risk estimates and messages you can use each month. When a monthly limit is reached, that feature pauses until the next month or until you upgrade. When the member or staff limit is reached, you can't add more until you upgrade, or archive members or turn off staff accounts you no longer need. Reaching a limit never deletes your data.
- You can cancel at any time. Your gym keeps access until the end of the month it has paid for. The Refund Policy explains when fees are refunded.
- A private setup (GymPulse on its own server, just for your gym) is priced separately, in a written quote.
- If an invoice becomes overdue, your plan is marked "Past due" (unpaid) in Settings → GymPulse plan and we'll contact you before any change to your access. We never delete data because a payment is late.

## 3. Your gym's data

- Your gym owns the member records, attendance, payments and files it puts into GymPulse. We use them only to run the service for you, as the Privacy Policy describes.
- You're responsible for having the right to collect and use your members' information, and for telling members that you use GymPulse.
- When you upload a register or spreadsheet, we read it so you can review it before anything is imported. The original file is deleted automatically after 7 days (you can change this to anywhere from 1 to 90 days, or delete it sooner).
- You can export your reports at any time. If you close your account, ask us and we'll delete your gym's data, except records we must keep by law, such as invoices.

## 4. Estimates and messages

- "At risk" alerts and estimates of who may leave are only estimates. They are shown with a range and a confidence level. They help staff decide who to contact first. They aren't guarantees, and they shouldn't be the only basis for a decision about a person.
- Messages you send through GymPulse (SMS, email, WhatsApp, in-app and push) must be lawful and relevant to your gym. Members can turn off categories of messages, and you must respect that. Security messages are always sent.
- SMS and WhatsApp are delivered through providers your gym connects. Their charges are between you and them.

## 5. Payments your gym collects

- Online payments for memberships and marketplace orders go to your gym's own eSewa or Khalti merchant account. Your gym is the seller; GymPulse is not a party to the membership or sale.
- Cash, bank transfer and card-machine payments are recorded by your staff, and GymPulse issues a receipt for each.
- Refunds of these payments are your gym's decision, following the Refund Policy.

## 6. Acceptable use

Don't use GymPulse to:

- break the law, or upload information you have no right to use;
- send spam or messages people have opted out of;
- try to access other gyms' data, test our security without permission, or overload the service;
- copy, resell or reverse-engineer the service, or scrape it with automated tools;
- upload viruses or other harmful code.

We may suspend access that puts other gyms, members or the service at risk. Where we can, we'll tell you first and explain why.

## 7. Availability and changes

We work to keep GymPulse available and secure, but it may occasionally be unavailable for maintenance or reasons outside our control. Features may change as the product improves. If we make a change that affects you in an important way, we'll tell you in the app or by email at least 30 days before it takes effect.

## 8. Ending the agreement

You can stop using GymPulse and cancel your plan at any time. We may end or suspend an account for serious or repeated breaches of these terms, or for fees left unpaid after reminders. Before an account closes, we'll give you a reasonable chance to export your data, unless the law prevents it.

## 9. Liability

GymPulse is provided with reasonable care and skill. To the extent the law allows, we aren't liable for indirect losses such as lost profits, and our total liability in any 12-month period is limited to the fees your gym paid us in that period. Nothing in these terms limits liability that can't be limited by law.

## 10. Law and disputes

These terms are governed by the laws of Nepal. If something goes wrong, contact us first — most problems are solved quickly. Disputes that can't be settled will be handled by the courts in Kathmandu.

## 11. Contact

Questions about these terms: {{supportEmail}}, or Settings → Support inside GymPulse.`,
  },

  privacy: {
    title: "Privacy Policy",
    summary: "What personal data GymPulse holds, why, who it's shared with, and the choices you have.",
    body: `This policy explains how GymPulse handles personal information for gyms, their staff, their members and marketplace vendors.

## Who is responsible

- **Member information** (names, contact details, attendance, memberships, payments) belongs to the gym you joined. The gym decides how it's used. GymPulse processes it on the gym's behalf and only on its instructions.
- **Accounts of gym owners, staff and vendors, and gym billing,** are handled by GymPulse directly.

If you're a member with a question about your data, start with your gym. You can also write to us at {{supportEmail}} and we'll help or pass it on.

## What we hold

- **Account details:** name, email, mobile number and your password, stored in a scrambled form. We never store passwords in a form anyone can read.
- **Membership records:** member ID, plans, start and end dates, trainer, notes staff add, and card or wristband IDs used for check-in.
- **Attendance:** each check-in, how it was made (at the desk, by scanning the gym's QR code, or with a card) and the branch.
- **Payments:** amounts, method, references and receipts. Card and wallet details stay with eSewa or Khalti; we never see them.
- **Marketplace:** orders, bookings and sessions used.
- **Uploaded files:** registers, spreadsheets and photos your gym uploads to import records.
- **Messages and preferences:** notifications sent to you and which kinds you've turned off.
- **Technical data:** the device and browser you sign in from, IP address, sign-in times, and — if you turn on phone or desktop alerts — the address your browser gives us for delivering them.

## How it's used

- To run the gym's day-to-day work: memberships, check-ins, renewals, receipts, bookings and the marketplace.
- To remind members about renewals and to let staff follow up with members who haven't visited.
- To produce estimates of which members may stop coming. These are calculated from attendance and membership patterns so staff know who to contact first. They're never used to make automatic decisions about a person, and staff can see the reasons behind each one.
- To keep accounts secure, prevent misuse and keep an audit log of important actions.
- To bill gyms for GymPulse and provide support.

We don't sell personal information, we don't use it for advertising, and we don't use one gym's data for another gym.

## Who it's shared with

Only as needed to provide the service:

- **Payment providers** (eSewa, Khalti) to take online payments into the gym's account.
- **Messaging providers** the gym connects, such as Sparrow SMS or Aakash SMS, WhatsApp (Meta), and the gym's email provider, to deliver messages.
- **Browser push services** (for example Google, Apple, Mozilla or Microsoft, depending on your browser) to deliver phone and desktop alerts. Alert contents are encrypted so these services can't read them.
- **Marketplace vendors** receive the details they need to deliver your order.
- **Our hosting provider,** which stores data for us and must keep it secure.
- **Authorities,** when the law requires it. We refuse requests that aren't lawful.

## Cookies and device storage

GymPulse uses only the cookies needed to keep you signed in securely. There are no advertising or tracking cookies. The app may also save small things on your device, such as your offline page and display preferences, so it works well on a phone.

## How long it's kept

- Uploaded import files are deleted automatically after 7 days by default. Each gym can change this to anywhere from 1 to 90 days, or delete a file straight away.
- Member records stay while the gym uses GymPulse. When a gym archives a member, the history stays available for the gym's reports until the gym asks for it to be deleted.
- Sign-in sessions expire, and signing out removes that device from phone and desktop alerts.
- Billing records are kept as long as tax law requires.
- When a gym closes its account and asks us to, we delete its data, apart from records we must keep by law.

## How it's protected

Uploaded files and the keys that connect your gym to eSewa and Khalti are encrypted. Passwords are stored in a scrambled form. Staff see only what their role allows, important actions are recorded in each gym's audit log, and repeated sign-in attempts are limited. Two-step verification is available for every account.

## Your choices and rights

Under the laws of Nepal, including the Individual Privacy Act, 2075, you can ask to see the personal information held about you, correct it, or have it deleted where it's no longer needed.

- **Members:** ask your gym first; they can correct your details directly. You can turn off message types in Notifications → preferences, and turn phone alerts on or off per device.
- **Owners, staff and vendors:** manage your account in Account & security, or write to {{supportEmail}}.

We'll respond within 30 days.

## Children

Gyms may register members under 18. The gym is responsible for getting consent from a parent or guardian where needed.

## Changes

If we change this policy in a way that matters, we'll tell you in the app before the change takes effect. The date at the top shows when it was last updated.

## Contact

{{supportEmail}}`,
  },

  refund: {
    title: "Refund Policy",
    summary: "How refunds work for payments you make to your gym, and for gyms' GymPulse subscriptions.",
    body: `This policy covers two kinds of payment: what members pay their gym, and what gyms pay GymPulse.

## Payments to your gym

Memberships, renewals and marketplace purchases are paid to your gym. Online payments go straight into the gym's own eSewa or Khalti account, so **your gym decides and makes refunds**. GymPulse keeps the records and receipts that make this quick.

### How to ask for a refund

- Speak to the front desk, or contact your gym, and give them the receipt number (it starts with "R") or the payment reference.
- The gym refunds online payments to the same eSewa or Khalti account, and cash payments at the desk.
- Each gym sets its own rules for refunding unused membership time — ask at the desk. Renewing early never costs you days: the new period starts when the current one ends.

### When you should always get your money back

- **You were charged twice** for the same thing.
- **A payment shows as failed but money left your account.** A failed payment doesn't extend your membership or place an order. Give your gym the payment reference so they can check it with eSewa or Khalti.
- **You paid for something the gym can't provide,** such as a product that turned out to be out of stock, or a service the gym cancelled.

### Marketplace purchases

- Unused sessions in a class pack or personal-training bundle follow the gym's own policy.
- Products can be returned if they're faulty or not as described. Supplements and food can't be returned once the seal is opened, for safety reasons.
- A coupon discount comes off the refund amount; coupons have no cash value.

## GymPulse subscriptions (for gyms)

- Free months are free — there's nothing to refund and no card is needed to start.
- After the free months, plans are billed monthly. You can cancel at any time and keep access until the end of the paid month. We don't refund part-used months.
- We refund in full: billing mistakes, charges made after you cancelled, and double charges.
- Fees for a private setup follow the terms in your written quote.

To ask about a GymPulse charge, write to {{supportEmail}} or use Settings → Support within 30 days of the charge. We reply within 5 working days and refund to the original payment method.`,
  },

  marketplace_terms: {
    title: "Marketplace Terms",
    summary: "The rules for buying training, classes, plans and products through your gym's marketplace.",
    body: `Your gym's marketplace sells personal training, classes, diet plans, assessments and products, from the gym itself and sometimes from vendors the gym has approved. These terms apply alongside the Terms of Service and the Refund Policy.

## Who sells to you

- Each listing is sold by your gym or by the vendor named on it. The seller is responsible for what they sell, for describing it accurately, and for providing it.
- GymPulse runs the marketplace and takes a commission from each sale — by default 10% of the price. This doesn't change what you pay.
- Vendors are businesses approved to sell through the gym. They must follow the law and these terms.

## Prices and payment

- Prices are shown in Nepali rupees and include everything you'll pay at checkout.
- You pay online through your gym's eSewa or Khalti account. Your order is confirmed only once the payment succeeds. If a payment fails or you cancel it, the order isn't confirmed and you aren't charged.
- A coupon can be used once per member unless it says otherwise. It can't be exchanged for cash and can be withdrawn by the gym.

## Services and bookings

- Buying a service, such as a personal-training pack or a class pack, creates a booking. The gym or trainer arranges each session with you and keeps count of the sessions used.
- If you can't make a session, tell the gym as early as you can. Missed sessions and late cancellations follow the gym's own policy.
- Unused sessions don't transfer to another person unless the gym agrees.

## Products

- Products are collected from the gym unless the listing says otherwise. The gym marks your order as delivered when you receive it.
- Stock is limited. If an item runs out after you've paid, you'll get a full refund.

## Health and safety

Diet plans, supplements and training are general fitness services, not medical advice. Check with a doctor before starting a new training program or supplement, especially if you have a health condition, are pregnant or take medication. Tell your trainer about any injury.

## Returns and refunds

Returns and refunds follow the Refund Policy. Contact your gym first; they'll involve the vendor where needed.

## Your conduct

Don't abuse coupons, place orders you don't intend to pay for, or misuse the marketplace. The gym may cancel orders that break these terms.

## Contact

Questions about an order: ask your gym. Questions about the marketplace itself: {{supportEmail}}.`,
  },
};
