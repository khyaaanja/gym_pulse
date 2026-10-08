# GymPulse Feature Ticket List

## Overview
This document lists all features, enhancements, and bug fixes for the GymPulse application, organized by priority and category. Each ticket includes a description, acceptance criteria, and estimated effort.

## Ticket Categories

### Category 1: Core Attendance & Check-In

#### Ticket #1: QR Code Check-In Enhancement
- **Description:** Enhance QR code check-in with faster scanning and better validation feedback
- **Acceptance Criteria:**
  - QR code scans within 2 seconds on average
  - Immediate membership validation confirmation
  - Visual feedback for successful/failed scans
  - Rotating kiosk QR code with 5-minute expiration
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #2: Manual Check-In Lookup
- **Description:** Implement manual member lookup and check-in for front desk staff
- **Acceptance Criteria:**
  - Search by member name or phone number
  - Filter by gym branch
  - One-check-in-per-day prevention
  - Confirmation modal with streak update
- **Effort:** 3 story points
- **Priority:** High

#### Ticket #3: Duplicate Check-In Prevention
- **Description:** Implement system to prevent duplicate daily check-ins
- **Acceptance Criteria:**
  - Blocks second check-in same day per member per gym
  - Shows "Already checked in today" message
  - Exception for staff-initiated overrides
- **Effort:** 2 story points
- **Priority:** Medium

### Category 2: Membership & Renewals

#### Ticket #4: Automated Renewal Reminders
- **Description:** Implement SMS/Email/Push renewal reminders at 7, 3, 1 day before expiry and on expiry
- **Acceptance Criteria:**
  - Reminders sent automatically on schedule
  - Multiple channel support (SMS, Email, Push, WhatsApp)
  - Member can opt-out per channel
  - Reminder templates customizable
- **Effort:** 8 story points
- **Priority:** High

#### Ticket #5: Payment Integration - eSewa
- **Description:** Integrate eSewa payment gateway for membership renewals and marketplace purchases
- **Acceptance Criteria:**
  - Payment initiation from frontend
  - Webhook handler for payment confirmation
  - Idempotent payment processing
  - Receipt generation and display
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #6: Payment Integration - Khalti
- **Description:** Integrate Khalti payment gateway for membership renewals and marketplace purchases
- **Acceptance Criteria:**
  - Payment initiation from frontend
  - Webhook handler for payment confirmation
  - Idempotent payment processing
  - Receipt generation and display
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #7: Grace Period Management
- **Description:** Implement grace period after membership expiry before full restrictions
- **Acceptance Criteria:**
  - Configurable grace period (default 3 days)
  - Limited functionality during grace period
  - Automatic expiry cleanup after grace period
  - Owner can override grace period
- **Effort:** 3 story points
- **Priority:** Medium

### Category 3: Gamification & Engagement

#### Ticket #8: Streak Calculation & Display
- **Description:** Enhance streak calculation with rest day allowance and better visualization
- **Acceptance Criteria:**
  - Consecutive visits with max 2-day gap (1 rest day)
  - Current streak ending at last visit if gap exceeded
  - Best streak ever recorded display
  - Progress bar to next milestone
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #9: Milestone Badges System
- **Description:** Implement milestone badge system with tiered achievements
- **Acceptance Criteria:**
  - Bronze: 5-day streak → Badge
  - Silver: 10-day streak → Badge
  - Gold: 14-day streak → Free PT session
  - Platinum: 30-day streak → 10% off renewal
  - Club 50: 50 total visits → Badge
  - Club 100: 100 total visits → 10% off renewal
  - Badge display on profile and dashboard
- **Effort:** 8 story points
- **Priority:** High

#### Ticket #10: Monthly Challenges
- **Description:** Implement monthly challenge system with reset and rewards
- **Acceptance Criteria:**
  - Challenges reset each month
  - Challenge types: 10/20 visits, Weekend Warrior (4 Saturdays), Early Bird (8 before 7 AM), 30-day streak
  - Progress tracking and completion status
  - Badge/reward unlock upon completion
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #11: Rewards System
- **Description:** Implement rewards redemption system
- **Acceptance Criteria:**
  - Badges displayed in rewards section
  - Discount percentages show on redemption
  - Free session/voucher details
  - Earn date and history tracking
  - Idempotent: can't earn same reward twice
- **Effort:** 5 story points
- **Priority:** Medium

