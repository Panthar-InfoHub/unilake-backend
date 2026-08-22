# Production Go-Live — Step-by-Step Runbook

**Status:** backend deployed to Render, frontend deployed to Vercel, custom domains mapped and verified.
**What's left:** point all the code and dashboards at the new domains.

Work through the steps in order. Do not skip ahead — Step 10 depends on everything before it.

---

## YOUR ACTUAL URLS

| Thing | URL | Notes |
|---|---|---|
| **Frontend (canonical)** | `https://www.unilakekids.com` | Vercel. The apex 308-redirects here, so `www` is the real origin. |
| Frontend (apex) | `https://unilakekids.com` | Redirects to `www` |
| Frontend (Vercel default) | `https://unilake-frontend.vercel.app` | ⚠️ Still live. Login will NOT work here — see the note at the end of Step 1. |
| **Backend** | `https://api.unilakekids.com` | Render |
| Backend (Render default) | `https://unilake-backend.onrender.com` | ⚠️ Still enabled. Never put this in any config. |
| **Shared parent domain** | `unilakekids.com` | This is what makes cookies work |

### ✅ Why your setup is the right one

`www.unilakekids.com` and `api.unilakekids.com` share the registrable domain `unilakekids.com`, so browsers treat them as **the same site**. That means:

- The session cookie can be set on `.unilakekids.com` and sent to both.
- It is **first-party**, so Brave / Safari / Chrome third-party-cookie blocking does not apply.
- `proxy.ts` (which runs on Vercel) can actually see the cookie.

None of that would have been true on `*.vercel.app` + `*.onrender.com`.

---

# STEP 1 — Backend code changes

## 1.1 `src/app.ts` — CORS allow-list

**Replace** the hardcoded `origin: "http://localhost:3000"` (and delete the commented-out block above it):

```ts
const allowedOrigins = [
  "https://www.unilakekids.com",   // canonical production frontend
  "https://unilakekids.com",       // apex — redirects to www, but be safe
  "http://localhost:3000",         // local dev
];

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = same-origin navigation, curl, or Render's health check.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      // Vercel preview deployments get a fresh URL per branch.
      // Public endpoints will work from these; anything needing a login will not
      // (the cookie is scoped to .unilakekids.com). Drop this block if you don't
      // want previews talking to production data.
      if (/^https:\/\/unilake-frontend-[a-z0-9-]+\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
```

> Keep `credentials: true` and keep `PATCH` in `methods`. The whole session flow breaks without either.

## 1.2 `src/lib/auth.ts` — `trustedOrigins`

```ts
trustedOrigins: [
  "http://localhost:3000",
  "https://www.unilakekids.com",
  "https://unilakekids.com",
],
```

> This is a **separate list from CORS**. Better Auth rejects sign-in and OAuth callbacks from origins not listed here. Updating one and forgetting the other gives you a half-working login that is very confusing to debug.

## 1.3 `src/lib/auth.ts` — enable cross-subdomain cookies 🔴 the important one

Uncomment the stubbed block and set your real domain:

```ts
advanced: {
  defaultCookieAttributes: {
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    httpOnly: true,
  },
  crossSubDomainCookies: isProd
    ? { enabled: true, domain: ".unilakekids.com" }  // leading dot = all subdomains
    : { enabled: false },
},
```

The leading dot is what lets `api.unilakekids.com` set a cookie that `www.unilakekids.com` can also send. Without this, login will appear to work and then not persist.

Leave `sameSite`/`secure` exactly as they are — no change needed.

---

# STEP 2 — Frontend code changes

## 2.1 `proxy.ts` — the cookie name changes in production 🔴

Better Auth adds a `__Secure-` prefix to cookies whenever the base URL is `https`. Your middleware currently looks for the unprefixed name only, so **every protected route would bounce a logged-in user back to `/login`**.

**Replace:**

```ts
const SESSION_COOKIE_NAME = "better-auth.session_token";
```

**With:**

```ts
// Better Auth prefixes cookies with "__Secure-" whenever the base URL is https,
// so the name differs between local dev and production. Check both.
const SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token", // production
  "better-auth.session_token",          // local dev
];
```

**And replace:**

```ts
const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
const hasSession = Boolean(sessionCookie?.value);
```

**With:**

