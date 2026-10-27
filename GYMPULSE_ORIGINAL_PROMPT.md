
# GYMPULSE — COMPLETE MASTER BUILD PROMPT

Build a **production-ready, ultra-premium, multi-tenant SaaS web application called GymPulse** for small and medium-sized local gyms in Nepal, serving approximately **50–500 members per gym**.

GymPulse is a:

**Member Retention + Revenue Recovery + Attendance + Renewal + Marketplace + Gym Operations SaaS**

Its central purpose is to identify members who are quietly disengaging, estimate potential membership loss, help gym staff intervene early, automate renewals, and increase revenue from existing members.

The core product loop is:

# DETECT → PREDICT → ENGAGE → RECOVER → RENEW → UPSELL

The application must feel like a **premium commercial SaaS product**, not a generic admin template.

***

# 1. CORE PROBLEM

Small gyms often lose recurring revenue silently.

A member may:

- Stop attending

- Attend less frequently

- Ignore staff

- Continue paying temporarily

- Eventually stop renewing

The owner often notices the problem too late.

GymPulse should turn attendance and membership records into an actionable retention system.

Primary metric:

# REVENUE AT RISK

The system should answer:

> **Who is likely to leave?**

> **Why are they becoming inactive?**

> **How many members could potentially be lost?**

> **How much revenue could be affected?**

> **Who should staff contact today?**

> **How many members were recovered?**

> **How much revenue was protected?**

***

# 2. IMPORTANT: PREDICTION MUST BE AN ESTIMATE

The prediction feature must never claim certainty.

Never say:

> "This member will leave."

Instead say:

> **"Estimated churn risk: High"**

or:

> **"Estimated 3-month member loss: 18–25 members."**

Always show:

- Estimate

- Confidence/uncertainty

- Data quality

- Date range analyzed

- Factors used

Example:

> **Estimated members at risk: 23**
>
> Based on 6 months of attendance and membership records.
>
> Estimated range: **18–29**
>
> Confidence: **Moderate**
>
> Main signals:
>
>
> - Attendance declining
>
> - Longer gaps between visits
>
> - Upcoming membership expiry

The system must clearly distinguish **prediction from fact**.

***

# 3. TARGET MARKET

Primary market:

Nepalese local gyms with:

**50–500 members**

Design for:

- Independent gyms

- Boutique gyms

- Fitness studios

- Yoga studios

- Zumba studios

- Martial arts gyms

- Personal training studios

- Small gym chains

Support multi-location architecture for future expansion.

***

# 4. USER ROLES

Implement strict role-based access control.

## Platform Roles

### Super Admin

Full platform control.

### Platform Support Admin

Customer support and operational tools.

### Platform Finance Admin

Subscription and platform financial tools.

***

## Gym Roles

### Gym Owner

Full access to their gym.

### Gym Manager

Operational access with limited financial/settings permissions.

### Gym Staff

Attendance, member records and basic operations.

### Trainer

Assigned members, attendance, PT and booking functionality.

### Member

Own attendance, membership, renewal, payments, streak and marketplace.

***

## Marketplace

### Vendor

Approved marketplace products/services.

***

# 5. MULTI-TENANT ARCHITECTURE

Every gym is an isolated tenant.

All relevant entities must be linked to a gym/tenant.

Examples:

Gym

→ Users

→ Members

→ Memberships

→ Attendance

→ Payments

→ Notifications

→ Recovery Tasks

→ Marketplace

→ Analytics

→ Imported Records

→ Prediction Reports

Never allow one gym to access another gym's data.

Tenant authorization must be enforced server-side.

Do not rely on frontend restrictions.

***

# 6. EXACTLY 4 PRIMARY MOBILE SCREENS

The core mobile experience must contain exactly four primary navigation destinations.

***

# SCREEN 1 — PULSE

## Members at Risk

This is the main retention screen.

Top:

# REVENUE AT RISK

₹36,000

Then:

### Members needing attention

Member card:

- Avatar

- Name

- Membership

- Last attendance

- Days inactive

- Attendance trend

- Membership expiry

- Monthly fee

- Estimated revenue at risk

- Risk status

- Contact button

- Recover button

Risk levels:

🟢 Active

🟡 Attention

🔴 At Risk

⚫ Lost

Automatically flag active members after:

# 10+ DAYS WITHOUT ATTENDANCE

Actions:

- Call

- Message

- WhatsApp where supported

- Send reminder

- Create follow-up

- Mark contacted

- Mark recovered

***

# SCREEN 2 — ATTENDANCE

Create a premium attendance and streak experience.

Member sees:

# 🔥 12 DAY STREAK

Display:

- Today's check-in

- Weekly visits

- Monthly visits

- Current streak

- Best streak

- Attendance calendar

- Milestones

- Rewards

- Challenges

Example:

> **12 Day Streak**
>
> 2 more visits to unlock Gold.

Support:

- QR check-in

- Staff check-in

- Optional NFC-ready architecture

- Attendance history

- Duplicate check-in prevention

Challenges:

- 10 visits/month

- 20 visits/month

- 30-day streak

- Weekend Warrior

- Early Bird

Gym owners can configure challenges and rewards.

***

# SCREEN 3 — RENEW + PAY

Create a frictionless renewal experience.

Example:

> **Membership expires in 5 days**

Plan:

Monthly Membership

Price:

₹1,500

Primary CTA:

# RENEW NOW

Support:

- Membership plans

- Renewal

