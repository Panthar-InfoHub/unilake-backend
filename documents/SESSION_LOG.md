# Unilake Backend — Session Log

**Rules:** Last 2 sessions in full detail. Older sessions collapsed to one-liners. Anything worth keeping long-term should already be in `PROJECT_CONTEXT.md`, `DECISIONS.md`, or `CURRENT_STATE.md` — the log is for narrative memory, not source of truth.

---

## Session — August 21, 2026 — Five-bug sprint + three features shipped (paid-page completion, send-to-print, PDF compilation)

**Triggered by:** Guts opened the session intending to verify what was built on August 19. The first-message summary asked for "where does the project stand" and included flagging the P1 data-loss bug from that session. Verification never happened — the session pivoted immediately into a defect+feature sprint once the scope of the open items became clear. The July 24 pattern of "audit then fix in the same session" repeated.

### Two distinct phases

The whole session ran as one continuous build-and-verify loop with no separate phases, but two mental clusters:

**Cluster A — the five defects.** Bugs 1, 2, 3, 4, 6 from the August 19 open list, worked in that priority order. Bug 5 (rate limiting) and Bug 7 (Country toggle) were deliberately deferred with recorded reasons.

**Cluster B — the three next features.** `maybeMarkPaidReady`, send-to-print, PDF compilation with pdf-lib. All three landed. Shiprocket stayed a stub deliberately.

The two clusters shared a common working shape: analyze → get user's confirmation on design decisions → produce exact edits → verify via typecheck + boot. **No runtime testing was done.** Guts made this an explicit policy for the session — full end-to-end verification waits until after feature #4 (real Shiprocket) so the pipeline is real, not stubbed.

### Decisions locked

Full detail lives in `DECISIONS.md` under the Aug 21 additions. The load-bearing ones:

**Paid sessions are exempt from expiry.** `EXPIRY_EXEMPT_STATUSES` = `AWAITING_PAYMENT` + `POST_PAYMENT_STATUSES`. Checked in four places: both `assertNotExpired` copies, the sweeper, and the `isExpired` computation in `getOrderSessionId`. Abandoned `AWAITING_PAYMENT` sessions living forever is an accepted tradeoff — killing a session mid-payment (when the customer takes >24h from session-create to complete Razorpay) was strictly worse. Cleanup for abandoned checkouts is a separate concern with different rules.

**Razorpay webhook enqueue failures re-throw, not swallow.** The Aug 19 "PAID is regeneratable per DECISIONS" comment turned out to be false — `PAID` was never in `REGENERATABLE_STATUSES`. Considered adding it; rejected because `regeneratePage` is per-page and 14 stranded pages meant 14 button clicks. Instead: controller returns 500, Razorpay retries. Before re-throwing, delete the `WebhookEvent` row so P2002 dedupe doesn't block the retry. Two-layer idempotency (event row + Order/Session status) prevents double-processing. Refined the business-layer check to let a retry through when `Order.status = PAID` but `Session.status = PAID` — that shape means the prior attempt flipped Order but the enqueue failed, and the retry needs to re-run the enqueue.

**Post-payment PATCH lock covers 12 fields.** `updateOrderSession` at `AWAITING_PAYMENT` or later rejects `childName`, `age`, `pronounKey`, `coverType`, and all eight shipping fields. Only `notificationEmail` remains editable. The original bug description (audit 8.3) named only `childName` and `pronounKey`; expanded scope because the same "silently desyncs from what shipped" problem applies to every field baked into images or snapshotted onto Order. Silent PATCH acceptance was worse than blocking — customer thinks their edit landed, DB says one thing, printed image says another.

**Send-to-print carries selections for every page.** Not just paid pages. Guts explicitly walked through the UX: after payment the customer lands back on the same review screen with paid pages added, can still regenerate preview variants, and picks favorites across all pages before hitting Send-to-print. Server does not auto-select anything. My first design proposed auto-selecting preview variants server-side (Option B) — this was wrong for the UX and got pivoted before any code was written.

**Send-to-print rejects if any PageVersion for the session is non-terminal**, not just the selected ones. If page 5 is mid-regenerating, the endpoint 409s naming page 5. Alternative — allow send-to-print as long as the selected variants are `SD_READY` — was considered and rejected because it made state hard to reason about (in-flight jobs pointlessly complete against a locked session).

