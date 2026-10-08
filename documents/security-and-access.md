# GymPulse Security and Access Document

## 1. Security Overview

### 1.1 Security Model
GymPulse employs a defense-in-depth security approach with multiple layers including authentication, authorization, data protection, and infrastructure security. The system handles sensitive gym member data, payment information, and personal identification.

### 1.2 Compliance
- **Data Privacy:** Member data protection with consent management
- **Payment Security:** Payment gateways (eSewa, Khalti) handle PCI-DSS compliance
- **Audit Requirements:** All actions logged for compliance and debugging
- **Access Controls:** Role-based access control (RBAC) throughout the system

## 2. User Roles and Permissions

### 2.1 Role-Based Access Control (RBAC)

| Role | Resource Access | Actions Allowed | Restrictions |
|------|----------------|-----------------|--------------|
| **Super Admin** | All gyms, platform settings | Full access, user management, system config | Elevated privileges required |
| **Gym Owner** | Own gym's data, all settings | Manage staff, plans, members, automations, marketplace | Limited to assigned gym |
| **Manager** | Own gym's data | Staff coordination, reports, booking management | Cannot modify gym settings |
| **Front Desk Staff** | Member lookup, check-in | Check-in members, view member status | Limited to check-in functions |
| **Trainer** | Assigned members' data | Bookings, member profiles, session progress | Cannot access other gym's data |
| **Member** | Personal data only | Dashboard, check-in, marketplace purchases, rewards | Cannot access other members' data |
| **Vendor** | Vendor dashboard | Products, inventory, orders, analytics | Limited to vendor domain |

### 2.2 Permission Granularity

#### Owner Permissions
- ✅ Full dashboard access
- ✅ Staff member management
- ✅ Financial reports and payment settings
- ✅ Membership plan creation
- ✅ Marketplace and vendor management
- ✅ Automation rules and notifications
- ✅ Access to all member data and analytics

#### Manager Permissions
- ✅ Staff coordination
- ✅ Member reports and analysis
- ✅ Booking management
- ✅ Recovery task assignments
- ❌ Limited settings access (owner-controlled)

#### Front Desk Staff Permissions
- ✅ Check-in members (via QR code or staff lookup)
- ✅ View member status and details
- ✅ Record payments
- ✅ Process renewals
- ✅ Create recovery tasks
- ❌ Cannot modify gym configurations

#### Trainer Permissions
- ✅ View assigned member profiles
- ✅ Manage bookings and sessions
- ✅ Update session progress
- ✅ View member attendance and streaks
- ✅ Send recovery messages
- ❌ Cannot access financial data

#### Member Permissions
- ✅ Personal dashboard with gamification stats
- ✅ Check-in history and attendance calendar
- ✅ Current streak and milestone progress
- ✅ Challenge tracking
- ✅ Membership renewal
- ✅ Marketplace browsing and purchases
- ✅ Pass QR code for check-in
- ❌ Cannot access other members' data

#### Vendor Permissions
- ✅ Manage products and inventory
- ✅ View orders and fulfillment
- ✅ Access vendor analytics
- ✅ Manage gym partnerships
- ❌ Cannot access member personal data

## 3. Authentication Security

### 3.1 Password Security
- **Hashing Algorithm:** @node-rs/argon2 (Argon2)
- **Password Policy:** Minimum length, complexity requirements
- **Demo Account Password:** `GymPulse!Demo2026` (for demonstration only)
- **Production:** Strong password requirements enforced

### 3.2 Session Management
- Secure cookies with HttpOnly and SameSite attributes
- Session timeout after period of inactivity
- Concurrent session limits per user
- Sign-out invalidates all device sessions
- Push notification deactivation on sign-out (shared device protection)

### 3.3 VAPID Key Management (Push Notifications)
- **Public Key:** Stored in `.env` file (non-sensitive)
- **Private Key:** Kept secret, never committed to version control
- **Subject:** mailto address for the gym/organization
- **Key Rotation:** Changing keys invalidates all devices; users must re-enable push
- **Generation:** `npx web-push generate-vapid-keys`