- Payment history

- Digital receipts

- Expiry reminders

- Failed payments

- Grace periods

- Discounts

- Coupons

Default automation:

7 days before expiry

3 days before expiry

1 day before expiry

Expiry day

Post-expiry

Timing must be configurable.

Payment confirmation must come from a verified server-side payment webhook.

Never trust frontend payment success.

***

# SCREEN 4 — MARKETPLACE

Create an in-app marketplace.

Services:

- Personal training

- Diet plans

- Yoga

- Zumba

- Boxing

- Fitness assessments

- Recovery sessions

- Classes

Products:

- Merchandise

- Accessories

- Approved supplements

- Fitness equipment

Support:

- Product/service images

- Pricing

- Inventory

- Booking

- Orders

- Coupons

- Bundles

- Featured products

- Purchase history

Example:

> **You're on a 20-day streak.**
>
> Take your progress further with a 4-session Personal Training Pack.

Do not use deceptive or manipulative upselling.

***

# 7. GYM OWNER DASHBOARD

Create a responsive desktop/tablet dashboard.

Primary metrics:

### Revenue at Risk

₹XX,XXX

### Estimated Members at Risk

XX

### Revenue Protected

₹XX,XXX

### Active Members

XXX

### Renewal Rate

XX%

### Marketplace Revenue

₹XX,XXX

***

## Dashboard sections

### Retention

- Active members

- At-risk members

- Inactive members

- Recovered members

- Churn

- Renewal rate

- Recovery rate

### Attendance

- Today's check-ins

- Weekly attendance

- Monthly attendance

- Average visits/member

- Attendance trend

### Revenue

- MRR

- Revenue at risk

- Revenue protected

- Renewal revenue

- Marketplace revenue

- PT revenue

### Action Center

- Members requiring follow-up

- Expiring memberships

- Failed payments

- Pending orders

- Pending bookings

***

# 8. NEW FEATURE — RECORD SHEET IMPORT + CHURN ESTIMATION

Create a powerful feature called:

# MEMBER RECORD ANALYZER

Gym Owner or authorized gym staff can upload existing gym records.

The source can be:

### File

Support:

- CSV

- XLSX

- XLS

- PDF where practical

### Image

Support:

- JPG

- JPEG

- PNG

- HEIC where supported

Examples:

A gym owner can photograph or upload:

- Attendance register

- Excel member sheet

- Printed attendance sheet

- Membership list

- Renewal records

- Payment records

- Monthly attendance report

The system should process the uploaded record and convert it into structured data.

***

# 9. RECORD IMPORT WORKFLOW

Create this flow:

## STEP 1 — Upload

> Upload your gym records

Drag/drop or mobile camera upload.

Show:

**File upload**

and:

**Take photo**

***

## STEP 2 — Detect Structure

System identifies:

- Member names

- Phone numbers

- Membership IDs

- Dates

- Attendance

- Membership expiry

- Plan

- Payment

- Amount

- Visit frequency

Do not assume column names are standardized.

Recognize common variations.

Examples:

`Name`

`Member Name`

`Customer`

`Client`

should map to:

**Member Name**

Similarly:

`Phone`

`Mobile`

`Contact`

→

**Phone**

***

# 10. IMAGE/OCR PROCESSING

For images, implement OCR.

Pipeline:

**Image → OCR → Table Detection → Data Cleaning → Column Mapping → Validation → Preview → Import**

Never silently import bad OCR data.

Show a preview before committing.

Example:

|Name|Phone|Last Visit|Plan|Expiry|
|---|---|---|---|---|
|Rahul|98XXXXXXXX|Sep 10|Monthly|Oct 10|
|Sita|97XXXXXXXX|Sep 02|Monthly|Sep 30|

Highlight uncertain fields.

Example:

> ⚠️ 7 rows need review

Allow staff to correct them.

***

# 11. SMART COLUMN MAPPING

Create automatic column mapping.

Example:

Uploaded:

`Customer Name`

System:

**Member Name**

Uploaded:

`Last Seen`

System:

**Last Attendance**

Uploaded:

`Package`

System:

**Membership Plan**

Uploaded:

`Expire`

System:

**Membership Expiry**

Always allow manual correction.

***

# 12. DUPLICATE DETECTION

Before import:

Detect duplicate members using combinations such as:

- Member ID

- Phone

- Email

- Name + phone

- Existing internal ID

Show:

### 17 potential duplicates

Options:

- Merge

- Skip

- Create new

- Review

Never overwrite existing member records silently.

***

# 13. DATA QUALITY REPORT

After processing, show:

# DATA QUALITY

Example:

**200 records detected**

**184 clean**

**9 missing attendance**

**5 duplicate candidates**

**2 invalid dates**

Give staff the ability to fix issues before import.

***

# 14. CHURN ESTIMATION ENGINE

After successful processing, generate:

# MEMBER LOSS ESTIMATE

Example:

> Based on the uploaded attendance and membership history:
>
> **Estimated members at risk: 23**
>
> Estimated range:
>
> **18–29 members**
>
> Data analyzed:
>
> **6 months**
>
> Confidence:
>
> **Moderate**

Do NOT present this as certainty.

***

# 15. PREDICTION INPUTS

Use transparent, explainable signals.

Do not require complex AI.

Potential signals:

### Attendance frequency

How often the member visits.

### Attendance trend

Increasing / stable / declining.

### Days since last visit

### Visit gap

Average days between visits.