### Category 4: Analytics & Predictions

#### Ticket #12: AI Churn Risk Scoring
- **Description:** Implement at-risk member detection and scoring
- **Acceptance Criteria:**
  - Active member + 10+ days without visit = AT_RISK
  - Confidence levels: HIGH / MEDIUM / LOW
  - Factors: Trend, last visit date, membership expiry
  - Confidence band with estimated % ± range
- **Effort:** 8 story points
- **Priority:** High

#### Ticket #13: Prediction Backtesting
- **Description:** Implement backtest validation for churn prediction accuracy
- **Acceptance Criteria:**
  - Historical data comparison
  - Accuracy percentage display
  - Rule explanation transparency
  - Confidence level adjustment based on history
- **Effort:** 5 story points
- **Priority:** Medium

### Category 5: Marketplace & Services

#### Ticket #14: Product Catalog with Search
- **Description:** Implement marketplace product catalog with filtering and search
- **Acceptance Criteria:**
  - Filter by category (PT, yoga, classes, diet plans)
  - Search functionality by name/service
  - Product card with image, title, price, stock status
  - "Suggest based on streak" badge
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #15: Bundle/Package Deals
- **Description:** Implement bundle creation and purchasing
- **Acceptance Criteria:**
  - Members can tick two or more listings to create bundle
  - Price set below separate total
  - Stock taken from each item (bundle available while all items in stock)
  - Cancelled orders return stock to individual items
  - Services inside paid bundle create bookings
  - Members see what's included and how much they save
- **Effort:** 8 story points
- **Priority:** High

#### Ticket #16: Vendor Commission Management
- **Description:** Implement vendor commission tracking and payout
- **Acceptance Criteria:**
  - Commission percentage per vendor/product
  - Order fulfillment tracking
  - Commission earnings dashboard
  - Payout request functionality
- **Effort:** 5 story points
- **Priority:** Medium

### Category 6: Staff & Trainer Functions

#### Ticket #17: Recovery Task Management
- **Description:** Implement member recovery task workflow
- **Acceptance Criteria:**
  - Pulse screen shows at-risk members with reason (e.g., "10 days inactive")
  - Assign recovery task to trainer
  - Contact method tracking (Call, WhatsApp, SMS)
  - Outcome logging (Returned, Renewed, Lost)
  - Revenue protection calculation
  - Recovery automation on member return
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #18: Trainer Booking Management
- **Description:** Implement PT session and class booking management for trainers
- **Acceptance Criteria:**
  - View assigned member bookings
  - Update session status (Pending → Confirmed → Completed)
  - Track sessions used vs. total
  - Reschedule sessions if needed
  - Post-session completion marking
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #19: Staff Management
- **Description:** Implement staff addition and role assignment
- **Acceptance Criteria:**
  - Owner/Manager can add new users (email + phone)
  - Create staff member with role (OWNER, MANAGER, TRAINER, FRONT DESK)
  - Set title and specialties
  - Role-based permissions enforcement
  - Staff switcher for multi-gym users
- **Effort:** 3 story points
- **Priority:** Medium

### Category 7: Admin Console & Super Admin

#### Ticket #20: Super Admin Portal
- **Description:** Implement super admin console
- **Acceptance Criteria:**
  - View all gyms and their status
  - Manage platform-level settings
  - Configure payment providers globally
  - Review support tickets
  - Manage feature flags per plan/gym
  - Financial reports (MRR, platform income, marketplace sales, vendor payables)
  - 6-month trend table
  - CSV exports for all reports
  - Access audit logs
  - Create announcements for gym owners
- **Effort:** 8 story points
- **Priority:** High

#### Ticket #21: Feature Flag Management
- **Description:** Implement per-plan/gym feature flags
- **Acceptance Criteria:**
  - Enable/disable features per gym
  - Feature flags affect marketplace, challenges, etc.
  - Owner can enable marketplace for their gym
  - Super admin can configure globally
- **Effort:** 3 story points
- **Priority:** Medium

### Category 8: Notifications & Communication

#### Ticket #22: Multi-Channel Notifications
- **Description:** Implement notification system with multiple channels
- **Acceptance Criteria:**
  - In-app notifications with bell icon
  - Push notifications (phone/desktop)
  - SMS with Nepali number support
  - Email notifications
  - WhatsApp notifications
  - Customizable templates per notification type
  - Bell shows unread count, refreshes every 30 seconds, instantly on push arrival
  - New alerts pop up as toast
  - Opening a notification marks it read everywhere
  - Push stops on device sign-out (shared device protection)
