# CURRENT STATE

_Last updated: Aug 29, 2026 (Shiprocket integration sprint — sections 1–5 complete)_

> **Next Claude reading this:** Also attached — PROJECT_CONTEXT.md (architecture), DECISIONS.md (locked rules + never-do), SESSION_LOG.md (recent narrative), schema.prisma. This doc = "where are we right now." Read all four before responding.

## Status: DEPLOYED and running. Shiprocket integration built through Section 5 (worker + webhook). Not yet runtime-verified — full E2E test blocked on the client's GST activating their Shiprocket pickup address.

## DONE

### Live in production (since Aug 22)
- Backend on Render at `https://api.unilakekids.com`, frontend on Vercel at `https://www.unilakekids.com`
- Cookies first-party via `crossSubDomainCookies` on `.unilakekids.com`
- Checkout re-call dead end, `assertNotExpired` duplicate, webhook dedupe collision — all fixed and deployed
- Aug 24 s1: How It Works / FAQ / Blog CMS (20 endpoints, migration `20260823212030`), team-member `oldUrl !== newUrl` fix
- Aug 24 s2: glyph-outline text stamping (`textStamp.ts` + opentype.js), `Bubble.fontColor`, Redis migrated to Redis Cloud

### Built this session (Aug 29) — Shiprocket integration, sections 1–5, deployed, NOT runtime-tested end-to-end

**Section 1 — Config**
- Shiprocket account: API user created (client-owned email), pickup address "Home" registered (verified, activation blocked on client GST)
- Env vars added: `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION_NAME`, `SHIPROCKET_WEBHOOK_TOKEN`. Boot validation count 22 → 26
- Webhook URL saved in Shiprocket dashboard (`https://api.unilakekids.com/api/webhooks/shiprocket`, `x-api-key` auth type) — currently disabled, enable after deploy of Section 5 code

**Section 2 — Schema**
- Migration adds 12 fields to `Order`: `shiprocketShipmentId`, `courierId`, `finalLength/Breadth/Height/Weight`, `awbGeneratedAt`, `labelGeneratedAt`, `pickupScheduledDate`, `pickupGeneratedAt`, `shippedAt`, `deliveredAt`
- `OrderStatus` enum untouched (`READY_TO_SHIP` already covered the two-stage packaging flow)
- `src/config/shipping.ts` created — package defaults, dimension bounds, HSN code, `SHIPROCKET_STATUS_MAP`

**Section 3 — Client module**
- `src/lib/systemConfig.ts` — `getSystemConfig` / `setSystemConfig` over the SystemConfig table (first users)
- `src/lib/shiprocket.ts` — full Shiprocket client. Base fetch wrapper with retry policy matching runpodClient, auth-token lifecycle backed by SystemConfig (10-day token, refresh 12h early, shared across processes). Nine public functions: `createOrder`, `updateOrder`, `assignAwb`, `generatePickup`, `generateLabel`, `generateManifest`, `printManifest`, `trackByAwb`, `cancelOrder`. Handles 204 No Content, soft-fail responses, and Shiprocket's inconsistent date formats

**Section 4 — Worker + service**
- `src/services/shiprocket.service.ts` — sole business-logic layer
  - `createShipmentForSession(orderSessionId)` — Phase A, called by worker
  - `pushDimensionsAssignAwbAndSchedulePickup(orderId, dimensions)` — Phase B, called inline from admin endpoint (Section 7)
- `src/jobs/workers/shiprocketWorker.ts` — thin wrapper mirroring pdfWorker. Final-failure handler flips `Order.status = SHIPROCKET_FAILED` / `OrderSession.status = SHIPMENT_FAILED` on retry exhaustion, with status guards

**Section 5 — Webhook**
- `POST /api/webhooks/shiprocket` route mounted (raw-body middleware inherited from existing `/api/webhooks/*` prefix)
- `handleShiprocketWebhook` in webhook.service.ts — token verify against `SHIPROCKET_WEBHOOK_TOKEN`, dedup via `WebhookEvent` with synthesized key (`shiprocket:awb:statusId:timestamp`), delegates to service
- `processShiprocketStatusUpdate` in shiprocket.service.ts — always writes `trackingStatus` + `trackingUpdatedAt`; conditionally flips `Order.status` via `SHIPROCKET_STATUS_MAP` + `WEBHOOK_ALLOWED_TRANSITIONS` guards; sets `shippedAt` / `deliveredAt` on first transition
- Three TODO stubs added for `notifyUser` (on SHIPPED, DELIVERED) and `notifyAdmin` (on SHIPROCKET_FAILED)