**Send-to-print is idempotent.** Second call at `CONFIRMED` re-enqueues the PDF job with `jobId: sessionId` (BullMQ dedupe) and returns success. No status change on retry. This was the cleanest way to handle "DB transaction committed → PDF enqueue failed → customer retries." Alternatives considered: (a) rollback the transaction if enqueue fails via compensating update (fragile), (b) enqueue-first-then-commit (breaks Redis-outside-transaction rule). Idempotent retry beat both.

**Session state machine post-CONFIRMED has explicit failure branches.** Guts explicitly proposed collapsing all post-shipment states into `COMPLETED`. I pushed back — losing the distinction between "PDF done, waiting for shipment queue" and "shipment picked up by courier" means the PDF worker and Shiprocket worker would flip to the same state and race each other. Landed on:

CONFIRMED → COMPILING_PDF ─┬→ PDF_FAILED
└→ SHIPMENT_QUEUED ─┬→ SHIPMENT_FAILED
└→ COMPLETED


Session `COMPLETED` = courier handoff. Post-handoff state (in-transit, delivered) lives on `Order`, not session. Session and Order don't move in lockstep past this point. Naming: I initially proposed `SHIPMENT_QUEUED → IN_TRANSIT → COMPLETED`; Guts preferred the two-state version because it cleanly maps "session's responsibility ends at handoff, Order carries the rest." Went with Guts's shape.

**PDF page dimensions match source image dimensions exactly.** No hardcoded book size. Portrait/landscape auto-detected per comic via `Page.artworkWidth`/`artworkHeight`. Aligns with the client's confirmed 8×11 or 11×8 print sizes since the source images already carry those aspect ratios.

**PDF stored in R2 public bucket at `pdfs/{sessionId}.pdf`.** Guts flagged mid-session that customers should be able to re-download later. Switched from signed URLs (private bucket, 7-day expiry) to public bucket (UUID key = unguessable, no expiry, permanent re-download). `Order.pdfDownloadExpiry` schema field kept but always null in case client reverses.

**PNG → JPEG@85% conversion before pdf-lib embedding.** Combined with a Cloud Run RAM bump to 2 GB, this brings peak worker memory from ~625 MB (5 concurrent × 125 MB PDFs) into a comfortable 2 GB envelope while shrinking final PDF from ~120 MB to ~30 MB. Composite over white handles any transparency (belt-and-suspenders — comic art is opaque). Guts initially thought "pay for quality" meant keeping PNG; clarified that at print quality PNG-vs-JPEG@85 is indistinguishable and JPEG only saves bandwidth. Went with JPEG.

**Shiprocket enqueue inline at end of PDF worker's happy path.** Not via BullMQ `on-complete` event. Explicit control flow, cleaner error boundaries, matches the pattern used by the Razorpay webhook enqueueing `enqueuePaidGenerationJobs`.

**PDF worker failure handler waits for all retries.** Guard: `if (!job || job.attemptsMade < (job.opts.attempts ?? 3)) return;`. BullMQ fires `failed` on every retry, not just the last one. Without the guard, `PDF_FAILED` would get set on the first transient blip and recoverable jobs would be marked terminal.

### Work done

**Bug fixes (5 closed, 2 deferred):**

- **Bug 1 — paid session 24h expiry:** exported `POST_PAYMENT_STATUSES` from `session.service.ts` (was local to `regeneratePage`), added new `EXPIRY_EXEMPT_STATUSES` = union of `POST_PAYMENT_STATUSES` + `AWAITING_PAYMENT`, added early-return in both `assertNotExpired` copies, added exclusion to sweeper's `notIn`, fixed `isExpired` computation in `getOrderSessionId`, deleted the old duplicate `POST_PAYMENT_STATUSES` from near `regeneratePage`. Also imported `EXPIRY_EXEMPT_STATUSES` into `checkout.service.ts` (kept the duplicated `assertNotExpired` per prior decision — third caller hasn't appeared, so no refactor).
- **Bug 2 — `coverImageUrl`:** two-line fix in `order.service.ts`, `coverImageUrl` → `coverThumbnailUrls` in both `listUserOrders` and `getUserOrder`. Response shape now returns the array; frontend picks display index. Verified schema field name via grep first — Guts's initial correction attempt used `coverImageUrls` (plural, still wrong) and I caught it in the verify pass.
- **Bug 3 — stranded PAID:** two edits in `webhook.service.ts`. First edit refined the idempotency early-return so it lets a retry through when Order is PAID but Session is still PAID/AWAITING_PAYMENT. Second edit replaced the misleading try/catch around `enqueuePaidGenerationJobs` with a `.catch` that deletes the `WebhookEvent` row then re-throws. Confirmed the controller (`webhook.controller.ts`) and error handler (`errorHandler.ts`) both correctly translate the throw to a 500 — no controller-side changes needed.
- **Bug 4 — `checkoutParamsSchema`:** wired the existing (previously unused) Zod schema into `checkout.controller.ts` via `safeParse` + `ValidationError`. Replaced the inline `typeof === "string"` check.
- **Bug 6 — post-payment PATCH lock:** added the 12-field lock block in `updateOrderSession` after `assertNotExpired`, before the `data` assembly. Uses `POST_PAYMENT_STATUSES` (already exported from Bug 1). Field-by-field rejection so a PATCH containing only `notificationEmail` still succeeds post-payment.