- **Effort:** 8 story points
- **Priority:** High

#### Ticket #23: Announcement System
- **Description:** Implement gym announcements feature
- **Acceptance Criteria:**
  - Headline and message input
  - Audience selection (members, staff, everyone)
  - Optional end date
  - Save as draft or publish now
  - Members see latest five on home screen
  - Owner/manager can create from settings
- **Effort:** 3 story points
- **Priority:** Medium

### Category 9: Multi-Branch & Gym Management

#### Ticket #24: Branch Management
- **Description:** Implement multi-branch support for gyms
- **Acceptance Criteria:**
  - Add, rename, close, or reopen branches
  - Choose main branch
  - Multi-location feature support (more than one open branch)
  - Each branch has its own kiosk QR link
  - Staff/get members see gym switcher
  - Visits default to main branch
  - Attendance page shows branch column
  - "Visits by branch" breakdown for last 30 days
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #25: Multi-Gym Support
- **Description:** Implement support for users belonging to multiple gyms
- **Effort:** 3 story points
- **Priority:** Medium

### Category 10: Data Import & Export

#### Ticket #26: CSV/Excel Member Import
- **Description:** Implement member data import from CSV/Excel
- **Acceptance Criteria:**
  - File format: CSV or Excel
  - Columns: Name, Phone, Plan, Last Seen, Expire, Fee
  - Phone: 10 digits (Nepal format: 98XXXXXXXXX)
  - No special characters in names
  - Row-by-row review before commit
  - Duplicate detection
  - Mapping validation
  - Commit after review
- **Effort:** 5 story points
- **Priority:** High

#### Ticket #27: PDF Import with OCR
- **Description:** Implement PDF import for paper registers
- **Acceptance Criteria:**
  - OCR support with Tesseract
  - Ruled tables read directly
  - Plain text columns rebuilt from text positions
  - Scanned PDFs: upload photo instead
  - Row-by-row review before commit
  - Duplicate detection
- **Effort:** 5 story points
- **Priority:** Medium

### Category 11: User Experience & UI

#### Ticket #28: Responsive Design Optimization
- **Description:** Optimize UI for all device sizes
- **Acceptance Criteria:**
  - Mobile-first design (320px-768px)
  - Tablet optimization (768px-1024px)
  - Desktop full feature access (1024px+)
  - Large desktop (1440px+) expanded views
  - Touch-friendly interactions on mobile
  - Keyboard shortcuts on desktop

#### Ticket #29: Dark/Light Theme Support
- **Description:** Implement color theme support
- **Acceptance Criteria:**
  - System preference respect
  - Manual toggle available
  - Consistent theming across all components
  - Accessibility contrast requirements met

#### Ticket #30: Internationalization Preparation
- **Description:** Prepare UI for multi-language support
- **Acceptance Criteria:**
  - English (primary) and Nepali support
  - Date formatting adaptation
  - Number and currency formatting
  - Right-to-left consideration for future

### Category 12: Security & Compliance

#### Ticket #31: Enhanced Audit Logging
- **Description:** Expand audit trail capabilities
- **Acceptance Criteria:**
  - Log all: logins, data changes, payments, notifications
  - Fields: user ID, action type, timestamp, IP address, details
  - Permanent storage for compliance
  - Super admin visibility with role-based filtering
  - Export capability for compliance reviews

#### Ticket #32: Rate Limiting & API Security
- **Description:** Implement rate limiting and API security measures
- **Acceptance Criteria:**
  - Login attempt rate limiting
  - API endpoint rate limiting
  - Request validation and sanitization (Zod)
  - CORS configuration
  - HTTPS enforcement
  - Super admin endpoint protection

## Priority Legend
- **High:** Critical for MVP launch or core functionality
- **Medium:** Important for enhanced experience, can be post-MVP
- **Low:** Nice-to-have, future enhancements

## Release Planning
- **Phase 1 (MVP):** Tickets marked High priority for core attendance, membership, basic gamification
- **Phase 2 (V2):** Medium priority tickets for marketplace, advanced analytics, multi-branch
- **Phase 3 (V3):** Low priority tickets for advanced features, internationalization, premium analytics