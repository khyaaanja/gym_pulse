# GymPulse Roles and Permissions

## Discovered User Roles

Based on code inspection, database schema, and testing, the following roles exist in the application:

### Anonymous Visitor / Guest
- **Authentication**: None (no session cookie)
- **Features**: Access landing page, view pricing, FAQ, records check, about section
- **Restrictions**: Cannot access any authenticated pages or API endpoints
- **Landing Page**: `/` (home page)

### Regular Member / Customer
- **Authentication**: Email/phone + password, optional MFA
- **Features**: View own profile, check-in via QR, view attendance, view at-risk status, view marketplace, purchase PT packs, view own payments
- **Restrictions**: Cannot access staff-only features, cannot view other members' private data, limited marketplace access
- **Landing Page**: `/app` (after login)
- **Test Account**: `member@pulsefitness.demo`

### Verified Member (with user account)
- **Authentication**: Email/phone + password + optional MFA
- **Same features as Regular Member**, plus any member-specific features
- **Test Account**: `member@pulsefitness.demo`

### Staff / Employee
- **Authentication**: Email/phone + password, optional MFA
- **Features**: View members, attendance, basic reports, check-in members, manage basic data
- **Restrictions**: Limited to their gym, cannot access admin console, restricted permissions based on role
- **Landing Page**: `/app` (after login)
- **Test Account**: `staff@pulsefitness.demo`

### Manager
- **Authentication**: Email/phone + password, optional MFA
- **Features**: All staff features PLUS: edit members, invite members, view full reports, manage bookings, manage promotions, manage diets, view leads
- **Restrictions**: Cannot access platform-wide admin functions, limited to their gym
- **Landing Page**: `/app` (after login)
- **Test Account**: `manager@pulsefitness.demo`

### Trainer
- **Authentication**: Email/phone + password, optional MFA
- **Features**: View members, view attendance, manage bookings, assign diet plans, view own bookings
- **Restrictions**: Limited to members they are assigned to, cannot edit member profiles broadly
- **Landing Page**: `/app` (after login)
- **Test Account**: `trainer@pulsefitness.demo`

### Super Administrator (Platform Admin)
- **Authentication**: Email + password + MFA (enforced unless ALLOW_ADMIN_WITHOUT_MFA=true)
- **Features**: Full platform access, manage all gyms, all users, all data, security settings, platform configuration
- **Restrictions**: None (full access)
- **Landing Page**: `/super-admin/(console)` (after login)
- **Test Account**: `super@gympulse.local`

### Support Administrator
- **Authentication**: Email + password + MFA (may be enforced)
- **Features**: View all gyms and users, support tickets, announcements, some platform config
- **Restrictions**: Limited to support functions, cannot manage platform core settings
- **Landing Page**: `/super-admin/(console)` (after login) - may land on login page depending on MFA status
- **Test Account**: `support@gympulse.local`

### Finance Administrator
- **Authentication**: Email + password + MFA (may be enforced)
- **Features**: View billing, payments, invoices, financial reports, platform settings related to finance
- **Restrictions**: Cannot access core platform administration (gyms, users, etc.)
- **Landing Page**: `/app` (after login) or may have finance-specific dashboard
- **Test Account**: `finance@gympulse.local`

### Vendor
- **Authentication**: Email + password
- **Features**: Manage vendor products, view orders, manage vendor-gym relationships
- **Restrictions**: Limited to their vendor profile and associated gyms
- **Landing Page**: `/app` (after login) or vendor-specific routes
- **Test Account**: `vendor@himalayan-nutrition.demo`

### Small Gym Owner
- **Authentication**: Email + password
- **Features**: Manage their small gym, basic features
- **Restrictions**: Limited data (small gym with minimal members)
- **Landing Page**: `/app` (after login)
- **Test Account**: `owner@yoganest.demo`

## Platform Role Permission Matrix

### Admin Permissions (from rbac.ts ADMIN_PERMISSIONS)

