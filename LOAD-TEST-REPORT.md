# GymPulse Load Test Report
## Comprehensive Performance Analysis

**Test Executed:** October 11, 2026  
**Load Testing Tool:** k6 v0.51.0  
**Target Application:** GymPulse (localhost:3000)  
**Test Duration:** 5 minutes  
**Virtual Users:** 50 (staged: 10 → 30 → 50 → 50 → ramp down)

---

## 📊 Executive Summary

The load test simulated realistic user workflows for the GymPulse application, including owner logins, member check-ins, dashboard navigation, and members page access. The test ran with 50 concurrent virtual users over 5 minutes, generating 1,227 total iterations.

### Key Findings

| Metric | Result | Threshold | Status |
|--------|--------|-----------|--------|
| **Error Rate** | 30.13% | < 5% | ❌ FAIL |
| **Request Failure Rate** | 15.55% | — | ⚠️ High |
| **Owner Login (p95)** | 7,327 ms | < 3,000 ms | ❌ Slow |
| **Check-in (p95)** | 14,548 ms | < 2,000 ms | ❌ Slow |
| **Dashboard (p95)** | 16,102 ms | < 4,000 ms | ❌ Slow |
| **Members Page (p95)** | 60,000 ms | < 2,500 ms | ❌ Very Slow |
| **API Health (p95)** | 5,135 ms | < 2,000 ms | ❌ Slow |
| **Average RPS** | 1.0 req/s | — | Low load |

---

## 📈 Detailed Performance Metrics

### 1. Owner Login Workflow
- **Average Duration:** 3,405 ms
- **P50 (Median):** 2,212 ms
- **P95 (95th percentile):** 7,327 ms
- **P99 (99th percentile):** 13,958 ms
- **Max Observed:** 60,001 ms
- **Samples:** 482 iterations
- **Status:** ❌ Below target — p95 exceeds 3s threshold by ~2.4x

### 2. Check-in Member Workflow
- **Average Duration:** 6,546 ms
- **P50 (Median):** 3,859 ms
- **P95 (95th percentile):** 14,548 ms
- **P99 (99th percentile):** 60,001 ms
- **Max Observed:** 60,004 ms
- **Samples:** 448 iterations
- **Status:** ❌ Well above target — p95 exceeds 2s threshold by ~7.3x

### 3. Owner Dashboard Workflow
- **Average Duration:** 7,350 ms
- **P50 (Median):** 4,402 ms
- **P95 (95th percentile):** 16,102 ms
- **P99 (99th percentile):** 60,001 ms
- **Max Observed:** 60,010 ms
- **Samples:** 317 iterations
- **Status:** ❌ Significantly above target — p95 exceeds 4s threshold by ~4x

### 4. Members Page Workflow
- **Average Duration:** 9,335 ms
- **P50 (Median):** 4,519 ms
- **P95 (95th percentile):** 60,000 ms
- **P99 (99th percentile):** 60,001 ms
- **Max Observed:** 60,001 ms
- **Samples:** 200 iterations
- **Status:** ❌ Severely degraded — p95 at 60s suggests page load timeouts or performance bottlenecks

### 5. API Health Check
- **Average Duration:** 2,952 ms
- **P50 (Median):** 1,938 ms
- **P95 (95th percentile):** 5,135 ms
- **P99 (99th percentile):** 13,508 ms
- **Max Observed:** 60,001 ms
- **Samples:** 307 iterations
- **Status:** ❌ Above target — p95 exceeds 2s threshold by ~2.6x

---

## ⚠️ Error Analysis

### Error Rate: 30.13%
- **Average error rate across all VUs:** 30.13%
- **Peak error rate:** 100% (during timeout events)

### Request Failure Rate: 15.55%
- **Total failed HTTP requests:** 2,676 out of 17,239 total
- Primary failure reasons:
  - Request timeouts (connection reset by peer, read timeouts)
  - Server-side processing under load

### Timeout Events Observed
- `/login` POST requests: multiple timeouts during peak load
- `/api/check-in` POST requests: request timeouts
- `/app` GET requests: request timeouts
- `/app/members` GET requests: request timeouts
- `/api/health` GET requests: request timeouts

The timeouts suggest the application server (running on localhost:3000) struggled to handle the concurrent load of 50 VUs, particularly for page rendering and API processing.

---

## 🔍 Root Cause Indicators

Based on the error patterns and latency data, the following issues are likely:

1. **Server Resource Contention:** 50 concurrent users overwhelmed the development server
2. **Database Query Performance:** Several endpoints likely performing slow database operations
3. **CSRF Token Management:** Token regeneration or validation delays under concurrent access
4. **Template Rendering:** Next.js server-side rendering may be slow under load
5. **Memory Pressure:** Sustained 50 VUs may have caused garbage collection pauses

---

## 📋 GO-LIVE-RUNBOOK Compliance

The GO-LIVE-RUNBOOK specifies: *"Use `k6` against staging: 50 concurrent logins, check-ins, and owner dashboards. Watch DB connections and p95 latency."*

### Compliance Status: ⚠️ PARTIAL

**Met:**
- ✅ 50 concurrent users tested
- ✅ Logins, check-ins, and dashboards covered
- ✅ Duration monitoring performed

**Not Met:**
- ❌ p95 latency thresholds not met for any workflow
- ❌ Error rate exceeds acceptable limits (30.13% vs 5% target)
- ❌ No staging environment tested (tested against local dev)
- ❌ DB connection monitoring not integrated

---

## 🎯 Recommendations

### Immediate Actions (Critical)

1. **Investigate Dashboard Performance**
   - The Members page at 60s p95 is a critical blocker
   - Profile database queries on `/app/members` and `/app` routes
   - Implement pagination or virtualization for member lists

2. **Optimize Check-in Workflow**
   - Average 6.5s is too slow for a simple check-in
   - Review `/api/check-in` endpoint for database bottleneck
   - Consider caching frequently accessed member data

3. **Reduce Error Rate**
   - Current 30% error rate is unacceptable for production
   - Add retry logic for transient failures
   - Investigate and fix connection timeout issues

### Short-term Improvements

4. **Implement Proper Staging Environment**
   - Test against actual staging URL, not localhost
   - Use dedicated load testing infrastructure

5. **Add DB Connection Monitoring**
   - Monitor PostgreSQL connection pool usage during test
   - Set alerts for connection exhaustion

6. **Implement Gradual Load Ramping**
   - Current test went straight to 50 VUs
   - Use staged ramping to identify breaking points

### Long-term Architecture

7. **API Response Caching**
   - Cache frequently read data that doesn't change rapidly
   - Implement HTTP caching headers

8. **Database Index Optimization**
   - Review query patterns from load test
   - Add missing indexes on frequently filtered columns

9. **Implement CDN/Edge Caching**
   - Static assets and page fragments should be cacheable
   - Reduce origin server load

10. **Add Horizontal Scaling**
    - If 50 users causes issues, implement auto-scaling
    - Use connection pooling for database access

---

## 📊 Graph & Visual Summary

*(Note: Actual k6 HTML report would provide detailed graphs)*

```
Latency Percentiles Comparison:
--------------------------------
Workflow                  P95 Target   P95 Actual   Gap
-------------------------------------------------------
Owner Login              3,000 ms      7,327 ms     +144%
Check-in Member          2,000 ms     14,548 ms     +627%
Owner Dashboard          4,000 ms     16,102 ms     +303%
Members Page             2,500 ms     60,000 ms    +2300%
API Health Check         2,000 ms      5,135 ms     +157%
-------------------------------------------------------
Error Rate:              < 5%          30.13%        +502%
-------------------------------------------------------
```

---

## 🛠 Test Configuration

```javascript
// k6 Run Command
/k6-bin/k6-v0.51.0-linux-amd64/k6 run --vus 50 --duration 5m load-test.js

// Test Options
export const options = {
  stages: [
    { duration: "1m", target: 10 },   // ramp up to 10 VUs
    { duration: "2m", target: 30 },   // ramp up to 30 VUs
    { duration: "1m", target: 50 },   // ramp up to 50 VUs
    { duration: "1m", target: 50 },   // stay at 50 VUs
    { duration: "30s", target: 0 },   // ramp down
  ],
  thresholds: {
    "error_rate": ["rate<0.05"],
    "login_duration": ["avg<3000"],
    "checkin_duration": ["avg<2000"],
    "dashboard_duration": ["avg<4000"],
    "members_duration": ["avg<2500"],
    "api_latency": ["avg<2000"],
  },
}
```

---

## 📁 Generated Artifacts

- `load-test-results.json` — Full k6 JSON output (487 MB)
- `load-test.js` — Load test script used
- This report: `LOAD-TEST-REPORT.md`

---

**Report Generated:** October 11, 2026  
**Next Review:** After performance optimizations implemented  
**Contact:** Review performance metrics before scaling to production