## IN PROGRESS
Nothing.

## NEXT (priority order)

1. **🔴 Commit and push Sections 1–5.** Combined commit message drafted at end of session — 6 files touched (`env.ts`, `shipping.ts`, `systemConfig.ts`, `shiprocket.ts`, `shiprocket.service.ts`, `shiprocketWorker.ts`, `webhook.service.ts`, `webhook.controller.ts`, `webhooks.ts`, migration). Don't lose two sessions of work.
2. **🔴 Check for payments stranded during the Aug 24 Redis outage (~15 min).** Query `order_sessions` for `PAID`/`GENERATING_PAID` and `orders` for `PAID`. `PAID` is not in `REGENERATABLE_STATUSES`, so any row that landed mid-outage needs manual repair. Older every day it waits.
3. **Section 6 — user-facing tracking endpoint (~30 min – 1 h).** `GET /api/user/orders/:orderId/tracking`, auth-guarded, returns `Order.status` + mapped label + courier name.
4. **Section 7 — admin endpoints (~4–6 h).** Eight endpoints: list, detail, confirm-dimensions (triggers Phase B), retry-shiprocket, cancel-shipment, print-label, refresh-tracking, SHIPROCKET_FAILED queue.
5. **Section 8 — Zod validators + cleanup pass (~1–2 h).** Request schemas for all Section 6 & 7 endpoints, response type definitions.
6. **Runtime-verify the font fix on a real generation (~30 min).** Still pending from Aug 24 s2. Everything unit + pixel verified, no real page has been generated since the rewrite. Confirm dialogue appears in the comic's actual uploaded font.
7. **End-to-end payment verification (~1 h).** Confirm the log sequence: `payment.authorized` ignored → `Payment captured` → `Paid-page generation enqueued`.
8. **Paid-page generation first run (~1–2 h).** Never executed. RunPod round-trips, `maybeMarkPaidReady`, `session:paid-ready` over `wss://`.
9. **Apidog pass on the three CMS modules (~1–2 h).** All 20 endpoints unverified beyond typecheck.
10. **Section 9 — full Shiprocket E2E in sandbox (~2–3 h).** Blocked on client's GST activating the pickup address. Auth flow, createOrder → assignAwb → generatePickup, label/manifest, webhook receiving a real status.
11. **Section 10 — Shiprocket production cutover (~1 h).** Enable webhook in Shiprocket dashboard, monitor first real shipment.
12. **Feature #5 `notifyUser` (~3–4 h with email provider setup).** Now FIVE TODO call sites (Section 5 added two: SHIPPED, DELIVERED). Pick provider, set up domain + sender verify, wire.
13. **Rate limiting (~1–2 h).** Nothing throttles `/checkout`, session creation, or `POST /feedbacks`.
14. **Add `PAID` to `REGENERATABLE_STATUSES`, or give the webhook enqueue a real recovery path (~1 h).** Aug 24 outage turned this theoretical gap into a live one.
15. **PDF regeneration for `PDF_FAILED` (~2–3 h).** No admin re-trigger path designed.
16. **Trim idle worker polling (~30 min).** Raise `drainDelay` 5s→60s, `stalledInterval` 30s→300s. No longer load-bearing on Redis Cloud, ~60k commands/day of pure noise remains.

## OPEN QUESTIONS