```ts
const hasSession = SESSION_COOKIE_NAMES.some(
  (name) => Boolean(request.cookies.get(name)?.value)
);
```

## 2.2 `next.config.ts` — fix the stale fallback

The current fallback points at the **old Cloud Run backend**. If the env var is ever missing at build time, production silently proxies auth to a dead service.

```ts
destination: `${process.env.NEXT_PUBLIC_AUTH_URL || "https://api.unilakekids.com"}/api/auth/:path*`,
```

---

# STEP 3 — Commit and push

Push both repos. Render and Vercel will auto-deploy.

**Do not continue to Step 10 (verification) until both deploys are green.** Steps 4–9 can be done while they build.

---

# STEP 4 — Render environment variables

Dashboard → your service → **Environment**.

| Variable | Set to | Why |
|---|---|---|
| `BETTER_AUTH_URL` | `https://api.unilakekids.com` | 🔴 The **backend's own** URL, not the frontend's. Drives the OAuth callback base *and* triggers the `__Secure-` cookie prefix. |
| `NODE_ENV` | `production` | 🔴 Flips cookies to `secure: true` and enables `crossSubDomainCookies`. Without it, Step 1.3 does nothing. |
| `RAZORPAY_WEBHOOK_SECRET` | new production secret | Must match Step 7 exactly |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | live keys | Only when taking real money — test keys are fine to start |
| `BETTER_AUTH_SECRET` | a **new** random value | Don't reuse your dev secret in production |

**Leave alone** (already correct, environment-independent): `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, all `R2_*`, `RUNPOD_*`, `GOOGLE_*`, `FACEBOOK_*`.

**Do not set `PORT`.** Render injects it automatically.

> 🔴 **No quotes around any value.** `dotenv` strips quotes locally; Render does not. A quoted URL becomes `%22https://...%22` and fails in a way that is very hard to spot.

---

# STEP 5 — Vercel environment variables

Dashboard → project → **Settings → Environment Variables** → scope **Production**.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_AUTH_URL` | `https://api.unilakekids.com` |
| `NEXT_PUBLIC_APP_ENV` | `production` |

> 🔴 **No trailing slash** on the URL. `websocket.ts` strips the protocol with a regex; a trailing slash produces `wss://api.unilakekids.com//?sessionId=...` and the handshake fails.

> 🔴 **`NEXT_PUBLIC_*` values are baked into the JS bundle at build time.** Setting them now does nothing to an already-built deployment. **Redeploy after saving** (Deployments → ⋯ → Redeploy). Every future change to these needs a rebuild, not a restart.

---

# STEP 6 — Google OAuth

Google Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 Client ID.

**Authorized JavaScript origins** — add:
```
https://www.unilakekids.com
https://unilakekids.com
```

**Authorized redirect URIs** — add:
```
https://api.unilakekids.com/api/auth/callback/google
```

> 🔴 The redirect URI points at the **BACKEND** (`api.`), not the frontend. Better Auth handles the callback server-side. Putting the frontend URL here is the single most common go-live mistake.

Keep the existing `localhost` entries so local dev keeps working. Google can take a few minutes to propagate.

---

# STEP 7 — Facebook OAuth

developers.facebook.com → your App.

**Facebook Login → Settings → Valid OAuth Redirect URIs:**
```
https://api.unilakekids.com/api/auth/callback/facebook
```

**Settings → Basic:**
- **App Domains:** `unilakekids.com`
- **Site URL:** `https://www.unilakekids.com`
- **Privacy Policy URL:** required before the app can leave Development Mode

**Switch the app out of Development Mode.** Until you do, only accounts listed as app admins/testers can log in. This may need App Review — start it early if Facebook login matters at launch.

---

# STEP 8 — Razorpay webhook

Dashboard → **Settings → Webhooks** → Add New Webhook.

| Field | Value |
|---|---|
| **Webhook URL** | `https://api.unilakekids.com/api/webhooks/razorpay` |
| **Secret** | exactly what you set for `RAZORPAY_WEBHOOK_SECRET` in Step 4 |
| **Active Events** | ✅ `payment.captured` (required) ✅ `payment.failed` (recommended) |

Then **delete the old ngrok webhook** — it's dead and will just generate failure noise.

> ⚠️ **Test mode and Live mode have separate webhook lists.** Configuring one does not configure the other. If you're still on test keys, set up the test-mode webhook now and the live one when you switch keys.

