# CURRENT STATE

_Last updated: Aug 21, 2026 (end of session)_

> **Next Claude reading this:** Also attached — PROJECT_CONTEXT.md (architecture), DECISIONS.md (locked rules + never-do), SESSION_LOG.md (recent narrative), schema.prisma. This doc = "where are we right now." Read all four before responding.

## Status: Post-payment pipeline structurally complete end-to-end (stubbed Shiprocket)

## DONE

### Bug fixes closed this session
- Bug 1 — Paid sessions no longer destroyed at 24h expiry (`EXPIRY_EXEMPT_STATUSES` exclusion added to sweeper + both `assertNotExpired` copies + `isExpired` computation in GET)
- Bug 2 — Order endpoints now query `coverThumbnailUrls` (was querying non-existent `coverImageUrl`)
- Bug 3 — Stranded PAID recovery via Razorpay retry (webhook cleans up `WebhookEvent` row + re-throws so Razorpay retries; idempotency check refined to allow retry when Session still at PAID)
- Bug 4 — `checkoutParamsSchema` wired into checkout controller via `safeParse` + `ValidationError`
- Bug 6 — Post-payment field lock on `updateOrderSession` (locks 12 fields when session is at AWAITING_PAYMENT or post-payment status; only `notificationEmail` remains editable)

### Features shipped this session
- **Feature #1 — `maybeMarkPaidReady`** — paid-page completion detector mirrored from preview helper. Flips session `GENERATING_PAID → PAID_PAGES_READY` and Order `PAID → GENERATED`. Wired into both success and failure paths of the generation worker. `emitSessionPaidReady` added to WebSocket events.
- **Feature #2 — Send-to-print endpoint** — `POST /api/user/sessions/:sessionId/send-to-print`. Full flow: guards → in-flight check → per-selection validation → atomic transaction (mark isSelected + flip Session + flip Order) → enqueue PDF compilation with `jobId: sessionId` for BullMQ dedupe. Idempotent (safe to re-hit at CONFIRMED).
- **Feature #3 — PDF compilation (real)** — replaced `pdfWorker.ts` stub with real implementation. `compilePdfForSession` service function downloads selected variants from R2, converts PNG→JPEG@85% via sharp, embeds via pdf-lib sized to source dimensions, uploads to R2 public bucket at `pdfs/{sessionId}.pdf`, updates Order URLs, flips session to SHIPMENT_QUEUED, enqueues Shiprocket. Failure handler flips to PDF_FAILED only after all BullMQ retries exhausted.
- **Stub Shiprocket worker** — created for pipeline continuity. Listens on `shiprocket` queue, flips session `SHIPMENT_QUEUED → COMPLETED`. Feature #4 replaces the body.

### State machine updates (schema migration applied)
Added enum values: `PDF_FAILED`, `SHIPMENT_QUEUED`, `SHIPMENT_FAILED`.
Removed: `DISPATCHED` (no longer used in new flow).
Full post-CONFIRMED chain:

CONFIRMED → COMPILING_PDF ─┬→ PDF_FAILED (terminal, admin retry)
└→ SHIPMENT_QUEUED ─┬→ SHIPMENT_FAILED (terminal)
└→ COMPLETED (session done; Order carries post-handoff state)


## IN PROGRESS
Nothing.

## NEXT (priority order)

1. **Feature #4 — Real Shiprocket integration** (~10–14h)
   Replace stub worker with real API integration. Create shipment, save `shiprocketOrderId`, handle AWB assignment webhook, delivery status updates, `SHIPROCKET_FAILED` path. Must flip Order status (currently stays at CONFIRMED — stub never touches Order).

2. **Feature #11 — End-to-end payment test** (~1–2h)
   ngrok + real Razorpay test payment. Only worth doing after #4 so the full pipeline is real.

