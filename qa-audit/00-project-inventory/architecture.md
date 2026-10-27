# GymPulse Application Architecture

## Technology Stack

- **Framework**: Next.js 16.4.0 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS v4
- **Database**: PostgreSQL via Prisma ORM
- **Authentication**: Custom JWT-session based (cookies: `gp_session` for users, `gp_admin` for platform admins)
- **MFA**: TOTP-based (using `@node-rs/argon2` and `otplib`)
- **Testing**: Vitest, Playwright
- **Other**: React 19, Prisma Client, Lucide React, Three.js, Motion (Framer Motion)

## Directory Structure

```
src/app/              # Next.js App Router pages
  (auth)/             # Authentication routes (login, signup, forgot-password, reset-password)
  app/                # Main application routes
  g/[slug]/           # Gym detail pages
  super-admin/        # Platform admin console
  api/                # API routes
src/components/       # React components
  auth/               # Auth forms and shells
  ui/                 # UI primitives (button, etc.)
  brand/              # Logo and marketing
  motion/             # 3D and motion components
src/lib/              # Utility libraries
  auth/               # Login, session, MFA, password
  rbac/               # Role-based access control
  prisma/             # Prisma client interaction
  flags.ts            # Feature flags
  limits.ts           # Rate limits
  page-auth.ts        # Page-level authorization guards
src/generated/prisma/ # Generated Prisma client
prisma/               # Database schema and migrations
```

## Key Concepts

### Dual Authentication System

The application has **two separate authentication systems**:

1. **User Authentication** (gym users, members, staff, trainers, vendors)
   - Cookie: `gp_session`
   - Managed via `src/lib/auth/session.ts`
   - Uses `prisma.session` table
   - Sessions expire after 30 days (absolute) or 7 days (idle)
   - MFA optional but can be required per gym configuration
   - Rate-limited login (30 per IP, 5 per account+IP, 50 per account)

2. **Platform Admin Authentication** (super admin, support admin, finance admin)
   - Cookie: `gp_admin`
   - Managed via `src/lib/auth/session.ts`
   - Uses `prisma.adminSession` table
   - Sessions expire after 12 hours (absolute) or 30 minutes (idle)
   - MFA enforced unless `ALLOW_ADMIN_WITHOUT_MFA=true`
   - Rate-limited login (15 per IP, 5 per account+IP, 20 per account)

### Role System

**Staff Roles** (gym-level):
- `OWNER` - Full all permissions
- `MANAGER` - Broad operational permissions
- `STAFF` - Basic member/attendance operations
- `TRAINER` - Member viewing, attendance, bookings, diets

**Platform Roles** (super-admin level):
- `SUPER_ADMIN` - Full system access
- `SUPPORT_ADMIN` - Support and gym viewing
- `FINANCE_ADMIN` - Billing and financial operations

### Database Models (Key)

- `PlatformAdmin` - Platform-level administrators with MFA support
- `AdminSession` - Admin session management
- `User` - Generic user model (members, staff, trainers, vendors)
- `Session` - User session tracking
- `StaffMember` - Gym staff with role-based permissions
- `Member` - Gym members with attendance, risk assessment
- `Gym` - Gym/club entities with plans and subscriptions

## API Routes (Key Endpoints)

### User Auth
- `POST /api/auth/login` - User login with email/phone and password
- `POST /api/auth/mfa/verify` - MFA code verification
- `POST /api/auth/signup` - Create new gym (onboarding)
- `POST /api/auth/password/forgot` - Password reset request
- `POST /api/auth/password/reset` - Reset password with token

### Admin Auth
- `POST /api/admin/auth/login` - Platform admin login
- `POST /api/admin/auth/mfa/verify` - Admin MFA verification
- `POST /api/admin/auth/password` - Admin password change/ reset

### App API Routes
- Various routes under `/api/` for: members, attendance, payments, marketplace, imports, predictions, reports, notifications, settings, etc.

## Known Test Accounts (from seed data)

| Email | Role | Notes |
|-------|------|-------|
| owner@pulsefitness.demo | OWNER | Demo gym owner |
| manager@pulsefitness.demo | MANAGER | Gym manager |
| staff@pulsefitness.demo | STAFF | Front desk |
| trainer@pulsefitness.demo | TRAINER | Head trainer |
| trainer2@pulsefitness.demo | TRAINER | Yoga instructor |
| member@pulsefitness.demo | MEMBER | Test member |
| super@gympulse.local | SUPER_ADMIN | Platform super admin |
| support@gympulse.local | SUPPORT_ADMIN | Platform support |
| finance@gympulse.local | FINANCE_ADMIN | Platform finance |
| vendor@himalayan-nutrition.demo | VENDOR | Marketplace vendor |
| owner@yoganest.demo | OWNER | Small gym owner |
| owner@irontemple.demo | OWNER | Suspended gym owner |

## Routes Matrix

| Path | Description | Auth Required |
|------|-------------|---------------|
| `/` | Landing page (public) | No |
| `/login` | User login page | No (guest) |
| `/super-admin/login` | Admin login page | No (guest) |
| `/signup` | Create new gym | No (guest) |
| `/app` | Main application | Yes (user) |
| `/super-admin/(console)` | Admin console | Yes (platform admin) |
| `/super-admin/gyms` | Manage gyms | Yes (platform admin) |
| `/super-admin/members` | Manage members | Yes (platform admin) |
| `/forgot-password` | Password reset request | No |
| `/reset-password` | Reset password with token | No |
| `/login/mfa` | MFA verification | Yes (user with MFA) |
| `/super-admin/login/mfa` | Admin MFA verification | Yes (admin with MFA) |
| `/suspended` | Suspended gym page | Yes (user, gym suspended) |
| `/api/auth/login` | Login API | No |
| `/api/admin/auth/login` | Admin login API | No |