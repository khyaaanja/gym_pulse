# GymPulse Technical Architecture Document

## 1. System Architecture Overview

### 1.1 Technology Stack
- **Framework:** Next.js 16.3.6 (App Router)
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL with Prisma ORM
- **Frontend:** React 19.2.8, Tailwind CSS
- **Styling:** Tailwind CSS, class-variance-authority, clsx
- **Animations:** Motion (Framer Motion)
- **QR Code:** qrcode library
- **PDF Processing:** pdf-parse, pdfjs-dist, Tesseract OCR
- **Payments:** eSewa, Khaldi (via webhooks)
- **SMS:** Custom SMS provider with Nepali support
- **Push Notifications:** VAPID key pair, web-push library
- **Date Handling:** date-fns, date-fns-tz, nepali-date-converter
- **Testing:** Vitest, Playwright

### 1.2 Architecture Pattern
- **App Router** with Next.js 16
- **Server Components** for data fetching
- **Client Components** for interactive UI
- **API Routes** for backend logic
- **Prisma** for database abstraction
- **Middleware** for auth, routing, and security

## 2. Data Flow Architecture

### 2.1 Check-In Flow
```
Member scans QR → Frontend captures code → API validates membership → 
Prisma creates attendance record → Streak recalculated → Engagement evaluated → 
Notification sent (if applicable) → Audit log created
```

### 2.2 Membership Renewal Flow
```
Member views expiry → System sends reminder (SMS/Email/Push) → 
Member clicks "Renew now" → Payment gateway (eSewa/Khalti) → 
Webhook confirms payment → Prisma updates membership → 
Member app refreshes → Check-in reactivated
```

### 2.3 At-Risk Detection Flow
```
Cron job (nightly) → Query members with 10+ days inactive → 
Calculate at-risk score → Create recovery tasks → 
Trainers notified → Member contacted → Outcome logged → 
Automation removed on return
```

### 2.4 Marketplace Flow
```
Member browses catalog → Selects service → Purchases via payment gateway →
System creates booking → Trainer notified → Trainer confirms → 
Member sees booking → Post-session: Trainer marks completed
```

## 3. Database Schema Overview

### 3.1 Key Prisma Models
- **User:** Authentication, role, permissions
- **Gym:** Gym entity with branch support
- **Member:** Member profile, membership status, streaks
- **Attendance:** Check-in records, timestamps, branch association
- **Membership:** Plan details, expiry dates, payment status
- **Booking:** PT sessions, class bookings
- **Transaction:** Payment records, invoices
- **Notification:** Sent notifications, channels, status
- **AuditLog:** All system actions for compliance

### 3.2 Relationships
- User → Member (1:1, optional)
- Gym → Member (1:N) - members belong to a gym
- Member → Attendance (N:M) - multiple check-ins
- Member → Membership (1:1) - active membership
- Member → Bookings (N:M) - scheduled sessions
- Trainer → Bookings (1:N) - assigned bookings

## 4. API Architecture

### 4.1 REST API Endpoints

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Current user info

#### Attendance
- `POST /api/checkin` - Record check-in
- `GET /api/checkin/history` - Check-in history
- `GET /api/checkin/today` - Today's check-ins

#### Membership
- `GET /api/membership/status` - Current membership status
- `PUT /api/membership/renew` - Renew membership
- `GET /api/membership/plans` - Available plans

#### Gamification
- `GET /api/gamification/streak` - Current streak
- `GET /api/gamification/milestones` - Achieved milestones
- `GET /api/gamification/challenges` - Active challenges

#### Marketplace
- `GET /api/marketplace/catalog` - Product catalog
- `POST /api/marketplace/purchase` - Purchase product
- `GET /api/marketplace/bookings` - User bookings

#### Notifications
- `GET /api/notifications` - User notifications
- `PUT /api/notifications/:id/read` - Mark as read

### 4.2 Webhook Endpoints
- `POST /api/webhooks/esewa` - eSewa payment confirmation
- `POST /api/webhooks/khalti` - Khalti payment confirmation
- `POST /api/webhooks/sms` - SMS delivery status

## 5. Integration Architecture

### 5.1 Payment Integrations
- **eSewa:** Callback URL for payment verification
- **Khalti:** Webhook for payment status
- Both support callback validation and idempotent operations

### 5.2 SMS Integration
- Nepali number format support (+977)
- Template-based messaging
- Delivery status tracking
- Sandbox mode for testing

### 5.3 Push Notification Integration
- VAPID key pair generation
- Device registration endpoint
- Channel-specific preferences
- Automatic deactivation on sign-out

### 5.4 OCR Integration
- Tesseract.js for PDF/document text extraction
- Ruled table PDF parsing
- Image-based OCR for paper registers
- Row-by-row review before commit

## 6. Security Architecture

### 6.1 Authentication & Authorization
- Role-Based Access Control (RBAC)
- Session management with secure cookies
- Password hashing with Argon2 (@node-rs/argon2)
- VAPID key pair for push notifications (public key in .env, private key secret)

### 6.2 Data Protection
- Audit trail for all data changes
- Input validation using Zod
- SQL injection prevention via Prisma
- XSS protection via Next.js sanitization
- CSP headers configuration

### 6.3 API Security
- Rate limiting on sensitive endpoints
- Request validation and sanitization
- CORS configuration
- HTTPS enforcement
- Super admin endpoint protection

### 6.4 Compliance
- Audit log retention
- Data export capabilities (CSV)
- Consent management for notifications
- Payment PCI-DSS compliance (gateway handled)

## 7. Deployment Architecture

### 7.1 Environment Configuration
- `.env` file with required variables
- VAPID keys for push notifications
- Database connection string
- Payment provider keys
- SMS provider credentials

### 7.2 Environment Variables
```
DATABASE_URL="postgresql://..."
NEXTAUTH_URL=http://localhost:3000
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@yourgym.com
ESEWA_MERCHANT_ID=...
KHALTI_PUBLIC_KEY=...
KHALTI_PRIVATE_KEY=...
SMS_PROVIDER_URL=...
```

### 7.3 Production Considerations
- HTTPS required for push notifications
- Super admin endpoint behind authentication
- Regular database backups
- Monitoring and alerting
- Log aggregation