### Membership expiry

Days until expiration.

### Historical renewal

Whether the member previously renewed.

### Membership age

How long they have been active.

### Payment behavior

Only where available and appropriate.

### Recent engagement

Recent check-ins.

### Sudden attendance drop

Compare recent period against previous period.

***

# 16. SIMPLE PREDICTION MODEL

Use a transparent statistical/rules-based model initially.

For example:

Risk score can combine normalized signals such as:

- Attendance decline

- Days inactive

- Membership expiry proximity

- Historical attendance consistency

- Previous renewal behavior

Do NOT pretend this is advanced AI.

Label it:

# Estimated Churn Risk

Possible categories:

### Low Risk

Normal attendance pattern.

### Moderate Risk

Some negative signals.

### High Risk

Multiple strong negative signals.

### Critical Attention

Severe inactivity + imminent expiry or other strong indicators.

These are operational categories, not guaranteed outcomes.

***

# 17. PREDICTION EXPLANATION

Every prediction must explain WHY.

Example:

### Rahul Sharma

**Estimated Risk: High**

Reasons:

- Attendance dropped 48% in the last 30 days

- 13 days since last visit

- Membership expires in 8 days

- Previous average: 3.2 visits/week

- Current average: 0.8 visits/week

Recommended action:

**Contact member today**

Do not make unsupported claims about personal reasons for inactivity.

Never infer:

- Health conditions

- Financial situation

- Family problems

- Mental state

- Personal circumstances

Only use observable gym data.

***

# 18. CHURN FORECAST DASHBOARD

Create a dedicated analytics area.

Example:

# NEXT 30 DAYS

Estimated member loss:

**18–27**

### Current active members

200

### Members at high risk

24

### Memberships expiring

31

### Declining attendance

37

Then show:

**What is driving the estimate?**

- 24 members have significant attendance decline

- 19 members are approaching expiry

- 11 members have long attendance gaps

***

# 19. FORECAST SCENARIOS

Show scenarios without presenting any as guaranteed.

### Current pattern

Estimated:

18–27 members

### If at-risk members are contacted

Estimated potential outcome based on historical recovery data:

12–20 members potentially retained

Clearly label this as an estimate.

Do not promise results.

***

# 20. IMPORT HISTORY

Create:

# Import History

Show:

- File name

- Uploaded by

- Date

- Number of rows

- Imported

- Skipped

- Errors

- Data quality

- Prediction generated

- Status

Statuses:

Processing

Needs Review

Imported

Failed

Archived

***

# 21. IMPORT SECURITY

Uploaded files may contain sensitive customer information.

Implement:

- Secure upload

- File type validation

- File size limits

- Malware/security scanning where infrastructure permits

- Temporary processing storage

- Encryption at rest

- Access control

- Automatic expiration/deletion of raw files according to configured retention policy

- Audit logs

Do not expose uploaded records publicly.

Do not use uploaded member data for unrelated purposes.

***

# 22. OWNER DASHBOARD — IMPORT WIDGET

Add a prominent action:

# Analyze Existing Records

Description:

> Upload your attendance or membership records and get an estimated view of members who may be at risk.

CTA:

**Upload Records**

After processing:

> **23 members may need attention**

CTA:

**View Risk Report**

***

# 23. REVENUE IMPACT OF PREDICTION

Combine prediction with membership pricing.

Example:

23 estimated at-risk members.

Average monthly fee:

₹1,500

Estimated monthly revenue exposure:

**23 × ₹1,500 = ₹34,500/month**

Show:

# Estimated Revenue at Risk

₹34,500/month

If using longer-term projections, clearly label the assumption.

Never claim that all projected revenue would definitely be lost.

***

# 24. RECOVERY WORKFLOW

From the prediction report:

Member:

Rahul Sharma

Risk:

High

CTA:

# Start Recovery

Then:

1. Choose message

2. Preview

3. Send

4. Create follow-up

5. Track response

6. Member returns

7. Mark recovered

8. Calculate protected revenue

***

# 25. RECOVERY TRACKING

Each member can have:

- Risk status

- Risk history

- Last contact

- Contact method

- Contact result

- Follow-up date

- Recovery status

- Recovery date

Statuses:

Not contacted

Contacted

Follow-up

Returned

Renewed

Lost

***

# 26. REVENUE PROTECTED ENGINE

When a member returns and renews:

Calculate:

**Protected Revenue**

Use configurable assumptions.

Example:

Monthly fee:

₹1,500

Retention assumption:

6 months

Estimated protected revenue:

₹9,000

Clearly label:

**Estimated protected revenue**

Actual received payments must remain separate.

***

# 27. SUPER ADMIN CMS

Create a separate:

# /super-admin

platform control center.

It must have separate authentication and permissions.

The Super Admin controls the entire SaaS.

Anything that is configurable should be configurable from CMS without modifying source code.

***

# 28. SUPER ADMIN DASHBOARD

Show:

- Total gyms

- Active gyms

- Trial gyms

- Suspended gyms

- Total members

- Active members

- At-risk members

- Estimated churn

- Revenue at risk

- Revenue protected

- SaaS MRR

- ARR

- Marketplace GMV

- Platform commissions

- New gyms

- Gym churn

- Payment failures

- System health

Date filters:

- Today

- 7 days

- 30 days

- 90 days

- Custom

***

# 29. GYM/TENANT CMS

Super Admin can:

- Create gym

- Edit gym

- Suspend gym

- Reactivate gym