3. **Feature #5 — Customer notification (`notifyUser`)** (~1–2h)
   Currently a TODO comment in generationWorker success/failure paths (feature #1). Also needed for send-to-print / shipment stages.

4. **Feature #6 — Admin order endpoints** (~4–6h)
   List orders, view single, retry Shiprocket, mark shipped manually, view SHIPROCKET_FAILED queue.

5. **Feature #7 — Admin catalog endpoints** (~2–3h)
   Comics (upload template, activate/deactivate), pricing rules, Country.isActive toggle. Bug 7 lives here.

6. **Feature #8 — Admin auth** (~2–4h)
   Role check middleware on admin routes.

7. **Feature #9 — Rate limiting** (~1–2h)
   `express-rate-limit` on `/checkout`, `/sessions/create`, photo upload, regenerate, webhook. Bug 5 lives here.

8. **Feature #10 — Structured observability** (~2–3h)
   Better logging on payment failures, webhook retries, Shiprocket failures, job failures.

9. **Feature #12 — Verify Cloud Run keeps sweeper running** (~30min)
   Requires "CPU always allocated" config. If not set, sweeper dies.

## OPEN QUESTIONS
- Cloud Run instance size: agreed to bump to 2 GB for PDF worker memory headroom. Config change not yet applied — needs to happen before production traffic hits `compilePdfForSession`.
- PDF regeneration endpoint: how does admin re-trigger a PDF_FAILED session? Not designed yet. Deferrable to admin work (feature #6/7).

## VERIFY / LOOSE ENDS

### 🔴 Payment + send-to-print + PDF flow — never seen a real end-to-end run
Nothing built this session has been runtime-verified. All work was typecheck + boot verification only. First real verification should happen once Feature #4 lands. Specific things to hit:
- Checkout → Razorpay modal → payment.captured webhook → PAID → GENERATING_PAID
- Duplicate webhook (P2002 path)
- Wrong signature returns 400 (only missing-signature was tested previously)
- Idempotent checkout re-call
- Delayed webhook (>30s)
- payment.failed logs + no state change
- `maybeMarkPaidReady` fires correctly when last paid page succeeds AND when last page fails but earlier pages covered
- Send-to-print rejects if any page is in-flight
- Send-to-print rejects if selection count ≠ pageCount
- Send-to-print rejects if selected variant is FAILED
- Send-to-print idempotent retry (call twice, both return success, PDF job enqueued once via `jobId` dedupe)
- Post-payment field lock (Bug 6) — try editing childName after payment, expect 409
- Paid session not killed at 24h (Bug 1) — set expiresAt to past, hit any endpoint, session should survive
- `coverThumbnailUrls` returned correctly from `/api/user/orders` (Bug 2)
- PDF compile end-to-end — real images from R2, real upload, real download link works
- PDF worker retries on transient failure (kill R2 briefly during compile, confirm 3 retries then PDF_FAILED)
- Stub Shiprocket flips session to COMPLETED

### 🟡 Not yet built but referenced
- `notifyUser` — TODO comments in generationWorker (feature #1) + will need one at send-to-print + will need one at COMPLETED
- Admin retry endpoint for PDF_FAILED and SHIPMENT_FAILED sessions

### 🟡 Config / deployment
- Cloud Run RAM bump to 2 GB (agreed, not applied)
- Cloud Run "CPU always allocated" for the sweeper (unverified from pre-session)

## KNOWN OPEN ITEMS (deferred, not forgotten)
- **Bug 5** — no rate limiting on `/checkout` and public routes. Deferred to feature #9 batched pass.
- **Bug 7** — no admin endpoint for `Country.isActive` toggle. Deferred to feature #7 admin catalog batch. India is the only active country in DB; nothing breaks until international rollout.
- **Duplicated `assertNotExpired`** — kept in both `session.service.ts` and `checkout.service.ts` per prior decision (leave until a third caller appears). Third caller has not appeared.
- **`Order.pdfDownloadExpiry`** — schema field kept but now always null (public bucket = no expiry). Kept in case client changes mind and wants signed URLs.

## AUDIT REFERENCES
- `CODE_VS_DOCS_AUDIT.md` — frozen Aug 11, 125 items. Not re-audited this session.