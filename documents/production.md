# Production Go-Live — URL Change Checklist

**Target:** backend on **Render**, frontend on **Vercel**.
Compiled by sweeping both codebases for every hardcoded URL, env-derived URL, and browser-facing origin.

Placeholders used below:

| Placeholder | Meaning |
|---|---|
| `<BACKEND>` | e.g. `https://unilake-backend.onrender.com` or `https://api.unilake.com` |
| `<FRONTEND>` | e.g. `https://unilake.vercel.app` or `https://unilake.com` |

---

## 0. ⚠️ DECIDE THIS BEFORE ANYTHING ELSE — the cookie domain strategy

Locally the frontend is `localhost:3000` and the backend `localhost:8080`. **Cookies ignore port numbers**, so Better Auth's session cookie set on `localhost` is sent to both. That is the *only* reason auth works today.

On `*.vercel.app` + `*.onrender.com` these are two different registrable domains (both on the Public Suffix List). Two things break:

1. **The session cookie is never sent to the Vercel origin.** `proxy.ts` reads the cookie in Next middleware, which runs on Vercel and only sees Vercel's own cookies. Every protected route will redirect to `/login` even for a signed-in user.
2. **All API calls become third-party cookie requests.** `sameSite: "none"; secure: true` allows this in spec, but Brave blocks third-party cookies by default, Safari ITP blocks them, and Chrome is phasing them out. Login appears to succeed then doesn't persist.

### ✅ Recommended: one registrable domain, two subdomains

```
unilake.com       → Vercel   (frontend)
api.unilake.com   → Render   (backend)
```

Everything becomes first-party. Then enable the block already stubbed in `src/lib/auth.ts`:

```ts
advanced: {
  defaultCookieAttributes: {
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    httpOnly: true,
  },
  crossSubDomainCookies: isProd
    ? { enabled: true, domain: ".unilake.com" }   // leading dot = all subdomains
    : { enabled: false },
}
```

Both Render and Vercel support custom domains on their free tiers. Do this before launch, not after.

### ⚠️ If shipping on raw `.vercel.app` + `.onrender.com` first

- Do **not** enable `crossSubDomainCookies` — you cannot set a cookie on `.vercel.app` (public suffix); the browser rejects it.
- `proxy.ts` must stop gating on the cookie (see §3.3) — it will never see one.
- Expect auth to fail in Brave/Safari. Acceptable for a smoke test, not for real customers.

---

## 1. 🔴 The cookie NAME changes in production

Better Auth `1.6.20` sets `useSecureCookies` to `true` automatically when the base URL protocol is `https`, and secure cookies receive a `__Secure-` prefix.
*(Verified in `node_modules/better-auth/dist/cookies/index.mjs`.)*

| Environment | Session cookie name |
|---|---|
| Local (`http://localhost:8080`) | `better-auth.session_token` |
| Production (`https://…`) | `__Secure-better-auth.session_token` |

`frontend/proxy.ts` hardcodes the unprefixed name. It must accept both — see §3.3.

---

## 2. BACKEND — code changes

### 2.1 `src/app.ts` — CORS origin 🔴 blocking

Currently hardcoded to a single local origin:

```ts
app.use(cors({ origin: "http://localhost:3000", ... }));
```

Must become an allow-list including the production frontend. Note the commented-out array at lines 23-27 — that was the intent.

**Also plan for Vercel preview deployments**, which get a new random URL per branch (`unilake-git-xyz-team.vercel.app`). A static array will fail CORS on every preview. Either use a function origin matching `/\.vercel\.app$/`, or accept that previews can't call the API.

Keep `credentials: true` and keep `PATCH` in `methods` — the session flow depends on both.

### 2.2 `src/lib/auth.ts` — `trustedOrigins` 🔴 blocking

```ts
trustedOrigins: [
  "http://localhost:3000",   // ← keep for local dev
  "<FRONTEND>",              // ← add
],
```

Better Auth rejects OAuth callbacks and sign-in requests from origins not on this list. **This is separate from CORS — updating one and not the other produces a confusing half-working state.**

### 2.3 `src/lib/auth.ts` — `crossSubDomainCookies`

Uncomment and set the real domain — only if you took the subdomain route in §0.

---

## 3. FRONTEND — code changes

### 3.1 `next.config.ts` — the hardcoded fallback 🔴 dangerous

```ts
destination: `${process.env.NEXT_PUBLIC_AUTH_URL || "https://unilake-backend-590672762351.asia-south1.run.app"}/api/auth/:path*`
```

That fallback is the **old Cloud Run backend**. If `NEXT_PUBLIC_AUTH_URL` is ever missing at build time, production silently proxies auth to a dead/stale service with no error. Replace the fallback with the real backend URL, or drop the fallback so a missing env var fails loudly.