> 🔴 A secret mismatch produces a silent `400` and **no state change**: the payment succeeds, the session sits at `AWAITING_PAYMENT` forever, and the frontend's verifying overlay times out with no clue why. Copy-paste the secret; don't retype it.

---

# STEP 9 — Cloudflare R2 CORS

The browser uploads files **directly** to R2 using presigned URLs, so R2 itself has to allow your domain. Do this for **BOTH** buckets:

- `unilake-public` — comic thumbnails, page artwork, hero images, team photos, review videos
- `unilake-private` — **the child's photo** and font files

Updating only one leaves half your uploads broken.

R2 → bucket → **Settings → CORS Policy**:

```json
[
  {
    "AllowedOrigins": [
      "https://www.unilakekids.com",
      "https://unilakekids.com",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedHeaders` **must** include `content-type` — the uploader sets it explicitly to match the signed content type, and the request fails preflight without it.

### Optional, but decide now: `R2_PUBLIC_URL_BASE`

If this is still an `*.r2.dev` URL, you may want `cdn.unilakekids.com` instead.

> 🔴 **This is a one-way door.** Every thumbnail, page artwork and generated image URL is stored in the database as a **full absolute URL**. Changing the base later leaves every existing row pointing at a dead host. Change it **before** real orders exist, or never.

---

# STEP 10 — Render service settings

Dashboard → your service → **Settings**.

| Setting | Value | Why |
|---|---|---|
| **Health Check Path** | `/health` | Returns a plain string, not JSON |
| **Instance Type** | ⚠️ **paid, not free** | See below |
| **Memory** | 2 GB | PDF compilation peaks at ~120 MB × 5 concurrent jobs |
| **Instances** | **exactly 1** — no autoscaling | See below |

### 🔴 Why the free tier will break this app

Render's free tier **spins the service down after ~15 minutes of inactivity.** Your BullMQ workers run *inside the web process*, so a spun-down service means:

- Queued generation jobs sit in Redis and nothing processes them
- The hourly session-expiry sweeper never runs
- The first request after idling takes 50+ seconds

Jobs aren't lost — they resume when something wakes the service — but a customer watching a progress bar will see nothing happen.

### 🔴 Why it must stay at one instance

WebSocket rooms are an in-memory `Map` and the photo cache is per-process. With two instances, a user connected to instance A never receives events emitted by instance B — live page updates silently stop working for roughly half your users. **Do not enable autoscaling.**

---

# STEP 11 — Verify, in this exact order

Each step isolates one failure mode. If a step fails, fix it before moving on.

### 1. Backend is alive
```
https://api.unilakekids.com/health
```
Expect: `App is working perfectly fine!`

### 2. CORS works
Open `https://www.unilakekids.com`, DevTools → **Network**.
The homepage calls `/api/public/comics`, `/api/public/hero-images`, etc.
Expect: **200**, with response header `access-control-allow-origin: https://www.unilakekids.com`.
❌ Fails → Step 1.1.

### 3. Login works
Sign in with Google.
Expect: redirect to Google → back to your site → logged in.
❌ `redirect_uri_mismatch` → Step 6.
❌ "untrusted origin" → Step 1.2.

### 4. The cookie is correct 🔴 the critical check
DevTools → **Application → Cookies**.

| Check | Expected |
|---|---|
| Name | `__Secure-better-auth.session_token` |
| Domain | `.unilakekids.com` ← **with the leading dot** |
| Secure | ✓ |
| HttpOnly | ✓ |

❌ Domain shows `api.unilakekids.com` (no dot) → Step 1.3 didn't take effect. Check `NODE_ENV=production` is actually set on Render.

### 5. The session persists
Hard-refresh the page. Still logged in?
❌ No → the cookie domain is wrong (step 4).

### 6. Protected routes work
Visit `/dashboard` while logged in.
Expect: the dashboard loads.
❌ Bounced to `/login` → Step 2.1 (cookie name), and confirm Vercel was **redeployed** after Step 5.

### 7. Photo upload works
Start a comic, upload a child's photo.
❌ CORS error on the R2 `PUT` → Step 9, specifically the **private** bucket.

