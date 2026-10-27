/**
 * Extended GymPulse Load Test Scenarios
 * Additional scenarios beyond the basic load-test.js
 * 
 * Run: k6 run --vus 100 --duration 10m load-test-extended.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

// --- Custom Metrics ---

export const errorRate = new Rate("error_rate");
export const loginDuration = new Trend("login_duration");
export const checkInDuration = new Trend("checkin_duration");
export const dashboardDuration = new Trend("dashboard_duration");
export const membersDuration = new Trend("members_duration");
export const apiLatency = new Trend("api_latency");
export const paymentDuration = new Trend("payment_duration");
export const importDuration = new Trend("import_duration");
export const reportDuration = new Trend("report_duration");
export const wsLatency = new Trend("ws_latency");

export const checkInSuccess = new Counter("checkin_success");
export const checkInFailed = new Counter("checkin_failed");
export const paymentSuccess = new Counter("payment_success");
export const paymentFailed = new Counter("payment_failed");
export const importSuccess = new Counter("import_success");
export const importFailed = new Counter("import_failed");

// --- Configuration ---

export const options = {
  scenarios: {
    // Baseline load - normal operations
    baseline: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 20 },
        { duration: "5m", target: 20 },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "30s",
      tags: { scenario: "baseline" },
    },
    
    // Peak load - rush hour at gym
    peak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "3m", target: 100 },
        { duration: "2m", target: 100 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
      startTime: "3m",
      tags: { scenario: "peak" },
    },
    
    // Stress test - beyond capacity
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },
        { duration: "3m", target: 150 },
        { duration: "2m", target: 200 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
      startTime: "10m",
      tags: { scenario: "stress" },
    },
    
    // Soak test - sustained load
    soak: {
      executor: "constant-vus",
      vus: 30,
      duration: "30m",
      startTime: "15m",
      tags: { scenario: "soak" },
    },
    
    // Spike test - sudden burst
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "10s", target: 0 },
      ],
      startTime: "20m",
      tags: { scenario: "spike" },
    },
  },
  
  thresholds: {
    "error_rate": ["rate<0.05"],
    "login_duration": ["avg<3000", "p95<5000"],
    "checkin_duration": ["avg<2000", "p95<4000"],
    "dashboard_duration": ["avg<4000", "p95<8000"],
    "payment_duration": ["avg<5000", "p95<10000"],
    "import_duration": ["avg<30000", "p95<60000"],
    "report_duration": ["avg<10000", "p95<20000"],
    "ws_latency": ["avg<100", "p95<500"],
    "checks": ["rate>0.95"],
  },
};

// --- Test Data ---

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const DEMO_EMAIL = "owner@pulsefitness.demo";
const DEMO_PASSWORD = "GymPulse!Demo2026";

// Pre-generate test users for concurrent testing
const testUsers = new SharedArray("test users", function() {
  const users = [];
  for (let i = 0; i < 200; i++) {
    users.push({
      email: `loadtest${i}@test.com`,
      password: "LoadTest!2026",
      memberCode: `LT${i.toString().padStart(4, '0')}`,
    });
  }
  return users;
});

// --- Helper Functions ---

function getCsrfToken(res) {
  if (res.headers["set-cookie"]) {
    const match = res.headers["set-cookie"][0].match(/csrfToken=([^;]+)/);
    if (match) return match[1];
  }
  return "";
}

function login(email, password) {
  const payload = `identifier=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
  const params = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  };
  
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);
  const duration = Date.now() - start;
  
  loginDuration.add(duration);
  errorRate.add(res.status >= 400);
  
  return { res, duration, csrfToken: getCsrfToken(res) };
}

function authenticatedGet(url, csrfToken, headers = {}) {
  const params = {
    headers: {
      "Accept": "text/html",
      "X-CSRF-Token": csrfToken,
      ...headers,
    },
  };
  
  const start = Date.now();
  const res = http.get(`${BASE_URL}${url}`, params);
  const duration = Date.now() - start;
  
  apiLatency.add(duration);
  errorRate.add(res.status >= 400);
  
  return { res, duration };
}

function authenticatedPost(url, body, csrfToken, headers = {}) {
  const params = {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-CSRF-Token": csrfToken,
      ...headers,
    },
  };
  
  const start = Date.now();
  const res = http.post(`${BASE_URL}${url}`, JSON.stringify(body), params);
  const duration = Date.now() - start;
  
  apiLatency.add(duration);
  errorRate.add(res.status >= 400);
  
  return { res, duration };
}

// --- Workflows ---

// Workflow 1: Owner Login + Dashboard (25%)
function ownerWorkflow(vuId) {
  group("Owner Login + Dashboard", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res, csrfToken } = login(user.email, user.password);
    
    check(res, {
      "login success": (r) => r.status === 200 && r.json().user !== undefined,
    }) || errorRate.add(true);
    
    if (res.status !== 200) return;
    
    sleep(1);
    
    // Dashboard
    const dashStart = Date.now();
    const dashRes = http.get(`${BASE_URL}/app`, {
      headers: { "Accept": "text/html", "X-CSRF-Token": csrfToken },
    });
    dashboardDuration.add(Date.now() - dashStart);
    errorRate.add(dashRes.status >= 400);
    
    check(dashRes, { "dashboard loaded": (r) => r.status === 200 });
    
    // API calls
    authenticatedGet("/api/gym/dashboard", csrfToken);
    authenticatedGet("/api/gym/members?limit=20", csrfToken);
    authenticatedGet("/api/gym/payments?limit=20", csrfToken);
    
    sleep(2);
  });
}

// Workflow 2: Member Check-in (30%)
function checkInWorkflow(vuId) {
  group("Member Check-in", () => {
    // Simulate member self check-in
    const checkInStart = Date.now();
    const res = http.post(`${BASE_URL}/api/me/checkin`, "{}", {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });
    const duration = Date.now() - checkInStart;
    
    checkInDuration.add(duration);
    errorRate.add(res.status >= 400);
    
    const success = check(res, {
      "check-in success": (r) => r.status === 200,
      "check-in conflict": (r) => r.status === 409, // Already checked in
    });
    
    if (success) checkInSuccess.add(1);
    else checkInFailed.add(1);
    
    sleep(1);
  });
}

// Workflow 3: Membership Payment (15%)
function paymentWorkflow(vuId) {
  group("Membership Payment", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res: loginRes, csrfToken } = login(user.email, user.password);
    
    if (loginRes.status !== 200) return;
    
    sleep(1);
    
    // Start checkout
    const payStart = Date.now();
    const checkoutRes = http.post(`${BASE_URL}/api/me/renew`, JSON.stringify({
      planId: "plan-monthly",
      provider: "sandbox",
    }), {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });
    const payDuration = Date.now() - payStart;
    
    paymentDuration.add(payDuration);
    errorRate.add(checkoutRes.status >= 400);
    
    const success = check(checkoutRes, {
      "checkout started": (r) => r.status === 200 && r.json().payment !== undefined,
    });
    
    if (success) paymentSuccess.add(1);
    else paymentFailed.add(1);
    
    // Simulate payment completion
    if (checkoutRes.status === 200) {
      const payment = checkoutRes.json().payment;
      http.post(`${BASE_URL}/api/payments/sandbox/${payment.reference}`, JSON.stringify({
        status: "SUCCEEDED",
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    
    sleep(3);
  });
}

// Workflow 4: Member List & Search (10%)
function membersWorkflow(vuId) {
  group("Member List & Search", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res: loginRes, csrfToken } = login(user.email, user.password);
    
    if (loginRes.status !== 200) return;
    
    const membersStart = Date.now();
    const res = http.get(`${BASE_URL}/app/members`, {
      headers: { "Accept": "text/html", "X-CSRF-Token": csrfToken },
    });
    membersDuration.add(Date.now() - membersStart);
    errorRate.add(res.status >= 400);
    
    check(res, { "members page loaded": (r) => r.status === 200 });
    
    // Search
    authenticatedGet("/api/gym/members?search=John&limit=10", csrfToken);
    authenticatedGet("/api/gym/members?status=ACTIVE&page=1&limit=20", csrfToken);
    
    sleep(2);
  });
}

// Workflow 5: Bulk Import (5%)
function importWorkflow(vuId) {
  group("Bulk Import", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res: loginRes, csrfToken } = login(user.email, user.password);
    
    if (loginRes.status !== 200) return;
    
    // Create import job
    const importStart = Date.now();
    const createRes = http.post(`${BASE_URL}/api/gym/imports`, JSON.stringify({
      filename: `members-${vuId}-${Date.now()}.csv`,
      mimeType: "text/csv",
      sizeBytes: 50000,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });
    importDuration.add(Date.now() - importStart);
    errorRate.add(createRes.status >= 400);
    
    if (createRes.status === 201) {
      const job = createRes.json().job;
      
      // Upload file (simulated)
      http.post(`${BASE_URL}/api/gym/imports/${job.id}/upload`, "mock,csv,data", {
        headers: {
          "Content-Type": "text/csv",
          "X-CSRF-Token": csrfToken,
        },
      });
      
      // Process
      http.post(`${BASE_URL}/api/gym/imports/${job.id}/process`, "{}", {
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      
      importSuccess.add(1);
    } else {
      importFailed.add(1);
    }
    
    sleep(5);
  });
}

// Workflow 6: Report Generation (5%)
function reportWorkflow(vuId) {
  group("Report Generation", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res: loginRes, csrfToken } = login(user.email, user.password);
    
    if (loginRes.status !== 200) return;
    
    const reportStart = Date.now();
    const res = http.post(`${BASE_URL}/api/gym/reports/generate`, JSON.stringify({
      type: "MONTHLY_REVENUE",
      period: "2026-01",
    }), {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });
    reportDuration.add(Date.now() - reportStart);
    errorRate.add(res.status >= 400);
    
    check(res, { "report generated": (r) => r.status === 200 });
    
    sleep(3);
  });
}

// Workflow 7: WebSocket / Push (5%)
function websocketWorkflow(vuId) {
  group("WebSocket / Push", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res: loginRes, csrfToken } = login(user.email, user.password);
    
    if (loginRes.status !== 200) return;
    
    // Subscribe to push
    const wsStart = Date.now();
    const res = http.post(`${BASE_URL}/api/push/subscribe`, JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: "test", auth: "test" },
    }), {
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });
    wsLatency.add(Date.now() - wsStart);
    errorRate.add(res.status >= 400);
    
    sleep(2);
  });
}

// Workflow 8: Marketplace Browse & Purchase (5%)
function marketplaceWorkflow(vuId) {
  group("Marketplace", () => {
    const user = testUsers[vuId % testUsers.length];
    const { res: loginRes, csrfToken } = login(user.email, user.password);
    
    if (loginRes.status !== 200) return;
    
    // Browse
    authenticatedGet("/app/marketplace", csrfToken);
    authenticatedGet("/api/gym/products?status=ACTIVE", csrfToken);
    
    // Purchase
    const payStart = Date.now();
    const res = http.post(`${BASE_URL}/api/me/orders`, JSON.stringify({
      items: [{ productId: "prod-1", quantity: 1 }],
    }), {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });
    paymentDuration.add(Date.now() - payStart);
    errorRate.add(res.status >= 400);
    
    sleep(2);
  });
}

// --- Main Entry Point ---

export default function(data) {
  const vuId = __VU - 1;
  const scenario = __ENV.SCENARIO || "mixed";
  
  // Scenario-based workflow distribution
  const workflows = [];
  
  if (scenario === "baseline" || scenario === "mixed") {
    workflows.push(
      { fn: ownerWorkflow, weight: 25 },
      { fn: checkInWorkflow, weight: 30 },
      { fn: paymentWorkflow, weight: 15 },
      { fn: membersWorkflow, weight: 10 },
      { fn: importWorkflow, weight: 5 },
      { fn: reportWorkflow, weight: 5 },
      { fn: websocketWorkflow, weight: 5 },
      { fn: marketplaceWorkflow, weight: 5 },
    );
  } else if (scenario === "peak") {
    // More check-ins during peak
    workflows.push(
      { fn: checkInWorkflow, weight: 50 },
      { fn: ownerWorkflow, weight: 20 },
      { fn: paymentWorkflow, weight: 10 },
      { fn: membersWorkflow, weight: 10 },
      { fn: marketplaceWorkflow, weight: 10 },
    );
  } else if (scenario === "stress") {
    // High concurrency on all endpoints
    workflows.push(
      { fn: checkInWorkflow, weight: 30 },
      { fn: paymentWorkflow, weight: 30 },
      { fn: ownerWorkflow, weight: 20 },
      { fn: membersWorkflow, weight: 10 },
      { fn: importWorkflow, weight: 5 },
      { fn: reportWorkflow, weight: 5 },
    );
  }
  
  // Select workflow based on weights
  const totalWeight = workflows.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const workflow of workflows) {
    random -= workflow.weight;
    if (random <= 0) {
      workflow.fn(vuId);
      break;
    }
  }
  
  sleep(Math.random() * 2 + 1); // 1-3s think time
}

// --- Setup/Teardown ---

export function setup() {
  // Verify base URL is reachable
  const res = http.get(`${BASE_URL}/api/health`);
  if (res.status !== 200) {
    throw new Error(`Base URL ${BASE_URL} not reachable`);
  }
  
  // Create test users if needed
  // This would call an API to set up test data
  
  return { baseUrl: BASE_URL };
}

export function teardown(data) {
  // Cleanup test data
  console.log("Load test completed");
}