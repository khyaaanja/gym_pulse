# GymPulse Product Requirements Document (PRD)

## 1. Product Overview

**Product Name:** GymPulse  
**Version:** v0.1.0  
**Framework:** Next.js 16.3.6  
**Database:** PostgreSQL (Prisma ORM)  
**Target Audience:** Gym owners, managers, trainers, members, vendors  
**Problem Statement:** Gyms lack an integrated system for member attendance tracking, engagement gamification, membership management, and recovery workflows.

## 2. Objectives

### 2.1 Primary Goals
- Digital check-in system using QR codes
- Member engagement through gamification (streaks, milestones, challenges)
- Membership lifecycle management (plans, renewals, payments)
- Member recovery workflow for at-risk members
- Marketplace for trainer services and products
- Analytics and prediction insights

### 2.2 Success Metrics
- Member check-in rate improvement
- Reduction in member churn
- Increased engagement through streak/milestone tracking
- Streamlined payment and renewal processes
- Vendor/marketplace transaction volume

## 3. User Roles & Permissions

| Role | Email Pattern | Access Level |
|------|---------------|--------------|
| Gym Owner | `owner@*.demo` | Full dashboard, all settings |
| Manager | `manager@*.demo` | Staff management, reports |
| Front Desk Staff | `staff@*.demo` | Check-in, member lookup |
| Trainer | `trainer@*.demo` | Bookings, member profiles |
| Member | `member@*.demo` | Member app, check-in pass |
| Vendor | `vendor@*.demo` | Vendor dashboard |
| Super Admin | `super@gympulse.local` | Platform-level settings |

## 4. Key Features

### 4.1 Attendance Management
- QR-based check-in (rotating kiosk QR or member pass)
- Manual check-in for staff
- NFC/RFID device integration
- Location tracking (multiple gyms supported)
- Duplicate check-in prevention (1 per day/member/gym)

### 4.2 Membership & Renewals
- Multiple plan offerings with configurable durations
- Auto-expiry detection with grace period
- Payment integration: eSewa, Khalti, cash/bank
- Invoice generation
- Renewal reminders (7, 3, 1 day before expiry, on expiry)
- Payment failure recovery workflows

### 4.3 Gamification Features
- **Daily Streaks**: Consecutive visits with rest day allowance
- **Milestones**: Badge achievements at streak/visit thresholds
- **Monthly Challenges**: Reset each month with rewards
- **Rewards**: Badges, discounts, free sessions

### 4.4 Analytics & Predictions
- AI-powered churn risk scoring
- Prediction confidence levels
- Transparent rule explanation
- Backtest validation

### 4.5 Marketplace
- Product/service catalog per gym
- Trainer-linked service bookings
- Vendor commission management
- Bundle/package deals

### 4.6 Notifications
- Multi-channel: In-app, Push, SMS, Email, WhatsApp
- Customizable templates
- Automation triggers: inactivity, expiry, payments, milestones

### 4.7 Admin Console (Super Admin Portal)
- View all gyms and their status
- Manage platform-level settings
- Configure payment providers globally
- Review support tickets
- Manage feature flags per plan/gym
- Financial reports and CSV exports
- Access audit logs

## 5. Workflows

### 5.1 New Member Signup & First Check-In
1. Front desk: Member completes signup at gym
2. Staff: Scans new member's pass or manually checks them in
3. System: Generates attendance record, sets streak to 1
4. Member app: Shows 1-day streak with progress to Bronze (5 days)
5. Engagement: Tracks toward "10 visits this month" challenge

### 5.2 Member at Risk Recovery
1. Pulse Dashboard: Shows member with reason (e.g., "10 days inactive")
2. Owner/Manager: Assigns recovery task to trainer
3. Trainer: Contacts via WhatsApp (logged in system)
4. Member: Returns and checks in
5. System: Automation removes from at-risk, sends "Welcome back" notification
6. Report: Shows recovery metrics

### 5.3 Membership Renewal
1. Member app: Shows "Expires in 7 days" badge
2. System: Sends SMS/email renewal reminder
3. Member: Clicks "Renew now" → Select plan → Pay via eSewa
4. eSewa: Confirms payment, returns to app
5. System: Updates membership end date, clears expiry warning
6. Member: Can check in again (re-activated)

### 5.4 Purchase PT Package & Book Sessions
1. Member: Views marketplace → finds "4 PT sessions" at ₹6,000
2. System: Suggests based on 14-day streak achievement
3. Member: Purchases via Khalti
4. System: Creates booking (pending), notifies trainer
5. Trainer: Confirms booking, sets dates
6. Member: Logs in → Bookings tab → Sees scheduled sessions
7. Post-session: Trainer marks sessions as completed

## 6. Technical Requirements

### 6.1 Frontend
- Next.js 16.3.6 with App Router
- React 19.2.8
- Tailwind CSS for styling
- Responsive design for mobile and desktop
- QR code scanning integration
- Push notification support

### 6.2 Backend
- Node.js runtime
- PostgreSQL database
- Prisma ORM for database operations
- API routes for check-in, membership, payments
- Webhook handlers for payment providers (eSewa, Khalti)
- SMS/Email notification service

### 6.3 Integration Points
- eSewa payment gateway
- Khalti payment gateway
- SMS provider (with Nepali number support)
- WhatsApp Business API
- VAPID key pair for push notifications
- Tesseract OCR for PDF/ document import
- QR code generation and scanning

### 6.4 Security
- Role-based access control (RBAC)
- VAPID key management for push notifications
- Audit trail for all actions
- Session management
- Input validation and sanitization
- Rate limiting on API endpoints

## 7. Non-Functional Requirements

### 7.1 Performance
- Page load time < 2 seconds
- Check-in response time < 1 second
- Real-time streak updates

### 7.2 Scalability
- Support multiple gym branches
- Concurrent user support
- Data import/export for large member bases

### 7.3 Reliability
- 99.9% uptime
- Automated backup of member data
- Graceful degradation for payment failures

### 7.4 Usability
- Intuitive UI for all user roles
- Multilingual support (Nepali date converter integrated)
- Accessible design

## 8. Future Enhancements
- NFC/RFID check-in devices
- Advanced AI prediction models
- Integration with wearable devices
- Mobile native app
- Multi-language support beyond Nepali/English
- Advanced analytics dashboard