- **Client GST status?** Blocks pickup activation → blocks all Shiprocket runtime testing (Section 9). Everything else in Sections 6–8 unblocked.
- **International shipping in launch scope, or Phase 2?** Not built. Adding later is a ~6–10h additive branch (schema fields already anticipate it via `isInternational`); requires client IEC + AD Code + Shiprocket International account (3–6 weeks of client-side paperwork).
- **Does the Redis Cloud plan have connection or throughput limits worth knowing?** Command-quota issue gone; per-plan ceilings (max connections in particular) not verified.
- **Is the Render instance paid or free?** Unanswered since Aug 22. Free spins down after ~15 min and takes workers + sweeper with it.
- **Font weight** — client conversation still pending. Weight *slider* = synthetic bold (visibly fake); "upload bold as second font" already works with zero code.
- **Font upload validator: reject WOFF2?** Renderer cannot parse it; currently fails at generation time.
- **How It Works editable headline?** `title`/`subtitle` columns + migration if yes.
- **Hindi blog content?** Slugs strip non-Latin, fall back to `post`, `post-2`.

## VERIFY / LOOSE ENDS

### 🔴 Immediate
- **Both repos have large uncommitted trees** — Aug 24 s1 CMS + Aug 24 s2 font/color + this session's Shiprocket work. Push before anything else. One bad `git reset` and three sessions are gone.
- **`RAZORPAY_WEBHOOK_SECRET` still needs rotating** — outstanding since Aug 22, exposed in a screenshot.
- **Rotate the Redis Cloud password** — the full `REDIS_URL` including credentials was pasted into a chat transcript on Aug 24. Change in Redis Cloud, then update `.env` **and** Render.
- **`REDIS_URL` lives in two places** — local `.env` and Render env vars. Any future change must be applied to both.
- **Confirm `NODE_ENV=production` on Render.** `crossSubDomainCookies` and `secure` cookies both gate on it.

### 🔴 Never runtime-verified
- Entire Shiprocket integration end-to-end (blocked on GST): worker Phase A, webhook receiving real status, service state flips
- The glyph-outline renderer against a real comic font on a real generation
- `Bubble.fontColor` end to end through admin UI (save → hard-refresh → generate)
- Paid-page generation, `maybeMarkPaidReady`, `session:paid-ready`
- Send-to-print (real and irreversible — do not call casually)
- PDF compilation, PDF worker retry-then-`PDF_FAILED`
- Post-payment field lock (Bug 6), paid session surviving past 24 h (Bug 1)
- WebSocket over `wss://` through Cloudflare → Render
- All 20 CMS endpoints with an admin session

### 🟡 Known open items (deferred, not forgotten)
- **Manifest generation deferred to Shiprocket dashboard.** `generateManifest` + `printManifest` exist in the backend but no admin UI. Revisit if switching contexts becomes friction.
- **Shiprocket order cancellation has backend but no frontend.** Admin uses backend endpoint (Section 7) or Shiprocket dashboard directly.
- **`Order.status` transition to `CONFIRMED` is not explicit anywhere.** Send-to-print path only flips OrderSession; Order.status is probably still `GENERATED` when the Shiprocket worker runs. Phase A idempotency accepts both — fine, but worth documenting the actual observed state.
- **PAID recovery gap** — when Redis is down during `payment.captured`, session flips to `PAID` but no jobs enqueue. Razorpay's own retries cover most cases. Revisit before launch.
- Existing bubbles with no font assigned will now FAIL generation instead of rendering blank. Worth an audit query.
- Frontend has no send-to-print UI, no variant-selection screen. A customer who pays today still cannot finish their order.
- Frontend bugs #4–#7 from Aug 22 still open.
- Neon cold-start 500s — first DB query in a fresh process can fail with an empty `ErrorEvent`. Not diagnosed.
- **Helmet ordering** — still runs above the Better Auth handler, reversing a documented decision.
- **`winston`** still in `dependencies`, imported by nothing.
- **No typecheck in CI.** `tsc --noEmit` passes clean; should be a pipeline step.
- `app.set("trust proxy", 1)` trusts one hop; Cloudflare + Render is arguably two. Matters once rate limiting lands.
- Blog `tags` not deduplicated. No `.max()` on FAQ `question`/`answer`.

## AUDIT REFERENCES
- `CODE_VS_DOCS_AUDIT.md` — frozen Aug 11, 125 items. Not re-audited since.
- `production.md` — go-live runbook, current as of Aug 22.
- `REVIEWS_TEAM_FEEDBACK_API.md`, `HOWITWORKS_FAQ_BLOG_API.md` — frontend handoffs, current as of Aug 24.