- Archive gym

- Change plan

- Change limits

- Enable/disable features

- View usage

- View billing

- Assign support admin

- View audit logs

Gym information:

- Name

- Logo

- Owner

- Phone

- Email

- Address

- City

- Province

- Timezone

- Member count

- Plan

- Status

- Created date

***

# 30. MEMBER CMS

Authorized Super Admin users can search and manage platform member records.

Search:

- Name

- Phone

- Email

- Gym

- Membership ID

Filters:

- Active

- At Risk

- Expired

- Suspended

- Lost

Privileged member access must be audited.

***

# 31. SAAS PLAN CMS

Create configurable plans:

Starter

Growth

Pro

Each plan can define:

- Price

- Billing period

- Member limit

- Staff limit

- Storage limit

- Automation access

- Marketplace access

- Analytics

- Import limits

- Prediction limits

- Notification limits

- API access

- Custom branding

Never hardcode plan limits.

***

# 32. FEATURE FLAG CMS

Allow Super Admin to control:

- Attendance

- Streaks

- Churn prediction

- File import

- Image/OCR import

- Marketplace

- Payments

- WhatsApp

- SMS

- Email

- Advanced analytics

- Multi-location

- API

- Custom branding

Scopes:

Global

Plan

Gym

Feature flags must be checked server-side.

***

# 33. AUTOMATION CMS

Super Admin controls automation defaults.

Examples:

10 days inactive

→ At Risk

→ Recovery alert

Membership expiry

→ Renewal sequence

Payment failure

→ Payment recovery

Milestone

→ Reward

Marketplace purchase

→ Booking/order workflow

Each rule has:

- Name

- Trigger

- Conditions

- Delay

- Action

- Audience

- Enabled

- Priority

- Version

***

# 34. NOTIFICATION CMS

Manage:

- Email

- SMS

- WhatsApp

- Push

- In-app

Templates:

- Welcome

- Inactivity

- Recovery

- Renewal

- Payment

- Marketplace

- Booking

- Security

- System

Support:

Draft

Review

Published

Archived

Version history.

***

# 35. MARKETPLACE CMS

Super Admin controls:

### Categories

### Vendors

### Products

### Services

### Promotions

### Coupons

### Featured listings

### Commissions

Vendor states:

Pending

Approved

Suspended

Rejected

***

# 36. COMMISSION ENGINE

Configure:

- Platform commission

- Gym commission

- Vendor commission

- Category commission

- Promotional commission

Do not hardcode percentages.

Every financial transaction must have an auditable record.

***

# 37. PAYMENT PROVIDER CMS

Create a provider abstraction.

Support Nepal-compatible payment providers through adapters.

Super Admin controls:

- Provider

- Environment

- Enabled

- Currency

- Payment methods

- Webhooks

- Health status

Encrypt credentials.

Never expose secrets after saving.

Verify webhook signatures.

Implement idempotency.

***

# 38. NOTIFICATION PROVIDER CMS

Configure:

- SMS provider

- Email provider

- WhatsApp provider

- Push provider

Show:

- Status

- Usage

- Delivery rate

- Failure rate

- Limits

***

# 39. CONTENT CMS

Manage:

### Website

- Hero

- Features

- Pricing

- Testimonials

- FAQs

- CTA

### App

- Onboarding

- Help

- Empty states

- Announcements

### Marketplace

- Categories

- Banners

- Featured products

- Promotions

### Legal

- Terms

- Privacy

- Refund

- Marketplace terms

Publishing:

Draft → Review → Published → Archived

***

# 40. SUPPORT CMS

Build:

- Tickets

- Customer support

- Internal notes

- Assignments

- Priority

- Status

- SLA tracking

Statuses:

Open

In Progress

Waiting

Resolved

Closed

***

# 41. PLATFORM ANNOUNCEMENTS

Super Admin can target:

- All gyms

- Specific plan

- Specific gym

- Owners

- Managers

- Staff

- Members

Support:

- Schedule

- Publish

- Expire

***

# 42. AUDIT LOGS

Log all privileged actions.

Store:

- Actor

- Role

- Action

- Entity

- Entity ID

- Gym

- Timestamp

- IP where appropriate

- User agent where appropriate

- Before state where appropriate

- After state where appropriate

Examples:

"Super Admin suspended Gym"

"Owner changed membership price"

"Staff imported attendance file"

"Super Admin changed automation"

"Vendor approved"

***

# 43. SECURITY CENTER

Show:

- Failed logins

- Suspicious activity

- Privilege changes

- Admin sessions

- Webhook failures

- API errors

- Security events

Allow authorized admins to:

- Revoke sessions

- Disable accounts

- Force password reset

- Require MFA

***

# 44. SYSTEM OPERATIONS

Provide safe operational actions:

- Recalculate streaks

- Recalculate risk scores

- Recalculate revenue metrics

- Retry failed webhook

- Retry notification

- Reprocess failed import

- Rebuild search index

- Retry failed background job

Never provide arbitrary SQL/database access through the CMS.

***

# 45. BACKGROUND JOB SYSTEM

Create reliable jobs for:

- Inactivity detection

- Churn analysis

- Renewal reminders

- Payment events

- Notifications

- Marketplace orders

- Analytics

- Subscription billing

- File processing

- OCR processing

- Prediction calculations

Jobs require:

- Retry

- Exponential backoff

- Idempotency

- Failure logging

- Dead-letter handling