| Permission | SUPER_ADMIN | SUPPORT_ADMIN | FINANCE_ADMIN |
|------------|-------------|---------------|---------------|
| gyms.view | ✓ | ✓ | ✗ |
| gyms.manage | ✓ | ✗ | ✗ |
| gyms.support | ✓ | ✓ | ✗ |
| members.view | ✓ | ✓ | ✗ |
| billing.view | ✓ | ✗ | ✓ |
| billing.manage | ✓ | ✗ | ✓ |
| plans.manage | ✓ | ✗ | ✗ |
| flags.manage | ✓ | ✗ | ✗ |
| automations.manage | ✓ | ✗ | ✗ |
| notifications.manage | ✓ | ✗ | ✗ |
| marketplace.manage | ✓ | ✗ | ✗ |
| vendors.manage | ✓ | ✓ | ✗ |
| payments.manage | ✓ | ✗ | ✓ |
| content.manage | ✓ | ✗ | ✗ |
| announcements.manage | ✓ | ✓ | ✗ |
| support.manage | ✓ | ✓ | ✗ |
| imports.view | ✓ | ✓ | ✗ |
| prediction.manage | ✓ | ✗ | ✗ |
| analytics.view | ✓ | ✓ | ✓ |
| security.manage | ✓ | ✗ | ✗ |
| audit.view | ✓ | ✓ | ✓ |
| system.manage | ✓ | ✗ | ✗ |
| settings.manage | ✓ | ✗ | ✗ |
| admins.manage | ✓ | ✗ | ✗ |

## Staff Role Permission Defaults (from rbac.ts ROLE_DEFAULTS)

| Permission Set | OWNER | MANAGER | STAFF | TRAINER |
|----------------|-------|---------|-------|---------|
| members.view | ✓ | ✓ | ✓ | ✓ |
| members.edit | ✓ | ✓ | ✓ | ✗ |
| members.invite | ✓ | ✓ | ✓ | ✗ |
| members.delete | ✓ | ✗ | ✗ | ✗ |
| attendance.view | ✓ | ✓ | ✓ | ✓ |
| attendance.create | ✓ | ✓ | ✓ | ✓ |
| payments.view | ✓ | ✓ | ✗ | ✗ |
| payments.manage | ✓ | ✓ | ✗ | ✗ |
| reports.view | ✓ | ✓ | ✗ | ✗ |
| imports.create | ✓ | ✓ | ✗ | ✗ |
| imports.view | ✓ | ✓ | ✗ | ✗ |
| prediction.view | ✓ | ✓ | ✗ | ✗ |
| recovery.manage | ✓ | ✓ | ✓ | ✗ |
| notifications.send | ✓ | ✓ | ✓ | ✗ |
| marketplace.manage | ✓ | ✓ | ✗ | ✗ |
| bookings.manage | ✓ | ✓ | ✗ | ✓ |
| plans.manage | ✓ | ✓ | ✗ | ✗ |
| settings.manage | ✓ | ✗ | ✗ | ✗ |
| staff.manage | ✓ | ✗ | ✗ | ✗ |
| billing.manage | ✓ | ✗ | ✗ | ✗ |
| audit.view | ✓ | ✗ | ✗ | ✗ |
| leads.manage | ✓ | ✓ | ✓ | ✗ |
| promotions.manage | ✓ | ✓ | ✗ | ✗ |
| diet.manage | ✓ | ✓ | ✗ | ✓ |

### Owner-Only Permissions (cannot be granted to other roles)
- `billing.manage`
- `staff.manage`

## Cross-Role Access Analysis

### Owner vs Manager
- Owner has ALL permissions including `billing.manage` and `staff.manage`
- Manager has broad operational permissions but cannot manage billing or staff
- Owner cannot lose permissions (protected by code), but manager can be restricted

### Manager vs Trainer
- Manager has extensive view/edit/invite member permissions
- Trainer can only view members and perform limited actions (attendance, bookings, diets)
- Trainer cannot edit or invite members

### Staff vs Trainer
- Staff has broader attendance and recovery permissions than Trainer
- Both can view members and create attendance records
- Staff can send notifications; Trainer cannot

### All Roles vs Anonymous
- All authenticated roles have access to `/app` and authenticated features
- Anonymous visitors can only access the landing page `/`
- Protected routes redirect to `/login` when not authenticated

### User Roles vs Platform Admins
- User roles (owner, manager, staff, trainer) are gym-scoped
- Their permissions are limited to their associated gym
- Platform admins (super, support, finance) have cross-gym access
- User roles cannot access `/super-admin/` routes
- Platform admins can access gym-level routes but with some limitations