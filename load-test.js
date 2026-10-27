/**
 * GymPulse Load Test Script
 * Comprehensive load testing for GymPulse application
 * Based on GO-LIVE-RUNBOOK: 50 concurrent logins, check-ins, and owner dashboards
 * 
 * Run: /home/kali-linux/gym/k6-bin/k6-v0.51.0-linux-amd64/k6 run --vus 50 --duration 5m load-test.js
 * 
 * Output: Full k6 performance report with:
 * - Request rates (RPS)
 * - Latency metrics (avg, min, max, p95, p99)
 * - Error rates per endpoint
 * - Per-endpoint timing breakdowns
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// --- Custom Metrics ---

// Error rate metric
export const errorRate = new Rate("error_rate");

// Latency trends per workflow
export const loginDuration = new Trend("login_duration");
export const checkInDuration = new Trend("checkin_duration");
export const dashboardDuration = new Trend("dashboard_duration");
export const membersDuration = new Trend("members_duration");
export const apiLatency = new Trend("api_latency");

// --- Configuration ---

export const options = {
  // 50 virtual users over 5 minutes with stages
  stages: [
    { duration: "1m", target: 10 },   // ramp up to 10 VUs
    { duration: "2m", target: 30 },   // ramp up to 30 VUs
    { duration: "1m", target: 50 },   // ramp up to 50 VUs
    { duration: "1m", target: 50 },   // stay at 50 VUs
    { duration: "30s", target: 0 },   // ramp down
  ],
  
  // Thresholds for failure detection
  thresholds: {
    "error_rate": ["rate<0.05"],            // < 5% error rate
    "login_duration": ["avg<3000"],         // avg login < 3s
    "checkin_duration": ["avg<2000"],       // avg check-in < 2s
    "dashboard_duration": ["avg<4000"],    // avg dashboard < 4s
    "members_duration": ["avg<2500"],       // avg members < 2.5s
    "api_latency": ["avg<2000"],            // avg API < 2s
  },
};

// Base URL - adjust based on environment
export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Demo credentials from prisma seed
const DEMO_EMAIL = "owner@pulsefitness.demo";
const DEMO_PASSWORD = "GymPulse!Demo2026";

// CSRF token tracking across VUs
let csrfToken = "";

// Track per-VU state
export function initContext() {
  return {
    csrfToken: "",
  };
}

export default function (data) {
  const ctx = data || initContext();
  ctx.csrfToken = ctx.csrfToken || csrfToken;
  
  // =====================================================
  // WORKFLOW 1: Owner Login (40% of VU iterations)
  // =====================================================
  if (Math.random() < 0.4) {
    loginWorkflow(ctx.csrfToken);
    sleep(1);
  }

  // =====================================================
  // WORKFLOW 2: Check-in Member (35% of VU iterations)
  // =====================================================
  if (Math.random() < 0.35) {
    checkInWorkflow();
    sleep(1);
  }

  // =====================================================
  // WORKFLOW 3: Owner Dashboard (25% of VU iterations)
  // =====================================================
  if (Math.random() < 0.25) {
    dashboardWorkflow(ctx.csrfToken);
    sleep(1);
  }

  // =====================================================
  // WORKFLOW 4: Members page (15% of VU iterations)
  // =====================================================
  if (Math.random() < 0.15) {
    membersWorkflow();
    sleep(1);
  }
}

// =====================================================
// Login Workflow
// =====================================================
function loginWorkflow(csrfToken) {
  const payload = `identifier=${DEMO_EMAIL}&password=${DEMO_PASSWORD}${
    csrfToken ? `&csrfToken=${csrfToken}` : ""
  }`;

  const params = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/login`, payload, params);
  const duration = Date.now() - startTime;

  loginDuration.add(duration);
  errorRate.add(!res || res.status >= 400);

  // Check for successful login - redirect to /app
  const loginSuccess = res && res.status === 302 && res.headers && res.headers.location && res.headers.location.includes("/app");
  check("login success", () => loginSuccess);
  
  // Update global csrfToken for subsequent requests
  if (res && res.status === 302 && res.headers && res.headers.setCookie) {
    const cookieMatch = res.headers.setCookie[0] && res.headers.setCookie[0].match(/csrfToken=([^;]+)/);
    if (cookieMatch) {
      csrfToken = cookieMatch[1];
    }
  }
}

// =====================================================
// Check-in Workflow
// =====================================================
function checkInWorkflow() {
  // Navigate to /app to maintain session
  const appRes = http.get(`${BASE_URL}/app`);
  
  const startTime = Date.now();
  const checkInRes = http.post(
    `${BASE_URL}/api/check-in`,
    JSON.stringify({ memberId: "member-1" }),
    {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    }
  );
  const duration = Date.now() - startTime;

  checkInDuration.add(duration);
  errorRate.add(!checkInRes || checkInRes.status >= 400);

  check("check-in status", () => {
    if (!checkInRes) return false;
    return checkInRes.status < 500;
  });
}

// =====================================================
// Dashboard Workflow
// =====================================================
function dashboardWorkflow(csrfToken) {
  // Navigate to dashboard
  const startTime = Date.now();
  const dashboardRes = http.get(`${BASE_URL}/app`, {
    headers: {
      "Accept": "text/html",
    },
  });
  const duration = Date.now() - startTime;

  dashboardDuration.add(duration);
  errorRate.add(!dashboardRes || dashboardRes.status >= 400);

  // Also try API endpoints
  const apiStart = Date.now();
  const apiRes = http.get(`${BASE_URL}/api/health`, {
    headers: { "Accept": "application/json" },
  });
  const apiDuration = Date.now() - apiStart;
  apiLatency.add(apiDuration);

  check("dashboard loaded", () => dashboardRes && dashboardRes.status === 200);
  check("health API", () => apiRes && apiRes.status === 200);
}

// =====================================================
// Members Workflow
// =====================================================
function membersWorkflow() {
  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/app/members`, {
    headers: { "Accept": "text/html" },
  });
  const duration = Date.now() - startTime;

  membersDuration.add(duration);
  errorRate.add(!res || res.status >= 400);

  check("members page", () => res && res.status === 200);
}