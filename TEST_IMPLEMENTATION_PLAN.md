# GymPulse Comprehensive Test Implementation Plan

## Overview
This document tracks the implementation of all test types for the GymPulse multi-tenant gym management SaaS platform.

## Test Layers & Status

### ✅ Layer 1: Unit Tests (Vitest) - EXISTING
**Location**: `tests/*.test.ts`
**Status**: 30+ test files exist covering core services

### ✅ Layer 2: Integration Tests (Vitest + Test DB) - EXISTING
**Location**: `tests/*.test.ts` (same files)
**Status**: Database-backed tests with isolated schema per run

### 🔄 Layer 3: API Contract Tests - TO IMPLEMENT
**Location**: `tests/api/*.test.ts`
**Target**: 100+ API routes in `src/app/api/`

### 🔄 Layer 4: E2E Tests (Playwright) - TO IMPLEMENT
**Location**: `e2e/*.spec.ts`
**Target**: 8 critical user journeys

### 🔄 Layer 5: Load Tests (k6) - PARTIAL
**Location**: `load-test.js` (exists)
**Target**: Extend with missing scenarios

### 🔄 Layer 6: Visual Regression Tests - TO IMPLEMENT
**Location**: `visual/*.spec.ts`
**Target**: 3D components, charts, public pages

### 🔄 Layer 7: Accessibility Tests - TO IMPLEMENT
**Location**: `a11y/*.spec.ts`
**Target**: Public pages, member flows, kiosk

### 🔄 Layer 8: Security Tests - TO IMPLEMENT
**Location**: `security/*.test.ts`
**Target**: Auth, payments, uploads, RBAC

### 🔄 Layer 9: Contract Tests (Pact) - TO IMPLEMENT
**Location**: `contracts/*.test.ts`
**Target**: Payment provider integrations

### 🔄 Layer 10: Chaos/Resilience Tests - TO IMPLEMENT
**Location**: `chaos/*.test.ts`
**Target**: DB, external APIs, queue resilience

---

## Implementation Order

### Phase 1: API Contract Tests (High Priority)
- [ ] Create test infrastructure for API testing
- [ ] Test all `/api/auth/*` routes
- [ ] Test all `/api/gym/*` routes
- [ ] Test all `/api/me/*` routes
- [ ] Test webhook endpoints
- [ ] Test super-admin routes

### Phase 2: E2E Tests (High Priority)
- [ ] Configure Playwright with test fixtures
- [ ] Journey 1: Gym onboarding → first member
- [ ] Journey 2: Member check-in (kiosk, QR, desk)
- [ ] Journey 3: Membership purchase/renewal
- [ ] Journey 4: Marketplace order flow
- [ ] Journey 5: Staff workflows
- [ ] Journey 6: Owner dashboard
- [ ] Journey 7: Super-admin operations
- [ ] Journey 8: Public page → lead → conversion

### Phase 3: Extended Load Tests (Medium Priority)
- [ ] Concurrent membership purchases
- [ ] Bulk import stress test
- [ ] Webhook flood simulation
- [ ] Prediction report generation
- [ ] Push notification delivery

### Phase 4: Visual Regression (Medium Priority)
- [ ] 3D components (gym-rig, lifter, scene)
- [ ] Dashboard charts
- [ ] Public gym pages
- [ ] Poster generation
- [ ] Receipt printing

### Phase 5: Accessibility Tests (Medium Priority)
- [ ] Public pages
- [ ] Member-facing flows
- [ ] Kiosk mode
- [ ] Admin dashboard

### Phase 6: Security Tests (High Priority)
- [ ] Authentication tests
- [ ] Authorization/RBAC tests
- [ ] Input validation tests
- [ ] Payment security tests
- [ ] File upload tests

### Phase 7: Contract Tests (Low Priority)
- [ ] eSewa provider contract
- [ ] Khalti provider contract
- [ ] Stripe provider contract
- [ ] Sandbox provider contract
- [ ] Webhook consumer contracts

### Phase 8: Chaos/Resilience Tests (Low Priority)
- [ ] Database connection pool exhaustion
- [ ] Slow query handling
- [ ] Deadlock recovery
- [ ] Payment provider downtime
- [ ] Email/SMS provider failures
- [ ] Worker queue backpressure

---

## Test Infrastructure Needed

### API Test Helpers
- Test client with auth helpers
- Request/response validation
- Database cleanup between tests

### E2E Test Fixtures
- Test users (owner, staff, member, super-admin)
- Test gym with data
- Test payments (sandbox)
- Test files for upload

### Visual Test Baseline
- Screenshot baselines for each component
- Viewport configurations
- Theme variations (light/dark)

### Security Test Data
- Malicious payloads
- SQL injection attempts
- XSS payloads
- File upload exploits

---

## CI/CD Integration

```yaml
# .github/workflows/test.yml
jobs:
  typecheck:
  lint:
  unit-integration:      # vitest run
  api-contract:          # vitest run tests/api
  e2e:                   # playwright test
  visual:                # playwright test visual
  a11y:                  # playwright test a11y
  security:              # vitest run tests/security
  load:                  # k6 run load-test.js (nightly)
  chaos:                 # vitest run tests/chaos (weekly)
```

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Unit/Integration Coverage | >80% |
| API Contract Coverage | 100% of public routes |
| E2E Journey Coverage | 8 critical journeys |
| Load Test Thresholds | All k6 thresholds pass |
| Visual Regression | 0 unintended changes |
| Accessibility | WCAG 2.1 AA |
| Security | 0 high/critical findings |
| Contract Tests | All providers verified |
| Chaos Tests | All scenarios recover |

---

## File Structure After Implementation

```
tests/
├── setup/                 # Existing
├── helpers/               # Existing
├── *.test.ts              # Existing unit/integration tests
├── api/                   # NEW: API contract tests
│   ├── auth/
│   ├── gym/
│   ├── me/
│   ├── webhooks/
│   └── admin/
├── security/              # NEW: Security tests
│   ├── auth.test.ts
│   ├── rbac.test.ts
│   ├── input-validation.test.ts
│   ├── payments.test.ts
│   └── uploads.test.ts
├── chaos/                 # NEW: Chaos tests
│   ├── db-resilience.test.ts
│   ├── external-api.test.ts
│   └── queue-resilience.test.ts
├── contracts/             # NEW: Pact contract tests
│   ├── esewa.test.ts
│   ├── khalti.test.ts
│   └── stripe.test.ts

e2e/                       # NEW: Playwright E2E tests
├── fixtures/
│   ├── users.ts
│   ├── gym.ts
│   └── payments.ts
├── journeys/
│   ├── onboarding.spec.ts
│   ├── checkin.spec.ts
│   ├── membership.spec.ts
│   ├── marketplace.spec.ts
│   ├── staff.spec.ts
│   ├── dashboard.spec.ts
│   ├── superadmin.spec.ts
│   └── public-lead.spec.ts
└── utils/

visual/                    # NEW: Visual regression
├── baselines/
├── components/
│   ├── three.spec.ts
│   ├── charts.spec.ts
│   └── ui.spec.ts
├── pages/
│   ├── public-gym.spec.ts
│   ├── poster.spec.ts
│   └── receipt.spec.ts
└── utils/

a11y/                      # NEW: Accessibility tests
├── public-pages.spec.ts
├── member-flows.spec.ts
├── kiosk.spec.ts
└── admin.spec.ts
```