**Bugs deliberately deferred:**
- **Bug 5 (rate limiting)** — Guts explicitly wants to batch this with other rate-limiting work in feature #9.
- **Bug 7 (Country toggle)** — batched into feature #7 admin catalog work. India is the only active country in DB, nothing breaks until international rollout.

**Feature #1 — `maybeMarkPaidReady`:**

New function in `session.service.ts` at end of file (~90 lines). Mirror of `maybeMarkPreviewComplete` scoped to `isPreviewPage: false`. Counts terminal `PageVersion` rows for paid pages, reduces into `terminalPageIds`/`succeededPageIds` sets, decides success-vs-failure with success-wins semantics. Two DB flips inside one `$transaction`: session `GENERATING_PAID → PAID_PAGES_READY` (status-guarded) + Order `PAID → GENERATED` (status-guarded, only on success branch). On all-page-failure, Order stays at `PAID` deliberately — refund is an ops decision, not automatic.

New WebSocket helper `emitSessionPaidReady` in `src/websocket/event.ts` — mirror of `emitSessionPreviewReady`, emits `session:paid-ready` event.

Wired into `generationWorker.ts` at both existing `maybeMarkPreviewComplete` call sites (success path around line 541, failure path around line 645). Both helpers now fire on every page completion; whichever's `isPreviewPage` filter doesn't match the finished page returns `not-done` and no-ops. Success path emits `session:paid-ready` when `paidResult === "ready"`. Failure path handles the edge case where the last page fails but earlier pages already covered the total. `notifyUser` call left as TODO comment in both paths — notification layer doesn't exist yet.

**Feature #2 — Send-to-print endpoint:**

Four files touched:

- **New:** `src/validators/sendToPrint.schema.ts` — Zod params + body schemas. Body validates: array non-empty, integer types, no duplicate pageNumbers (via `.refine`). Exports `SendToPrintInput` type.
- **`session.service.ts`** — new `sendToPrint` function at end of file (~140 lines). Two new imports: `pdfCompilationQueue` from queues, `SendToPrintInput` type from validator. Full flow: fetch session with order + comic → ownership check → idempotent branch (if already `CONFIRMED`, re-enqueue PDF job and return) → status guard `PAID_PAGES_READY` → selection count matches `pageCount` → in-flight variant check (single `findFirst` for any non-terminal PageVersion) → bulk PageVersion fetch + `versionMap` lookup (avoids N+1) → per-selection existence + `SD_READY` check → transaction (mark `isSelected: true` on chosen variants, flip session, flip Order, throws inside `$transaction` on any `count === 0` guard failure) → enqueue PDF outside transaction with `jobId: sessionId`.
- **`session.controller.ts`** — new `sendToPrintHandler` at end. Two imports added. Inline `safeParse` for both params and body (mirrors `regeneratePageHandler` pattern). Pulls `userId` from `req.user!.id` (safe because `/api/user/*` is behind `requireLoggedIn` globally per app.ts).
- **`src/routes/user.ts`** — new route registered: `POST /sessions/:sessionId/send-to-print`.

Route path in `user.ts` (behind auth) chosen over `public.ts` — customer must own the session, and by `PAID_PAGES_READY` the userId is always attached.

**Feature #3 — PDF compilation:**

Schema migration first: added `PDF_FAILED`, `SHIPMENT_QUEUED`, `SHIPMENT_FAILED` to `OrderSessionStatus` enum. Removed `DISPATCHED` (no rows had this status, confirmed by SQL check pre-migration). Migration ran clean. `npm install pdf-lib` — `sharp` already present.