Super Admin can inspect failed jobs.

***

# 46. DATA MODEL

Create a production-quality relational schema.

Core:

Gym

User

Role

Member

Trainer

Staff

Membership

MembershipPlan

Attendance

CheckIn

Payment

Invoice

Subscription

Notification

NotificationTemplate

RecoveryTask

Reward

Challenge

MarketplaceProduct

MarketplaceVendor

MarketplaceOrder

Booking

Coupon

AuditLog

***

## Prediction/import entities

ImportedFile

ImportJob

ImportRow

ColumnMapping

DataQualityIssue

PredictionReport

PredictionFactor

RiskAssessment

RiskHistory

RecoveryEvent

RevenueProjection

***

# 47. IMPORTANT DATA RELATIONSHIPS

Member:

→ Membership

→ Attendance

→ Payments

→ RiskAssessment

→ RiskHistory

→ RecoveryTasks

→ Notifications

→ Orders

→ Bookings

→ Rewards

ImportedFile:

→ ImportJob

→ ImportRows

→ ColumnMappings

→ DataQualityIssues

→ PredictionReport

PredictionReport:

→ RiskAssessments

→ PredictionFactors

→ RevenueProjection

***

# 48. SECURITY

Implement:

- Secure authentication

- Password hashing

- Session security

- RBAC

- Tenant isolation

- Server-side authorization

- Input validation

- Rate limiting

- XSS protection

- SQL injection protection

- Secure cookies

- CSRF protection where applicable

- HTTPS-ready deployment

- Payment tokenization

- Webhook verification

- Audit logs

- Encryption at rest

- Backup strategy

- Data retention

- Data deletion/export

Never store:

- Raw card numbers

- CVV

- Payment passwords

- Unnecessary sensitive data

Never hardcode secrets.

Use environment variables.

***

# 49. DATA PRIVACY

Treat member records as sensitive business/customer information.

Collect only what is needed.

For imported records:

- Explain what will be processed

- Show what data was detected

- Allow correction

- Allow deletion

- Define retention

- Restrict staff permissions

- Log access

Prediction must be based only on relevant gym data.

Never infer sensitive personal characteristics.

***

# 50. NEPAL-FIRST DESIGN

Use:

**NPR / ₹**

Support:

- Nepal phone numbers

- Nepal timezone

- Nepal-friendly payment provider integrations

- Local pricing

- English-first interface

- Architecture ready for Nepali localization

Do not hardcode one payment gateway.

Use a provider interface.

***

# 51. DESIGN SYSTEM

Recommended stack:

- Next.js

- TypeScript

- Tailwind CSS

- shadcn/ui

- Radix UI

- Lucide

- Motion

- Recharts

- Zod

- React Hook Form

Use reusable components.

Create:

Button

Card

MetricCard

MemberCard

RiskCard

PredictionCard

ImportCard

UploadZone

DataPreview

ColumnMapper

DataQualityCard

Chart

Progress

Badge

Modal

Drawer

Sheet

Toast

DataTable

Calendar

CommandMenu

Form

EmptyState

Skeleton

NotificationItem

PaymentStatus

***

# 52. VISUAL DESIGN

The UI must be:

# ULTRA-PREMIUM

Visual inspiration:

**Apple-level simplicity + fintech dashboard precision + premium fitness application.**

Use:

- Sophisticated typography

- Strong spacing

- Large metrics

- Subtle gradients

- Depth

- Soft shadows

- Carefully controlled glass effects

- 3D-inspired cards

- Smooth micro-interactions

- Animated charts

- Premium avatars

- Beautiful data visualization

- High-quality icons

- Responsive layouts

3D should be subtle and functional.

Do NOT make it look like a gaming website.

Avoid:

- Excessive glassmorphism

- Excessive gradients

- Clutter

- Tiny text

- Excessive animations

- Generic Bootstrap aesthetics

- Generic admin templates

***

# 53. MOBILE UX

Primary mobile navigation:

**Pulse**

**Attendance**

**Renew**

**Marketplace**

Use a premium bottom navigation.

Owner/staff administrative functions can use additional desktop/tablet navigation while maintaining the four core mobile destinations.

***

# 54. ACCESSIBILITY

Follow WCAG principles.

Support:

- Keyboard navigation

- Screen readers

- Focus states

- Semantic HTML

- Accessible forms

- Good contrast

- Reduced motion

- Proper touch targets

***

# 55. PERFORMANCE

Optimize for fast loading.

Use:

- Server rendering where appropriate

- Code splitting

- Image optimization

- Lazy loading

- Pagination

- Database indexes

- Efficient queries

- Caching

- Background processing

Do not load hundreds of members simultaneously.

***

# 56. ONBOARDING

Gym owner:

1. Create gym

2. Gym information

3. Upload logo

4. Create membership plans

5. Add/import members

6. Configure attendance

7. Configure notifications

8. Configure payments

9. Configure marketplace

10. Launch

Include:

# Import Existing Records

as a major onboarding option.

***

# 57. MEMBER ONBOARDING

Member:

1. Receive invite

2. Verify phone/email

3. Create account

4. View membership

5. Check in

6. Track streak

7. Renew

8. Browse marketplace

Keep this extremely short.

***

# 58. ANALYTICS

Gym-level:

- Attendance

- Retention

- Churn

- Renewal

- Revenue at risk

- Revenue protected

- Marketplace revenue

Prediction:

- Estimated at-risk members

- Risk distribution

- Attendance decline

