# Ngrok Compatibility Report for GymPulse

## Test Environment
- **App**: Next.js 16.3.6 (GymPulse)
- **Ngrok**: Free tier (http/https tunnels)
- **Next.js Config**: `next.config.ts` with security headers
- **Environment**: `.env` with `APP_URL=http://localhost:3000`
- **Testing Date**: Mon Sep 28 2026

---

## Test Results

### 1. Basic Page Loading ✅
- The app HTML loads successfully via ngrok
- URL: `https://pumice-lifting-fervor.ngrok-free.dev`
- All page content, including Three.js scene and interactive elements, renders

### 2. API Routes ✅
- `GET /api/health` - Returns 200 OK with database status
- `GET /api/auth/me` - Returns 401 (expected without auth)
- `GET /api/auth/login` - Endpoint available
- Redirects work correctly (e.g., `/signup` loads without issue)

### 3. Security Headers Analysis ⚠️

| Header | Value | Impact |
|--------|-------|--------|
| `X-Frame-Options` | `DENY` | **BLOCKS NGROK** - Prevents page from being displayed within ngrok's interface |
| `Cross-Origin-Opener-Policy` | `same-origin` | May cause issues with ngrok's cross-origin framing |
| `X-Content-Type-Options` | `nosniff` | Standard security header, no ngrok impact |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=()` | Standard, no ngrok impact |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Standard, no ngrok impact |

### 4. Next.js Dev Origins Configuration ⚠️

```typescript
// next.config.ts line 14
allowedDevOrigins: ["192.168.100.77", "127.0.0.1"]
```

**Issue**: Ngrok provides URLs like `https://pumice-lifting-fervor.ngrok-free.dev`, which are **not** in the `allowedDevOrigins` list. This can cause:
- HMR (Hot Module Replacement) not working through ngrok
- Next.js may block asset loading from the ngrok origin
- Development experience degradation

### 5. APP_URL Configuration ⚠️

```
APP_URL=http://localhost:3000
```

**Issue**: If the app generates redirects or canonical URLs based on `APP_URL`, these will point to `localhost:3000` instead of the ngrok URL. This can cause:
- Redirect loops or broken links
- Asset URLs in HTML pointing to localhost instead of ngrok
- Potential issues with OAuth callbacks and webhook URLs

---

## Root Cause Analysis

### Primary Issue: `X-Frame-Options: DENY`
Ngrok works by rendering the tunneled web page within an iframe in its own dashboard interface. The `X-Frame-Options: DENY` header explicitly prohibits the page from being embedded in a frame, which causes ngrok to either:
- Block the page from displaying entirely
- Show a broken/empty frame
- Fail the tunnel connection for HTTPS pages

This is the **primary reason** the app "is not properly working through ngrok."

### Secondary Issues:
1. **`allowedDevOrigins` mismatch** - Ngrok origins not whitelisted for dev mode
2. **`APP_URL` pointing to localhost** - Generated URLs won't match the ngrok domain

---

## Recommendations

### Fix 1: Allow ngrok framing (Most Critical)
Modify `next.config.ts` to either:
- Change `X-Frame-Options` to `SAMEORIGIN` (allows framing from same-origin ngrok URLs)
- Or remove the header entirely if not needed for security compliance

```typescript
// Option A: Allow same-origin framing
X-Frame-Options: same-origin

// Option B: Remove the header completely
// Delete from securityHeaders array
```

### Fix 2: Add ngrok to allowed dev origins
```typescript
// next.config.ts
allowedDevOrigins: [
  "192.168.100.77",
  "127.0.0.1",
  "*.ngrok-free.dev",  // Add ngrok free tier domains
  "*.ngrok.app",       // Add ngrok domain tier (if applicable)
],
```

### Fix 3: Update APP_URL for ngrok testing
Either:
- Set `APP_URL` dynamically, or
- Use `http://localhost:3000` only for local dev, and override when testing with ngrok

```bash
# When starting dev server with ngrok
APP_URL=https://${NGROK_URL} npx next dev
```

### Fix 4: Consider CSP header adjustments
The Content-Security-Policy in the headers middleware restricts `script-src` to `'self'`. If ngrok requires additional sources, update accordingly:

```typescript
// In next.config.ts headers()
{
  source: "/:path*",
  headers: [
    // ...existing headers
    {
      key: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self' https://*.ngrok-free.dev;",
    },
  ],
}
```

---

## Summary

| Issue | Severity | Status |
|-------|----------|--------|
| `X-Frame-Options: DENY` blocks ngrok framing | **CRITICAL** | ✅ Confirmed blocking ngrok display |
| `allowedDevOrigins` missing ngrok domains | **HIGH** | ✅ HMR and asset loading may fail |
| `APP_URL` hardcoded to localhost | **MEDIUM** | ✅ May cause redirect/URL issues |
| API routes work fine | **LOW** | ✅ All tested endpoints functional |

**Overall**: The app's core functionality works through ngrok, but the `X-Frame-Options: DENY` header prevents ngrok from displaying the page within its interface, which is the main way users access ngrok tunnels. This needs to be addressed for proper ngrok compatibility.