Six files touched:

- **`src/jobs/queues.ts`** — added `shiprocketQueue` mirroring `pdfCompilationQueue` shape.
- **New:** `src/jobs/workers/shiprocketWorker.ts` — STUB worker (~50 lines). Consumes `shiprocket` queue, flips session `SHIPMENT_QUEUED → COMPLETED` via `updateMany` with status guard, logs and returns. Feature #4 replaces the body.
- **`src/jobs/workers/index.ts`** — imported and registered `shiprocketWorker` in the workers array. Boot log now says "All 3 workers are actively listening" (was 2).
- **`session.service.ts`** — new `compilePdfForSession` function at end of file (~180 lines). Also added five new imports at top: `PDFDocument` from pdf-lib, `sharp`, `downloadFileToBuffer`/`getKeyFromPublicUrl`/`uploadFile`/`getPublicUrl` from r2, `shiprocketQueue` from queues. Function flow: fetch session + order + comic → idempotent branch (if already past `COMPILING_PDF`, return existing URLs) → status flip `CONFIRMED → COMPILING_PDF` (guarded on `CONFIRMED` OR `COMPILING_PDF` so a mid-crash retry also passes) → fetch selected PageVersions ordered by pageNumber → for each: `getKeyFromPublicUrl` to convert stored URL back to key → `downloadFileToBuffer` from R2 public bucket → sharp flatten-over-white + JPEG@85 → embed into pdf-lib at source dimensions → save PDF bytes → upload to R2 public bucket at `pdfs/{sessionId}.pdf` → transaction (update Order pdfUrl+pdfDownloadUrl, flip session `COMPILING_PDF → SHIPMENT_QUEUED`) → enqueue shiprocket outside transaction with `jobId: sessionId`.
- **`src/jobs/workers/pdfWorker.ts`** — full rewrite replacing the 500ms stub. Thin wrapper calling `compilePdfForSession`. Terminal-failure handler with the `job.attemptsMade < job.opts.attempts` guard; only flips session to `PDF_FAILED` after all retries exhausted, with status guard on `COMPILING_PDF` so a late-arriving success doesn't get overwritten.
- **`src/websocket/event.ts`** — noted from Feature #1: `emitSessionPaidReady` added in that feature, no additional websocket work needed here.

### Tasks added to backlog

Recorded in `CURRENT_STATE.md` under NEXT / OPEN QUESTIONS / VERIFY:

- **Feature #4 (real Shiprocket)** — next priority, replaces the stub. Must flip Order.status (stub doesn't touch it).
- **Feature #11 (end-to-end payment test)** — moved after #4 so the full pipeline is real when tested.
- **Feature #5 (`notifyUser`)** — three TODO comment sites in the code now (generationWorker success, generationWorker failure-with-earlier-success, PDF compile — implicit).
- **Admin retry endpoint for PDF_FAILED and SHIPMENT_FAILED sessions** — how does admin re-trigger? Not designed. Deferred to admin batch (#6 or #7).
- **Cloud Run RAM bump to 2 GB** — agreed but not applied. Must land before production traffic hits `compilePdfForSession`.
- **`Order.pdfDownloadExpiry` field always null now** — kept for schema stability in case client reverses the public-bucket decision.
- **Full VERIFY list rebuilt around the new post-payment pipeline** — 15 items covering payment flow, send-to-print edge cases, PDF compile, stub Shiprocket handoff, and both bug regressions.

### Mistakes caught mid-session

- **Initial Bug 3 fix proposal was wrong.** First recommendation was to add `PAID` to `REGENERATABLE_STATUSES` — one-line fix. Walking through it caught two problems: (1) `regeneratePage` has special code to unstick `FAILED` sessions but no equivalent for `PAID`, so the first regen would leave session stuck at `PAID`; (2) `regeneratePage` is per-page and 14 stranded paid pages meant 14 clicks. Terrible UX for a customer who just paid. Pivoted to Razorpay-retry approach before writing any code. This is the same class of mistake as the Aug 15 session's audit-of-audit finding — a "one-line fix" that would have compounded with an existing constraint.
- **Initial send-to-print design assumed customer wouldn't re-review preview variants.** Proposed Option B (auto-select preview variants server-side, frontend only sends paid pages). Guts clarified UX: after payment, customer lands back on the same review screen and can regenerate preview variants until they hit Send-to-print. Option A (all pages required in the request) is the correct shape. Pivoted before writing code.
- **First controller edit for Bug 4 would have used raw `.parse()`.** Caught the DECISIONS "never raw parse in a controller" rule mid-write and switched to `safeParse` + `ValidationError`.
- **PDF worker Step 3-c success-path had preview and paid `if` blocks in wrong order.** I placed the paid-block between the preview-call and the preview-if-check. Functionally correct (both checks fire) but reads confusingly. Guts caught in verification pass, order fixed to preview → preview-if → paid → paid-if.
- **Guts typo'd `coverImageUrls` (plural) when applying Bug 2 fix** — I caught it in the verify pass. Schema field is `coverThumbnailUrls` (Thumbnail, not Image). This is exactly the failure mode audit 12.1 predicts: no typecheck runs, so a field-name typo ships if nobody re-verifies. Reinforces the case for `tsc --noEmit` in CI.
- **Cluster of small missing-import errors during PDF worker wiring** — `maybeMarkPaidReady` import forgotten in generationWorker on first pass (caught by Guts's TypeScript errors on lines 555 and 695); `getSignedUploadUrl` accidentally added to session.service imports even though not used by new code (harmless, left alone). Every missing-import was caught by the typecheck-before-boot policy — the exact reason we run it.

### What is explicitly not done

Nothing built this session has been runtime-verified. All work was typecheck + boot verification only, by policy. First real verification will happen after feature #4 lands so the pipeline is real end-to-end, not stub-terminated.

Every specific verification target from Aug 19 still stands: real Razorpay test payment, duplicate webhook (P2002 path), wrong signature returns 400, idempotent checkout re-call, delayed webhook (>30s), payment.failed logging. Now added: send-to-print in-flight rejection, send-to-print idempotent retry, PDF worker retry-then-fail behavior, stub Shiprocket flip.

Cloud Run RAM bump to 2 GB is agreed but not applied. Cloud Run "CPU always allocated" for the sweeper is still unverified from before the session.

**Session ended at a clean stopping point** — three features shipped, five bugs closed, nothing half-done. Feature #4 (real Shiprocket) picks up next session.

---

## Session — August 19, 2026 — Checkout, Razorpay, customer order endpoints; then a doc sync that found three defects

**Triggered by:** the P1 list was done and feature work had been paused since August 11. Guts picked up the `NEXT` list at item 1 and worked through checkout → Razorpay → user-facing order fetch in a single day. Roughly 2.5 days of the 10-day plan closed. The doc sync ran afterwards as a separate task and is where the defects surfaced.

**Two distinct phases, worth keeping separate:** the build phase produced working, boot-verified code and a written session report (`Session_2026 _08 _19_checkout_payments.md`). The sync phase read that report against the actual source and found three things the report asserts that the code does not do.

### Decisions locked

**Payment flow shape.** After payment the paid pages generate in the background — the user is never held on a spinner. The frontend shows a "your comic is being made" prompt with an optional link through to the live preview screen; an email (later WhatsApp) fires when generation finishes.

**Selection is a single batch commit.** This was the meaningful design call of the session. A per-page `PATCH .../select` endpoint was considered and then eliminated: the user browses variants with zero API calls, and every selection lands at once at send-to-print as `{ selections: [{ pageId, variantIndex }] }` in one transaction across all pages. `isSelected` therefore stays `false` on every variant until that single explicit action. Every page must carry a selection, enforced in the UI and again at the endpoint.

**Order lifecycle rewritten.** `OrderStatus` went from 5 loosely-defined values to 9 that trace the actual flow. `GENERATING` collapsed into `PAID`, `PDF_READY` folded into `CONFIRMED`, `DISPATCHED` became `SHIPPED`, `FAILED` was dropped as never-reached, and `REFUNDED` was dropped with the no-refund policy. The migration was free — no `Order` rows existed.

**Customer-facing status is derived, never stored.** `toPublicStatus()` collapses 9 internal values into 7 strings; `CONFIRMED`, `SHIPROCKET_FAILED` and `READY_TO_SHIP` all read as `"Printing"` because a Shiprocket failure is an ops problem and not something to alarm a customer with. Renaming a stage is one line and no migration.

**Order row created at checkout initiation, not at payment success.** An abandoned checkout leaves a cheap, filterable `CREATED` row and is the natural anchor for a future resume-payment flow.

**Webhook-only, no client-side verify endpoint.** `payment.captured` is the sole trigger; `payment.failed` logs for support; `order.paid` is ignored as redundant. Accepted cost is a brief delay while the webhook lands. Two systems confirming the same payment is the same duplication already rejected for RunPod webhooks-vs-polling. ~2 h to add later if it becomes a measured UX problem.

**Currency-agnostic from day one, only India seeded active.** `toSmallestUnit(amount, currency)` handles 0-, 2- and 3-decimal ISO currencies; there is no `× 100` anywhere. Enabling international once Razorpay approves the client's account is an admin DB row, not a deploy.

**Country matching is deliberately not enforced.** IP defaulting is the frontend's job. A US user can pick INR pricing and pay the Indian price with a US card — accepted knowingly, because volume is low and blocking it would break gift shipping.

**No expiry after payment; no refunds; session read-only after send-to-print.** The first of these turned out not to be implemented — see below. **(Fixed Aug 21 — Bug 1.)**

**PDF synchronous, Shiprocket asynchronous.** PDF compilation must succeed at send-to-print or the button errors and the user retries. Shiprocket order creation is a retried background job; exhausting retries sets `SHIPROCKET_FAILED` for an admin queue. AWB and manifest stay manual because they need physical weight and dimensions. **(PDF-synchronous decision was reversed Aug 21 — PDF is now an async background job on the `pdf-compilation` BullMQ queue with BullMQ retries. Reason: synchronous held the request open for the full ~60s+ compilation and made retries a customer-facing button rather than backend automation.)**

**All notification behind `notifyUser(orderId, event)` from day one** — email now, WhatsApp as a one-file addition later, both on retried jobs so neither blocks a response.

### Work done

- **`src/lib/razorpay.ts`** — SDK singleton, `toSmallestUnit()` with explicit zero-decimal and three-decimal currency sets, `verifyWebhookSignature()` using `crypto.timingSafeEqual` with a length pre-check and a try/catch so malformed hex returns `false` instead of throwing.
- **`checkout.service.ts` / `checkout.controller.ts` / route** — six guards, country + `PricingRule` lookup, Razorpay order created outside the transaction, `Order` row + session flip inside one, idempotent reuse of a `CREATED` order, `updateMany` status guards on the flip. Orphaned Razorpay orders after a DB failure are logged and left to Razorpay's 15-minute auto-expiry.
- **`webhook.service.ts` / `webhook.controller.ts` / `routes/webhooks.ts`** — signature check, `WebhookEvent` insert for transport-level idempotency, order-status check for business-level idempotency, `payment.captured` handling, best-effort `orderId` backfill, transactional `PAID` flips, enqueue outside the transaction, then `GENERATING_PAID`.
- **`app.ts`** — `/api/webhooks` mounted with `express.raw({ type: "application/json" })` above `express.json()`, the same raw-body pattern Better Auth already needed.
- **`enqueuePaidGenerationJobs`** in `session.service.ts` — a faithful mirror of the preview enqueue with `isPreviewPage: false`, exported for the webhook.
- **`order.service.ts` / `order.controller.ts` / user routes** — `GET /orders` and `GET /orders/:id`, ownership-checked, curated shapes, `publicStatus` instead of raw status.
- **`orderStatusMapping.ts`**, **`checkout.schema.ts`**, three Razorpay env vars, and the `deleteAddressHandler` envelope fix (address bug #3).

### Bugs hit and fixed mid-build

- **`checkout.service.ts` carried three cascading naming bugs from an earlier draft** — a typo'd `assestNotExpired`, an `assertNotExpired` that actually held the shipping-completeness logic, and a call to a nonexistent `assertShippingComplete`. Fixed by renaming both helpers and correcting the call.
- **Flat vs nested Razorpay config** — code assumed `config.razorpayKeyId`; the chosen shape was `config.razorpay.razorpayKeyId`. Reverted to nested.
- **`razorpay.ts` seemed not to log "initialized" on boot** — not a bug. Nothing imported the module yet and ESM only executes imported files. Confirmed with a temporary import in `server.ts`, then removed. Same class of confusion as the Part C `console.log` that never fired back in August.

### Doc sync — three defects the build phase did not catch

None of these were in the session report; all three came from reading the source against it. All three were recorded in `CURRENT_STATE.md`. **All five (including two smaller findings) were fixed Aug 21 as Bugs 1–4 and 6.**

- **Both order endpoints throw on first call.** `order.service.ts` selects `comic.coverImageUrl` in two places. `Comic` has `coverThumbnailUrls String[]`; there is no `coverImageUrl`. Prisma raises a validation error, so neither endpoint has ever been able to return. The report lists them as done ahead of schedule. **This is the cleanest evidence so far for audit 12.1** — `tsc --noEmit` would have caught it instantly, and the absence of any typecheck is exactly why it shipped. **(Fixed Aug 21 — Bug 2.)**
- **The locked "no expiry after payment" decision is not implemented, and the gap destroys paid sessions.** `expiresAt` is still 24 h from creation and is never extended at payment, while `sweepExpiredSessions` flips every session past `expiresAt` that is not `FAILED`/`COMPLETED` — `AWAITING_PAYMENT`, `PAID` and `GENERATING_PAID` are all caught. A customer who pays and returns the next day to pick variants finds a `FAILED` session. Confirmed launch-blocking. Note the fix has to land in *both* copies of `assertNotExpired`, since checkout has a private duplicate. **(Fixed Aug 21 — Bug 1, via `EXPIRY_EXEMPT_STATUSES` exclusion in four places.)**
- **The webhook's stranded-`PAID` recovery path does not exist.** The catch block on a failed paid-page enqueue says "user can retry via a future regenerate call (PAID is regeneratable per DECISIONS)." `PAID` is not in `REGENERATABLE_STATUSES`. The two-step `PAID → GENERATING_PAID` flip is still the right shape; it just has nothing to fall back on. **(Fixed Aug 21 — Bug 3, via Razorpay webhook retry rather than user-driven regenerate.)**

Two smaller findings recorded at the same time: **`checkoutParamsSchema` is imported by nothing** (the controller does an inline string check, so no UUID validation runs despite the report saying otherwise) **(Fixed Aug 21 — Bug 4.)**, and **`helmet()` has moved above the Better Auth handler** in `app.ts`, reversing a documented decision so that `/api/auth/*` now does receive helmet headers. The helmet move was never recorded and its intent is unknown, so it is still flagged `⚠️ CONTRADICTORY` in both `PROJECT_CONTEXT.md` and `DECISIONS.md` rather than rewritten either way. **(Helmet contradiction unresolved.)**

### What is explicitly not done

Nothing has been verified against a real Razorpay payment. The only smoke test was a bare curl confirming the webhook route returns 400 on a missing signature header — **the signature verification code has never seen a genuine payload.** ngrok instructions were written but never executed. `maybeMarkPaidReady` does not exist, so a session enqueues its paid pages and then sits at `GENERATING_PAID` forever. Send-to-print and PDF compilation are not built. Address bugs 1 (auto-default race) and 2 (non-atomic delete-then-promote) are documented and deferred. **(`maybeMarkPaidReady`, send-to-print, and PDF compilation all built Aug 21 as features #1, #2, #3. Real payment test still not done — deferred to after feature #4 lands.)**

**The standing recommendation from this session:** spend 1–2 hours on ngrok plus one real test payment *before* layering paid-page and PDF work on top, so a signature bug surfaces while it is still isolated. **(This recommendation was overruled Aug 21 — Guts explicitly decided to defer runtime testing until feature #4 lands so the pipeline is real end-to-end. Accepted risk.)**

---

## Older sessions (collapsed)

- **August 15, 2026** — P1 fix verification found two defects in the fixes themselves. `FAILED` sessions couldn't recover because `regeneratePage` never reset session status back to `GENERATING_PREVIEW` — fixed by flipping BEFORE enqueue (the deliberate exception to the flip-after rule). `distinct: ["pageId"]` in the terminal-state query was nondeterministic — could read a FAILED row for a page that succeeded on retry. Fixed by loading all terminal rows and reducing into two Sets. Eight fixes confirmed correct; 1.1 (CI/CD) reported resolved but unverified. Full doc sync across all four docs. `CODE_VS_DOCS_AUDIT.md` frozen at Aug 11.
- **August 11, 2026** — Full codebase audit against the four docs, then doc sync. No application code changed — documentation work only. Produced `documents/CODE_VS_DOCS_AUDIT.md` — 125 numbered findings (P1 13 / P2 40 / P3 72). Found undocumented features (whole `displayImageUrl`, page reordering, re-entrant preview enqueue, `GET /api/public/countries`, `deleteComic` sweeping page assets). Introduced the `⚠️ CONTRADICTORY (Aug 11 audit)` marker convention. Four loose ends closed by inspection.
- **August 7, 2026** — Part E complete: full SD worker orchestration + supporting fixes + end-to-end verification against real RunPod. Photo cache with refcount + Promise memoization built. `isPreviewPage: true` filter replaced `pageNumber <= freePreviewPages` throughout. BullMQ priority formula compressed to fit 21-bit ceiling. Session status flip moved to AFTER enqueue succeeds. `hasFace` fork added — non-face pages skip RunPod. `GET /sessions/:id` redesigned to nested `pages[].variants[]`. JPEG q88 for RunPod payload / PNG for R2 storage. BigInt serialization patched globally. Photo endpoint renamed `.../validate` → `.../confirm`.
- **August 3, 2026** — SD worker Parts A–D complete, Part D live-tested against real RunPod. Polling over webhook locked (rejected `/runsync`). Round-robin priority formula shipped. Concurrency bumped to 5 to match RunPod. `Page.pagePrompt` became required at Zod layer. Worker file renamed `sdWorker.ts` → `generationWorker.ts`. A40 GPU tier confirmed stable; RTX 4090 in US-NC-1 had driver heterogeneity. Sharp text stamping design locked (SVG-per-bubble, base64 font embedding, decrement-by-1 auto-shrink).
- **July 29, 2026** — Frontend integration guide + public page assets + normalized bubble coordinates. Page artwork + masks moved to public bucket. Bubble geometry became normalized 0–1 fractions. `Page.artworkWidth`/`artworkHeight` Sharp-probed server-side. `fontSize` became `Float @default(0.02)` fraction of artwork height. Wrote `FRONTEND_COMIC_INTEGRATION.md`. `react-konva` recommended for bubble mapper. Publish gate stays 2-check.
- **July 28, 2026** — Multi-thumbnail feature (schema, batch upload endpoint, full-array PATCH pattern) + single-LoRA lock-in (client-confirmed baked in Docker) + base64-everything transport architecture confirmed. Publish flow stays synchronous DB flip; async ComfyUI asset sync worker deleted from NEXT list.
- **July 26, 2026** — Client-account ComfyUI endpoint deployed end-to-end on RunPod; four sequential build failures diagnosed. Added per-page `steps`/`cfg` tunables with bounds constants in `src/config/generation.ts`. Rule locked: never propose a Dockerfile fix from a RunPod status error without reading container logs.
- **July 25, 2026** — Product simplification pass: HD pipeline removed, Sharp text stamping order reversed to FIRST, variant caps changed to payment-based. Schema fields renamed. Deep bug audit found 3 latent bugs. HD code commented not deleted.
- **July 24, 2026** — Frontend-impact bug audit, response-envelope standardization (`sendSuccess()` across all 13 controllers), comic thumbnail R2 cleanup on update, authored `FRONTEND_HANDOFF.md`.
- **July 21, 2026 (afternoon/evening)** — ComfyUI/RunPod deployment via comfy.getrunpod.io: face-swap workflow processed, GitHub repo pushed, Docker "Ready". Locked decisions: api-workflow.json as backend template, filename-match invariant, cold-start mitigation.
- **July 21 (morning)** — Schema migration (CoverType, OrderSession/Order fields, SavedAddress), `requireLoggedIn`/`attach-user` built, full CRUD completion, CORS `PATCH` fix, admin route reorg.
- **July 13** — Deployment planning (Cloud Run asia-south1, GitHub Actions CI/CD), customer-auth introduction via Better Auth, cover type pricing dimension, `OrderSession.userId` nullable FK, `SavedAddress` design, Docker rewrite ~250MB.
- **July 10** — CMS features (Theme, HeroImage, CustomerReview, TeamMember, Feedback, AnnouncementBar), Comic CRUD expansion, Docker setup complete, ~40+ new endpoints.
- **Days 1–3** — Core scaffold: Express/TypeScript/ESM, Prisma+Neon, two-bucket R2, Redis/BullMQ, Better Auth, Country and Comic base CRUD, public catalogue, `OrderSession` create/update/get, authenticated WebSocket.
- **Day 4 Block 1** — Generate-trigger + per-page regenerate endpoints. `PageVersion` schema fix.
- **Day 4 Block 2** — Page/Bubble/Font admin CRUD, unified comic update, LoRA upload. Double-validation cleanup (later found incomplete).
- **Day 4 Block 3** — Real Python photo validation, later moved to frontend.