# GymPulse User Guide

GymPulse helps gym owners in Nepal recover lost revenue by identifying at‑risk members, quantifying the financial impact, and providing a simple recovery system. This guide walks you through everything you need to use the system effectively.

---
## 🚀 Getting Started

### Installation
1. Ensure you have Node.js 18+ installed.
2. Clone the repository: `git clone https://github.com/your-org/gympulse.git`
3. Install dependencies: `npm install`
4. Start the development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Logging In
- **Demo credentials**: `owner@pulsefitness.demo` / `GymPulse!Demo2026`
- Roles: **Owner**, **Trainer**, **Staff**
- First‑time users should complete the **Retention Health Check** demo (import a sample CSV or photograph the register).

### Dashboard Overview
The home screen shows three key widgets:
- **At‑Risk Members**: Count and total revenue at risk (members who haven't visited in 10+ days).
- **Recent Check‑ins**: List of today's/check‑in activity.
- **Quick Actions**: Import CSV, add member manually, view reports.

---
## 👥 Member Management

### Adding Members Manually
1. Click **Add Member** in the sidebar.
2. Fill in: Name, Phone, Email, Join Date, Membership Plan.
3. Save. The member appears in the **Members** list.

### Importing CSV
1. Prepare a CSV with columns: `name,phone,email,join_date,plan` (or use the provided `sample-attendance-august-2026.csv`).
2. Go to **Import** and upload the file.
3. GymPulse will map the data, flag any duplicates, and add the members.

### Check‑in Process
- **QR Check‑in**: Display the QR code on the front‑desk screen. Staff scan when a member arrives.
- **Manual Check‑in**: Open a member's profile and click **Check‑in**. The system records the visit date/time and updates the "last visited" field.

---
## ⚠️ At‑Risk Member Detection

### How It Works
- The system flags a member as **at‑risk** if they have not checked in for **10 or more days**.
- At‑risk members are highlighted in red on the dashboard.

### Viewing At‑Risk Members
1. Navigate to the **At‑Risk** tab.
2. See a list of members, days since last visit, and associated monthly fee.
3. Filter by plan, branch, or date range.

### Recovery Actions
- **Assign a Trainer**: Click a member, select a trainer from the dropdown, and add a note.
- **Contact the Member**: Use the recorded phone number to call or send a WhatsApp reminder.
- **Track Outcome**: After contact, update the status: `Contacted`, `Returned`, `Churned`.

---
## 📊 Analytics & Reports

### Revenue at Risk Dashboard
- Shows **total monthly revenue at risk** across all at‑risk members.
- Interactive chart: trend over the last 30 days.
- Drill‑down to per‑gym or per‑trainer views.

### Recovered Revenue Report
- Generates a report of members who returned after intervention.
- Includes: member name, days lost, revenue recovered, trainer name, date of return.
- Export as CSV or PDF.

### Export Data
- Select a time range and export members, check‑ins, or at‑risk data as CSV.
- Useful for external analysis or sharing with accountants.

---
## 💰 Pricing & Plans

### Monthly SaaS Plans
| Plan | Price/Month | Free Months | Member Limit | Good For |
|------|-------------|-------------|--------------|----------|
| **Starter** | ₹1,999 | 1 | 100 | Small gym, yoga studio |
| **Growth** | ₹3,499 | 3 | 300 | Typical city gym |
| **Pro** | ₹5,999 | 5 | 500 | Large gym, multiple branches |

### Annual Deal (Upsell)
> **"Pay for 10 months, get 12 months"** — 2 months FREE  
> - Improves cash flow  
> - Reduces churn (locked in for a year)  
> - **Pitch line**: "That's like getting 2 months free — most gyms take this."

### Add‑Ons (Extra Revenue Streams)
| Add‑On | Price | When to Sell |
|--------|-------|--------------|
| Extra branch | ₹500–1,000/mo | Gym has 2+ locations |
| Extra staff seat | ₹200/mo | Beyond plan limits |
| SMS/WhatsApp credits | At cost + 20% margin | Gym wants member reminders |
| Custom branding | ₹2,000 setup | Owner cares about brand |
| White label | ₹30,000–50,000 + ₹2,000–5,000/mo | Chains, hotels, corporate |

### Marketplace Commission
- **10% platform fee** on every marketplace sale (PT packs, supplements, merch).
- Gym keeps 90%, you keep 10%.
- Grows automatically as gyms sell more.

---
## 🛒 Marketplace

### Buying PT Packs & Merch
1. Go to **Marketplace** from the main menu.
2. Browse categories: PT Sessions, Supplements, Merchandise.
3. Purchase using wallet balance or pay via link sent to owner's WhatsApp.

### Selling as Gym Owner
- Upload PT packs or merchandise to the marketplace.
- Set your own pricing; GymPulse takes 10% commission.
- Track sales and earnings in the **Revenue** tab.

---
## ⚙️ Settings

### Gym Profile
- Update gym name, address, contact number, and timezone.
- Enable/disable **White Label** mode (removes GymPulse branding).

### Staff Accounts
- Add trainers/staff members with individual logins.
- Assign roles: **Full Access**, **Check‑in Only**, **Viewer**.

### Notification Settings
- Configure **WhatsApp reminders** for at‑risk members.
- Set **SMS gateway** details (optional, for areas with unreliable internet).
- Choose ** offline sync** behavior for check‑ins.

### Branding & White Label
- Upload your gym’s logo.
- Customize colors and primary font.
- White‑label plan includes removal of all GymPulse references and a custom subdomain.

---
## ❓ Support

### Help Center
- Access in‑app FAQs, video tutorials, and troubleshooting guides.
- Search by topic or browse categories: *Setup, Check‑in, Reports, Billing*.

### Contact Support
- Email: `support@gympulse.io`
- In‑app chat (available during IST business hours: 9 AM – 6 PM).
- For urgent technical issues, include: screenshots, browser version, and steps to reproduce.

### Frequently Asked Questions
| Question | Answer |
|----------|--------|
| **How do I reset my password?** | Use the "Forgot Password" link on the login page; a reset link will be sent to your registered email. |
| **Can I use GymPulse without internet?** | Yes — check‑ins queue offline and sync automatically when connection is restored. |
| **What if I exceed my member limit?** | The system will warn you; you can upgrade your plan or remove inactive members. |
| **How is member privacy protected?** | Phone numbers and emails are stored encrypted; only staff with appropriate roles can view them. |

---
## 📅 Quick Reference Cheat Sheet

| Action | Shortcut / Location |
|--------|----------------------|
| Add member manually | **+ Add Member** in sidebar |
| Import CSV | **Import** page |
| Check‑in member | **Check‑in** button on member profile |
| View at‑risk members | **At‑Risk** tab |
| Export report | **Export** dropdown on any report page |
| Change plan | **Settings → Billing** |
| Contact support | **Help → Contact** |

---
**Good luck!** 💪  
*Need to re‑read the Roadmap doc (section 7) for the zero‑budget startup playbook, or the DOCUMENTATION.md for every feature detail.*