### 3.2 `NEXT_PUBLIC_*` is baked in at BUILD time 🔴

Next.js inlines `NEXT_PUBLIC_` variables into the client bundle during `next build`. Setting `NEXT_PUBLIC_AUTH_URL` in Vercel **after** a build does nothing until you **redeploy**. Every URL change on the frontend needs a rebuild, not a restart.

Files that read it — all correct, nothing to change, but all break together if it's wrong:

| File | Uses it for |
|---|---|
| `app/lib/axios.ts` | REST `baseURL` |
| `app/lib/auth-client.ts` | Better Auth client `baseURL` |
| `app/lib/websocket.ts` | derives `wss://` host — auto-upgrades from `https` |
| `app/actions/heroimage/index.ts` | a bare `fetch` for public hero images |
| `next.config.ts` | the `/api/auth/*` rewrite |

### 3.3 `proxy.ts` — the cookie gate 🔴 blocking

Three problems, all in this one file:

1. **Cookie name** — hardcodes `better-auth.session_token`; production uses `__Secure-better-auth.session_token` (§1). Check both.
2. **Cross-domain** — on split domains the middleware never sees the cookie at all. If you are not on shared subdomains, remove the cookie gate and let the page-level `useAuth` handle redirects.
3. **`user_role` cookie is never set by the backend.** `PROTECTED_ADMIN_ROUTES` is currently `[]` so nothing depends on it today, but if you ever populate that array, every admin will be redirected away. Gate `/admin` server-side instead.

---

## 4. BACKEND — environment variables on Render

| Variable | Change? | Value / note |
|---|---|---|
| `BETTER_AUTH_URL` | ✅ **Yes** | `<BACKEND>` — must be the **backend's own** public URL, not the frontend's. Drives the OAuth callback base *and* the `__Secure-` prefix. |
| `NODE_ENV` | ✅ **Yes** | `production` — flips cookies to `sameSite=none; secure=true`. Without it, cross-site auth cannot work at all. |
| `PORT` | ⚠️ | Render injects this automatically. `env.ts` hard-exits if it's missing, so leave it unset in the dashboard and let Render provide it. |
| `R2_PUBLIC_URL_BASE` | ⚠️ Maybe | If still on an `*.r2.dev` dev URL, move to a custom domain (`cdn.unilake.com`). **Changing it breaks every URL already stored in the DB** — those rows hold full absolute URLs. Decide before real orders exist. |
| `RAZORPAY_KEY_ID` / `KEY_SECRET` | ✅ **Yes** | Swap test → **live** keys when going truly live |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ **Yes** | New secret for the production webhook (§6.3) |
| `DATABASE_URL` / `DIRECT_URL` | ❌ No | Neon URL is environment-independent |
| `REDIS_URL` | ❌ No | Upstash URL unchanged |
| `R2_ACCOUNT_ID`, `R2_*_BUCKET_NAME`, `R2_ENDPOINT`, keys | ❌ No | Account-level, not environment-level |
| `RUNPOD_ENDPOINT_ID` / `RUNPOD_API_KEY` | ❌ No | External API |
| `GOOGLE_CLIENT_ID` / `SECRET`, `FACEBOOK_*` | ❌ No | Same app — only the *redirect URIs in their dashboards* change (§6.1, §6.2) |
| `BETTER_AUTH_SECRET` | ❌ No | But generate a **different** secret for prod than dev |

> 🔴 **No quotes around any value.** `dotenv` strips them locally; Render does not. A quoted URL becomes `%22https://...%22` and fails opaquely.

---

## 5. FRONTEND — environment variables on Vercel

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_AUTH_URL` | `<BACKEND>` — **no trailing slash** (`websocket.ts` strips the protocol by regex and a trailing slash yields a `//` path) |
| `NEXT_PUBLIC_APP_ENV` | `production` |

Set these for **Production**, **Preview**, and **Development** scopes as appropriate, then **redeploy** (§3.2).

---

## 6. EXTERNAL DASHBOARDS

### 6.1 Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client

| Field | Add |
|---|---|
| **Authorized JavaScript origins** | `<FRONTEND>` |
| **Authorized redirect URIs** | `<BACKEND>/api/auth/callback/google` |

> 🔴 The redirect URI points at the **BACKEND**, not the frontend. Better Auth handles the callback server-side at `/api/auth/callback/:provider`. This is the single most common go-live mistake.

Keep the localhost entries so local dev keeps working. Changes can take a few minutes to propagate.

### 6.2 Facebook for Developers → your App → Facebook Login → Settings

| Field | Value |
|---|---|
| **Valid OAuth Redirect URIs** | `<BACKEND>/api/auth/callback/facebook` |
| **App Domains** (Basic Settings) | backend + frontend domains |
| **Site URL** | `<FRONTEND>` |