- Expiring memberships

- Recovery outcomes

- Forecast range

Platform-level:

- Total gyms

- Active gyms

- Platform revenue

- Platform retention

- Total estimated risk

- Total protected revenue

Always distinguish:

**Actual**

from

**Estimated**

***

# 59. REPORTS

Create:

- Member report

- Attendance report

- Renewal report

- Churn report

- Risk report

- Recovery report

- Revenue report

- Marketplace report

- Payment report

- Import report

Allow CSV export.

***

# 60. DEMO DATA

Create realistic demo data:

- 200 members

- Multiple plans

- 6+ months attendance

- Different attendance patterns

- At-risk members

- Renewals

- Payments

- Marketplace products

- Orders

- Trainers

- Notifications

- Imported records

- Prediction reports

Use realistic Nepal-oriented names and NPR prices.

***

# 61. EMPTY STATES

Every empty state should tell the user what to do.

Example:

### No members at risk

> 🎉 Your members are showing up.
>
> We'll alert you automatically when someone reaches 10 days without a visit.

### No records imported

> Understand your member risk in minutes.
>
> Upload your attendance sheet to generate an estimated churn report.

CTA:

**Analyze Records**

***

# 62. ERROR HANDLING

Never show raw technical errors.

Use:

> Something went wrong while processing your file.

Then:

**Try Again**

For imports:

> We couldn't read 5 rows. Review the highlighted records before importing.

For payments:

> Payment couldn't be confirmed. Please try again.

***

# 63. TESTING

Write comprehensive tests.

## Authentication

- Login

- Logout

- Password reset

- Session expiration

- MFA

## Authorization

- Owner

- Manager

- Staff

- Trainer

- Member

- Vendor

- Super Admin

- Cross-tenant access prevention

## Attendance

- Check-in

- Duplicate prevention

- Streak

- 10-day inactivity

## Prediction

- File parsing

- OCR

- Column mapping

- Data validation

- Duplicate detection

- Risk calculation

- Prediction explanation

- Confidence/uncertainty

- Recalculation

## Payments

- Success

- Failure

- Webhook

- Duplicate webhook

- Retry

## Marketplace

- Product

- Purchase

- Booking

- Inventory

- Commission

## Automation

- Inactivity

- Renewal

- Payment

- Milestone

***

# 64. CORE BUSINESS CALCULATIONS

## At-Risk Member

Active membership AND:

`lastAttendanceDate <= currentDate - 10 days`

***

## Revenue at Risk

Sum applicable membership fees of at-risk active members.

***

## Attendance Decline

Compare recent attendance period against historical baseline.

Example:

Last 30 days:

8 visits

Previous 30 days:

16 visits

Decline:

50%

***

## Risk Estimate

Use transparent, explainable signals.

Never claim certainty.

***

## Recovery Rate

Recovered at-risk members ÷ contacted at-risk members.

***

## Renewal Rate

Renewed memberships ÷ memberships expiring during selected period.

***

# 65. CHURN PREDICTION QUALITY

Do not pretend the first version has perfect predictive accuracy.

Track prediction performance over time.

For each prediction cohort:

- Prediction date

- Predicted risk

- Actual renewal

- Actual churn

- Prediction outcome

Super Admin should eventually see:

- Precision

- Recall

- Calibration

- False positives

- False negatives

Only show advanced model-quality metrics to appropriate administrators.

***

# 66. MODEL VERSIONING

If prediction logic changes:

Store:

- Model/rules version

- Prediction date

- Input period

- Factors

- Result

Example:

`Risk Engine v1.3`

This makes historical reports reproducible.

***

# 67. AI ARCHITECTURE

Do NOT make AI mandatory for the core product.

Version 1 should use:

**rules + statistics + transparent scoring**

AI can optionally assist later with:

- OCR cleanup

- Column mapping

- Message drafting

- Natural-language summaries

AI must never silently make important financial or membership decisions.

***

# 68. SUPER ADMIN PREDICTION CONTROLS

Super Admin can configure:

- Risk thresholds

- Inactivity threshold

- Analysis window

- Minimum data requirement

- Prediction rules

- Risk labels

- Confidence thresholds

- Revenue projection assumptions

Example:

Inactivity threshold:

10 days

Analysis window:

180 days

Minimum attendance records:

30

These should be configurable.

***

# 69. DATA IMPORT LIMITS

Plans can have different limits.

Example:

Starter:

5 imports/month

Growth:

20 imports/month

Pro:

Unlimited or configurable

Limits must be controlled from the Super Admin CMS.

***

# 70. FILE PROCESSING ARCHITECTURE

Do not process huge files synchronously in the browser.

Flow:

Upload

↓

Secure storage

↓

Create ImportJob

↓

Background processing

↓

OCR/parser

↓

Normalization

↓

Validation

↓

Preview

↓

User approval

↓

Database import

↓

Prediction engine

↓

Prediction report

This must be resilient to failures.

***

# 71. IMPORT PREVIEW UX

Before importing:

Show:

# Ready to Import

200 records detected

184 clean

9 need review

5 duplicates

2 invalid dates

Then:

**Review Issues**

**Import 184 Clean Records**

Never force users to accept corrupted data.

***

# 72. OWNER ACTION CENTER

Create a universal action center.

Prioritize:

1. Critical-risk members

2. 10+ day inactive members

3. Expiring memberships

4. Failed payments

5. Follow-ups due

6. Marketplace orders