### 3.4 Login Security
- Rate limiting on login attempts
- Account lockout after multiple failed attempts
- CAPTCHA or verification for suspicious activity
- Demo account credentials provided for testing only

## 4. Authorization Security

### 4.1 Role Enforcement
- Middleware checks role permissions on every protected route
- API route guards validate user role before processing
- Frontend components conditionally render based on role
- Backend validates all operations against user permissions

### 4.2 Branch/Organization Isolation
- Each gym/owner has data isolation
- Multi-branch support with branch-level permissions
- Staff assigned to specific branches/gyms
- Data queries scoped to user's gym/organization

### 4.3 Feature Flag Management
- Feature flags per plan/gym configuration
- Super admin controls feature enablement
- Owner can enable/disable features for their gym
- Flags affect marketplace, challenges, etc.

## 5. Data Security

### 5.1 Audit Trail
- **Logged Actions:** Login, data changes, payments, notifications
- **Log Fields:** User ID, action type, timestamp, IP address, details
- **Retention:** Permanent storage for compliance
- **Access:** Super admin can view; role-based visibility
- **Purpose:** Security monitoring, debugging, compliance

### 5.2 Data Classification
- **Public:** Gym announcements, marketplace listings (active products)
- **Internal:** Member attendance, streaks, check-in history
- **Confidential:** Payment details, personal identification, phone numbers
- **Restricted:** Super admin operations, financial reports

### 5.3 Data Protection Measures
- Prisma ORM prevents SQL injection
- Input validation with Zod schema
- Environment variable separation (sensitive data in .env)
- HTTPS enforcement for all external communications
- Data encryption at rest (database level)
- Data encryption in transit (TLS for all API calls)

### 5.4 Export & Download Controls
- CSV export available for reports (owner/manager/admin)
- Audit logs exportable
- Member data export with consent
- Rate limiting on export operations
- Download logging for compliance

## 6. Access Control Implementation

### 6.1 Next.js Middleware
```typescript
// Example middleware pattern
import { withAuth } from '@/lib/auth';

const protectedRoute = withAuth({
  roles: ['owner', 'manager', 'staff'],
  onDenied: '/login',
});
```

### 6.2 API Route Guards
```typescript
// Example API guard
import { getUser } from '@/lib/auth';

export async function GET(request: Request) {
  const user = await getUser();
  if (!user?.roles.includes('trainer')) {
    return new Response('Forbidden', { status: 403 });
  }
  // ... proceed with handler
}
```

### 6.3 Component-Level Access
```tsx
// Conditional rendering based on role
{user.role === 'owner' && <AdminPanel />}
{user.role === 'trainer' || user.role === 'owner' && <BookingManager />}
{user.role === 'member' && <MemberDashboard />}
```

### 6.4 Route Protection
- Next.js App Router middleware
- Route handlers validate authentication
- Dynamic route parameters validated against user access
- Catch-all routes protected at middleware level

## 7. Security Best Practices

### 7.1 Environment Configuration
- Never commit `.env` files to version control
- VAPID private key must remain secret
- Database credentials secured
- Payment provider keys not exposed in frontend
- API keys rotated regularly

### 7.2 Regular Security Audits
- Review audit logs weekly
- Monitor for unusual access patterns
- Quarterly permission review
- Annual security assessment
- Dependency vulnerability scanning

### 7.3 Incident Response
- Security incident reporting path
- Audit log review for breaches
- Affected user notification procedure
- Token/key rotation if compromised
- System update and patch schedule

### 7.4 Data Handling Guidelines
- Member consent before data export
- Phone number validation for SMS
- Secure payment processing via gateways
- No plaintext password storage
- Regular database backups
- GDPR/privacy law compliance consideration

### 7.5 Access Incident Prevention
- Logout from shared devices
- Don't share credentials
- Regular password updates
- Monitor active sessions
- Report suspicious activity immediately