Facebook also requires the app to be **switched out of Development Mode** and to have a **privacy-policy URL** before non-admin users can log in. Plan for review time.

### 6.3 Razorpay Dashboard → Settings → Webhooks

| Field | Value |
|---|---|
| **Webhook URL** | `<BACKEND>/api/webhooks/razorpay` |
| **Secret** | must match `RAZORPAY_WEBHOOK_SECRET` on Render, byte-for-byte |
| **Active Events** | `payment.captured` (required), `payment.failed` (recommended) |

Delete or disable the old ngrok webhook. Note that **test-mode and live-mode webhooks are configured separately** — setting one does not set the other.

> A secret mismatch produces a silent `400` and **no state change**: payment succeeds, the session sits at `AWAITING_PAYMENT` forever, and the frontend's verifying overlay times out with no clue why.

### 6.4 Cloudflare R2 → **both** buckets → Settings → CORS Policy

The browser PUTs files directly to presigned R2 URLs (`app/lib/r2-upload.ts`), so R2 itself must allow the Vercel origin.

Update **`unilake-public`** *and* **`unilake-private`** — the child's photo and fonts go to the private bucket, comic thumbnails / page artwork / hero images / team photos / review videos to the public one. Updating only one leaves half the uploads broken.

```json
[
  {
    "AllowedOrigins": ["<FRONTEND>", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedHeaders` must include `content-type` — the uploader sets it explicitly to match the signed content type.

### 6.5 Render service settings

- **Health check path:** `/health` (returns a plain string, not JSON)
- **Instance type:** ⚠️ the **free tier spins down after ~15 minutes of inactivity**. That kills the in-process BullMQ workers *and* the hourly expiry sweeper, and adds a 50s+ cold start on the first request. Generation jobs enqueued to Redis survive, but nothing processes them until a request wakes the service. **Use a paid instance**, or accept broken background processing.
- **RAM:** PDF compilation runs at worker concurrency 5 with ~120 MB peak per job. 512 MB is not enough — budget 2 GB.
- **Single instance only.** WebSocket rooms are an in-memory `Map` and the photo cache is per-process. Scaling past one instance silently breaks live page updates. Do not enable autoscaling.

---

## 7. NO CHANGE NEEDED — don't waste time here

| Thing | Why |
|---|---|
| `src/websocket/wsServer.ts` — `new URL(req.url, "http://localhost")` | A parsing base for a relative URL. Never dialled. Leave it. |
| `src/jobs/workers/sd/runpodClient.ts` — `https://api.runpod.ai/v2` | External API endpoint |
| `textStamp.ts` — `http://www.w3.org/2000/svg` | An XML namespace identifier, not a URL |
| `next.config.ts` — `images.remotePatterns` | Already `hostname: "**"` |
| Neon / Upstash / RunPod URLs | Environment-independent |
| WebSocket URL in `app/lib/websocket.ts` | Derived from `NEXT_PUBLIC_AUTH_URL`; auto-upgrades `https` → `wss` |

---

## 8. POST-DEPLOY VERIFICATION — in this order

1. `GET <BACKEND>/health` → `"App is working perfectly fine!"`
2. Open `<FRONTEND>`, DevTools → Network. Confirm public calls (`/api/public/comics`) return 200 with `access-control-allow-origin: <FRONTEND>`. A CORS failure here = §2.1.
3. Log in with Google. Confirm the callback lands and **check Application → Cookies for `__Secure-better-auth.session_token`** on the expected domain. Missing = §0/§1.
4. Reload the page. Still logged in? If not, third-party cookies are being blocked → §0.
5. Create a session, upload a photo. An upload failure = §6.4 (R2 CORS on the **private** bucket).
6. Watch preview generation. Pages arriving live = WebSocket is fine. Nothing arriving but a refresh shows images = the socket failed; check `wss://` and Render's WebSocket support.
7. Run a real checkout with a **live** Razorpay key and a small amount. Confirm the backend logs `"Payment captured — Order + Session flipped to PAID"` then `"Paid-page generation enqueued after payment"`. Missing = §6.3.
8. Confirm the session advances `AWAITING_PAYMENT → PAID → GENERATING_PAID` without a manual refresh.
9. **Test in Brave or Safari**, not just Chrome. That is where the cookie strategy actually gets validated.

---

## 9. STILL OUTSTANDING (carried over)

- **LoRA file handling is not done** — deferred, to be figured out later.
- Admin role is assigned **manually in the DB**; there is no UI. Remember to promote the production admin user after first login.
- There is **no rate limiting** on any public route, including `/checkout`. Known gap (feature #9).