7. Data import issues

The system should tell the owner what needs attention rather than requiring them to discover it.

***

# 73. SEARCH

Global search should support:

- Members

- Memberships

- Payments

- Orders

- Gyms

- Trainers

- Vendors

- Import reports

Use fast search and keyboard shortcuts on desktop.

***

# 74. NOTIFICATION CENTER

Users can see:

- At-risk alerts

- Renewal alerts

- Payment alerts

- Marketplace alerts

- System alerts

Allow:

- Read/unread

- Mark all read

- Notification preferences

***

# 75. GYM SETTINGS

Gym owners can configure:

- Gym profile

- Logo

- Membership plans

- Attendance rules

- Inactivity threshold

- Notification settings

- Payment providers

- Marketplace

- Rewards

- Challenges

- Staff permissions

- Data imports

- Branding

Super Admin can override or restrict settings through feature/configuration controls.

***

# 76. STAFF PERMISSIONS

Create granular permissions.

Examples:

`members.view`

`members.edit`

`attendance.view`

`attendance.create`

`payments.view`

`payments.manage`

`reports.view`

`imports.create`

`imports.view`

`prediction.view`

`marketplace.manage`

`settings.manage`

`staff.manage`

Owner can assign permissions according to plan and role.

***

# 77. SAFE FILE HANDLING

Never execute uploaded files.

Validate MIME type and extension.

Limit file size.

Sanitize filenames.

Store uploads outside publicly accessible paths.

Generate secure temporary access URLs where required.

Delete expired raw files according to retention settings.

***

# 78. PAYMENT SECURITY

Use payment-provider hosted/tokenized flows where possible.

Never store sensitive payment credentials.

Every webhook must:

- Verify signature

- Validate event

- Check transaction

- Check tenant

- Be idempotent

- Store event ID

Prevent duplicate payment processing.

***

# 79. DEPLOYMENT

Prepare the application for production deployment.

Include:

- Environment configuration

- Database migrations

- Seed/demo data

- Production build

- Logging

- Error monitoring hooks

- Health endpoint

- Backup strategy

- Secure environment variables

Do not include fake production credentials.

***

# 80. PROJECT STRUCTURE

Use a clean architecture.

Suggested:

`app/`

`components/`

`features/`

`lib/`

`services/`

`repositories/`

`hooks/`

`types/`

`validators/`

`workers/`

`db/`

`tests/`

`config/`

Keep business logic outside UI components.

***

# 81. DESIGN COMPONENT ARCHITECTURE

Create a consistent design system.

Important components:

- PulseMetric

- RiskBadge

- MemberRiskCard

- RevenueRiskCard

- PredictionCard

- ForecastCard

- AttendanceHeatmap

- StreakCard

- RenewalCard

- PaymentCard

- MarketplaceCard

- ImportDropzone

- OCRPreview

- DataTable

- ColumnMapper

- DataQualityPanel

- PredictionFactors

- RecoveryTimeline

- RevenueProtectedCard

***

# 82. CORE USER JOURNEYS

## Journey A — Existing gym

Owner logs in.

↓

Sees:

**₹34,500 Revenue at Risk**

↓

Opens:

**Members at Risk**

↓

Contacts members.

↓

Member returns.

↓

Member renews.

↓

Dashboard updates:

**Revenue Protected ↑**

***

## Journey B — Import old records

Owner opens:

**Analyze Existing Records**

↓

Uploads Excel.

↓

System detects columns.

↓

Shows preview.

↓

Owner confirms.

↓

System analyzes attendance.

↓

Generates:

**Estimated 18–27 members at risk**

↓

Shows individual risk factors.

↓

Owner starts recovery workflow.

***

## Journey C — Photo of paper attendance

Staff opens camera.

↓

Photographs attendance sheet.

↓

OCR processes image.

↓

Table detected.

↓

Staff reviews uncertain rows.

↓

Import.

↓

Risk analysis.

↓

Action Center updates.

***

## Journey D — Member renewal

Member receives reminder.

↓

Opens GymPulse.

↓

Sees:

**Membership expires in 3 days**

↓

Taps:

**Renew Now**

↓

Completes payment.

↓

Webhook confirms payment.

↓

Membership extends.

↓

Receipt generated.

***

## Journey E — Marketplace

Member opens Marketplace.

↓

Selects PT package.

↓

Pays.

↓

Booking created.

↓

Trainer notified.

↓

Owner sees additional revenue.

***

# 83. UX PRINCIPLE

The owner should understand the business state within **5 seconds**.

First:

> **Who is at risk?**

Second:

> **How much revenue is at risk?**

Third:

> **What should I do now?**

Fourth:

> **Did my actions recover revenue?**

***

# 84. PRODUCT LANGUAGE

Use simple, premium language.

Instead of:

"Inactive Users"

Use:

**Members at Risk**

Instead of:

"Analytics"

Use:

**Know Your Gym**

Instead of:

"Revenue Projection"

Use:

**Estimated Revenue at Risk**

Instead of:

"User Retention"

Use:

**Member Retention**

Instead of:

"Import Data"

Use:

**Analyze Existing Records**

Instead of:

"Products"

Use:

**Grow Member Revenue**

***

# 85. PRICING

Example SaaS plans:

### STARTER

Up to 100 members

₹1,999/month

### GROWTH

Up to 300 members

₹3,499/month

### PRO

Up to 500 members

₹5,999/month

Keep pricing configurable through CMS.

For custom deployments:

Approximate setup/build:

**₹30,000–₹50,000**

Maintenance:

**₹2,000–₹5,000/month**

These values must be editable by Super Admin.

***

# 86. ROI ENGINE

Example:

20 members retained.

Monthly membership:

₹1,500

Annual revenue:

`20 × ₹1,500 × 12`

=

**₹360,000**

Estimated one-time build value:

Approximately:

**10% = ₹36,000**

However, all ROI numbers must be labeled as examples/estimates and never guaranteed.

***

# 87. SUPER ADMIN CMS NAVIGATION

Create a premium Super Admin sidebar:

**Overview**

**Gyms**

**Members**

**Subscriptions**

**Plans**

**Feature Flags**

**Automations**

**Notifications**

**Marketplace**

**Vendors**

**Payments**

**Content**

**Announcements**

**Support**

**Imports**

**Prediction Engine**

**Analytics**

**Reports**

**Security**

**Audit Logs**

**System**

**Settings**

***

# 88. SUPER ADMIN DASHBOARD DESIGN

The Super Admin dashboard should feel like a modern SaaS control center.

Top:

**GymPulse Platform**

Then:

Revenue

Growth

Retention

Risk

Marketplace

System Health

Use clean charts.

Avoid overwhelming the administrator.

Every metric should have:

- Current value

- Time period

- Trend

- Definition

- Optional drill-down

***

# 89. NO FAKE FUNCTIONALITY

Do not create UI that pretends to work.

If an integration is not configured:

Show:

**Not configured**

If payment provider isn't connected:

**Connect Payment Provider**

If OCR service isn't configured:

**OCR service unavailable**

If prediction data is insufficient:

> **Not enough historical data**
>
> Upload at least X valid attendance records to generate an estimate.

Never fabricate predictions.

***

# 90. INSUFFICIENT DATA HANDLING

Prediction requires minimum quality data.

If only 10 members exist:

Do not produce a confident churn forecast.

Instead:

> **Not enough data for a reliable estimate.**
>
> We need more attendance history.

This is critical.

***

# 91. EXPLAINABILITY

Every prediction should have a:

**Why?**

button.

Show:

- Attendance trend

- Last visit

- Visit frequency

- Membership expiry

- Historical renewal

- Data period

Never hide the basis of the estimate.

***

# 92. MODEL SAFETY

Prediction must not use sensitive personal characteristics.

Do not predict churn using:

- Religion

- Race/ethnicity

- Health information

- Mental health

- Political views

- Sexual orientation

- Other sensitive attributes

Use only relevant gym activity/business data.

***

# 93. OBSERVABILITY

Track:

- API performance

- Database performance

- Queue latency

- Import processing time

- OCR failures

- Prediction failures

- Payment failures

- Notification failures

Super Admin should have a system-health overview.

***

# 94. FINAL QUALITY BAR

The finished product must be:

**Ultra-premium**

**Mobile-first**

**Responsive**

**Fast**

**Secure**

**Multi-tenant**

**Nepal-friendly**

**Accessible**

**Explainable**

**Production-oriented**

**Scalable**

**Maintainable**

**Commercially usable**

Do not make the product unnecessarily complicated.

The intelligence should come from:

**good data + automation + transparent analytics + useful workflows**

not from unnecessary AI.

***

# 95. THE DEFINING PRODUCT EXPERIENCE

The complete GymPulse experience should feel like this:

### MEMBER STOPS ATTENDING

↓

GymPulse detects inactivity.

↓

### MEMBER BECOMES AT RISK

↓

Owner sees:

**₹1,500/month revenue at risk**

↓

Owner contacts member.

↓

Member returns.

↓

Member renews.

↓

GymPulse records:

**Recovered**

↓

Revenue Protected increases.

↓

Member reaches milestone.

↓

Marketplace recommends relevant gym service.

↓

Member purchases PT/diet/class.

↓

Gym earns additional revenue.

***

# 96. THE RECORD-SHEET EXPERIENCE

A gym owner should also be able to say:

> "I already have all my data in Excel."

GymPulse responds:

**Upload it.**

Or:

> "My attendance records are on paper."

GymPulse responds:

**Take a photo.**

Then:

**Upload → Read → Clean → Review → Import → Analyze → Estimate → Act**

This should be one of the product's signature experiences.

***

# 97. FINAL BUILD INSTRUCTION

Build the complete application from the ground up.

Do not stop at static screens.

Implement:

- Frontend

- Backend

- Database

- Authentication

- Authorization

- Multi-tenancy

- Attendance

- Streaks

- Memberships

- Renewals

- Payments abstraction

- Notifications

- Marketplace

- File import

- Spreadsheet parsing

- Image/OCR processing architecture

- Data validation

- Duplicate detection

- Churn estimation

- Explainable risk analysis

- Revenue-at-risk calculations

- Recovery workflows

- Analytics

- Reports

- SaaS billing

- Super Admin CMS

- Feature flags

- Content CMS

- Automation CMS

- Payment CMS

- Notification CMS

- Vendor CMS

- Support CMS

- Audit logs

- Security center

- Background jobs

- Testing

- Error handling

- Production configuration

Prioritize the core retention loop over unnecessary features.

The final product should make a small gym owner think:

> **"This tells me exactly which members I might lose, why they're at risk, what I should do today, and whether my actions are actually protecting revenue."**

Build for **real-world use**, not just visual demonstration.

 ultrathink it and your /goal is to do it