### 8. Live generation works
Watch the preview pages appear.
- Pages appearing **without refreshing** → WebSocket is fine ✅
- Nothing appears, but refreshing shows the images → the socket failed. Check `NEXT_PUBLIC_AUTH_URL` has no trailing slash, and confirm `wss://api.unilakekids.com/?sessionId=...` in the Network → WS tab.

### 9. Payment works end to end
Run a checkout with a Razorpay **test** card first.
Render logs should show, in order:
```
Payment captured — Order + Session flipped to PAID
Paid-page generation enqueued after payment
```
❌ Neither line appears → the webhook isn't arriving → Step 8. Check Razorpay Dashboard → Webhooks → your webhook → **recent deliveries** for the actual response code.

### 10. The verifying screen resolves
After payment, the "Verifying your payment" overlay should disappear on its own within a few seconds and land you on the generation page.
❌ Times out after 90s → the webhook didn't land (step 9).

### 11. Test in Brave and Safari
Not just Chrome. Your cookie setup should be fine now that everything is first-party, but this is where you actually prove it.

---

# TROUBLESHOOTING — symptom → cause

| Symptom | Almost certainly |
|---|---|
| CORS error in console | Step 1.1 — origin not in the allow-list |
| `redirect_uri_mismatch` from Google | Step 6 — the URI must be the `api.` domain |
| Login succeeds, then logged out on refresh | Step 1.3 — cookie domain missing the leading dot, or `NODE_ENV` not `production` |
| `/dashboard` redirects to `/login` while logged in | Step 2.1 — the `__Secure-` cookie name |
| Frontend still calling `localhost:8080` | Step 5 — Vercel not redeployed after setting the env var |
| Photo upload fails, thumbnails upload fine | Step 9 — CORS missing on the **private** bucket |
| Payment succeeds, session stuck at `AWAITING_PAYMENT` | Step 8 — webhook URL or secret wrong |
| Pages only appear after a manual refresh | WebSocket down — check for a trailing slash in `NEXT_PUBLIC_AUTH_URL` |
| Everything works, then breaks after ~15 min idle | Step 10 — Render free tier spin-down |

---

# NOTES ON THE TWO EXTRA DOMAINS

Both of your platforms still serve a default URL alongside the custom domain.

**`unilake-frontend.vercel.app`** — public pages work, but **login will not**, because the session cookie is scoped to `.unilakekids.com`. Don't test auth here and don't share the link. Optionally remove it from the project's domain list once you're confident.

**`unilake-backend.onrender.com`** — still enabled ("Render Subdomain" toggle). Harmless to leave on, and handy for debugging if DNS ever misbehaves. But **never put it in any config value** — `BETTER_AUTH_URL`, `NEXT_PUBLIC_AUTH_URL`, OAuth redirect URIs and the Razorpay webhook must all use `api.unilakekids.com`. Consider disabling it once everything is verified, so there's exactly one canonical origin.

---

# STILL OUTSTANDING (not blocking launch)

- **LoRA file handling is not done** — deferred, to be figured out later.
- **Admin role is assigned manually in the database.** There is no UI. After your first production login, set your user's `role` to `ADMIN` directly in Neon or `/admin` stays inaccessible.
- **No rate limiting** on any public route, including `/checkout` and session creation. Known gap (feature #9).
- **Shiprocket is a stub.** Sessions reach `COMPLETED` without a real shipment being created.
- **`notifyUser` does not exist.** No emails are sent at any stage — not on generation complete, not on payment, not on send-to-print.

---

# REFERENCE — things that look like URLs but need no change

| Thing | Why |
|---|---|
| `src/websocket/wsServer.ts` — `new URL(req.url, "http://localhost")` | A parsing base for a relative URL. Never dialled. |
| `src/jobs/workers/sd/runpodClient.ts` — `https://api.runpod.ai/v2` | External API |
| `src/jobs/workers/sd/textStamp.ts` — `http://www.w3.org/2000/svg` | An XML namespace, not a URL |
| `next.config.ts` — `images.remotePatterns` | Already `hostname: "**"` |
| Neon / Upstash / RunPod connection strings | Environment-independent |
| `app/lib/websocket.ts` | Derives the WS URL from `NEXT_PUBLIC_AUTH_URL`; auto-upgrades `https` → `wss` |
| `sameSite` / `secure` in `auth.ts` | Already correct — no change needed for the subdomain setup |
